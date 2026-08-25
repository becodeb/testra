import type { FullQuestion, QuestionAsset, QuestionDifficulty, QuestionType } from "@/domain/exam";

const RHYTHM_INCIDENT_TYPES = new Set(["cadencia-respuestas", "ritmo-desarrollo"]);

export interface AnalyticsAttempt {
  runId: string;
  participantId: string;
  status: string;
  startedAt: number | null;
  joinedAt: number;
  submittedAt: number | null;
  assigned: FullQuestion[];
  answers: Map<string, unknown>;
  grades: Map<string, { auto: boolean | null; points: number | null }>;
  incidentTypes: string[];
}

interface QuestionAccumulator {
  id: string;
  prompt: string;
  section: string | null;
  difficulty: QuestionDifficulty | null;
  type: QuestionType;
  points: number;
  assets: QuestionAsset[];
  autoGradable: boolean;
  assigned: number;
  answered: number;
  correct: number;
  distribution: Map<string, number>;
  gradePoints: number[];
}

export function buildExamAnalytics(attempts: AnalyticsAttempt[], expected: number, passingScorePercent: number | null) {
  const submitted = attempts.filter((attempt) => attempt.status === "submitted");
  const percentages = submitted.map(scorePercent).sort((a, b) => a - b);
  const durations = submitted.flatMap((attempt) => attempt.submittedAt ? [Math.max(0, attempt.submittedAt - Math.max(attempt.joinedAt, attempt.startedAt ?? 0))] : []);
  const questions = questionAnalytics(attempts);
  const ranked = questions.filter((question) => question.autoGradable && question.assigned > 0).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
  const section = groupQuestions(questions, "section");
  const usesDifficulty = questions.some((question) => question.difficulty !== null);
  const difficulty = usesDifficulty ? groupQuestions(questions, "difficulty") : [];
  const incidentTypes = new Map<string, { count: number; participants: Set<string> }>();
  for (const attempt of attempts) for (const type of attempt.incidentTypes) {
    if (RHYTHM_INCIDENT_TYPES.has(type)) continue;
    const current = incidentTypes.get(type) ?? { count: 0, participants: new Set<string>() };
    current.count += 1;
    current.participants.add(attempt.participantId);
    incidentTypes.set(type, current);
  }

  return {
    summary: {
      expected,
      participants: attempts.length,
      submissions: submitted.length,
      absences: Math.max(0, expected - attempts.length),
      average: average(percentages),
      median: median(percentages),
      min: percentages.length ? percentages[0] : null,
      max: percentages.length ? percentages.at(-1)! : null,
      passPercentage: passingScorePercent === null || !percentages.length ? null : round(percentages.filter((value) => value >= passingScorePercent).length / percentages.length * 100),
      passingScorePercent,
      averageDurationMs: durations.length ? Math.round(average(durations)!) : null,
      medianDurationMs: durations.length ? Math.round(median(durations)!) : null,
      minDurationMs: durations.length ? Math.min(...durations) : null,
      maxDurationMs: durations.length ? Math.max(...durations) : null,
    },
    gradeDistribution: distribution(percentages),
    questions,
    hardest: ranked.slice(0, 3),
    easiest: [...ranked].reverse().slice(0, 3),
    sections: section,
    difficulty,
    usesDifficulty,
    integrity: {
      totalSignals: [...incidentTypes.values()].reduce((sum, value) => sum + value.count, 0),
      affectedParticipants: attempts.filter((attempt) => attempt.incidentTypes.some((type) => !RHYTHM_INCIDENT_TYPES.has(type))).length,
      byType: [...incidentTypes].map(([type, value]) => ({ type, count: value.count, participants: value.participants.size })).sort((a, b) => b.participants - a.participants || b.count - a.count),
      caveat: "Son señales técnicas para revisar con contexto; no demuestran una conducta por sí solas.",
    },
  };
}

function scorePercent(attempt: AnalyticsAttempt) {
  const maximum = attempt.assigned.reduce((sum, question) => sum + question.points, 0);
  const score = [...attempt.grades.values()].reduce((sum, grade) => sum + (grade.points ?? 0), 0);
  return maximum > 0 ? round(score / maximum * 100) : 0;
}

function questionAnalytics(attempts: AnalyticsAttempt[]) {
  const rows = new Map<string, QuestionAccumulator>();
  for (const attempt of attempts) for (const question of attempt.assigned) {
    const row: QuestionAccumulator = rows.get(question.id) ?? { id: question.id, prompt: question.prompt, section: question.section || null, difficulty: question.difficulty ?? null, type: question.type, points: question.points, assets: question.assets ?? [], autoGradable: question.type !== "long", assigned: 0, answered: 0, correct: 0, distribution: new Map<string, number>(), gradePoints: [] };
    row.assigned += 1;
    if (attempt.answers.has(question.id)) {
      row.answered += 1;
      if (question.type !== "long") {
        const label = answerBucket(attempt.answers.get(question.id));
        row.distribution.set(label, (row.distribution.get(label) ?? 0) + 1);
      }
    }
    const grade = attempt.grades.get(question.id);
    if (grade?.auto === true) row.correct += 1;
    if (grade?.points !== null && grade?.points !== undefined) {
      row.gradePoints.push(grade.points);
      if (question.type === "long") {
        const label = `${round(grade.points)} pts`;
        row.distribution.set(label, (row.distribution.get(label) ?? 0) + 1);
      }
    }
    rows.set(question.id, row);
  }
  return [...rows.values()].map((row) => ({
    ...row,
    gradePoints: undefined,
    distribution: [...row.distribution].map(([answer, count]) => ({ answer, count })),
    omissions: row.assigned - row.answered,
    incorrect: row.autoGradable ? Math.max(0, row.answered - row.correct) : null,
    accuracy: row.autoGradable && row.assigned ? round(row.correct / row.assigned * 100) : null,
    incorrectPercentage: row.autoGradable && row.assigned ? round(Math.max(0, row.answered - row.correct) / row.assigned * 100) : null,
    averagePoints: average(row.gradePoints),
    averageDurationMs: null,
  }));
}

function groupQuestions(questions: ReturnType<typeof questionAnalytics>, key: "section" | "difficulty") {
  const groups = new Map<string, { assigned: number; correct: number; autoAssigned: number }>();
  for (const question of questions) {
    const name = question[key]; if (!name) continue;
    const group = groups.get(name) ?? { assigned: 0, correct: 0, autoAssigned: 0 };
    group.assigned += question.assigned;
    group.correct += question.correct;
    if (question.autoGradable) group.autoAssigned += question.assigned;
    groups.set(name, group);
  }
  return [...groups].map(([name, group]) => ({ name, assigned: group.assigned, accuracy: group.autoAssigned ? round(group.correct / group.autoAssigned * 100) : null }));
}

function distribution(values: number[]) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({ from: index * 10, to: index === 9 ? 100 : index * 10 + 9, count: 0 }));
  for (const value of values) buckets[Math.min(9, Math.floor(value / 10))].count += 1;
  return buckets;
}

function answerBucket(value: unknown) { return Array.isArray(value) ? [...value].sort().join(" + ") || "Sin selección" : typeof value === "boolean" ? value ? "Verdadero" : "Falso" : String(value ?? "Sin respuesta").slice(0, 120); }
function average(values: number[]) { return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }
function median(values: number[]) { if (!values.length) return null; const middle = Math.floor(values.length / 2); return round(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2); }
function round(value: number) { return Math.round(value * 10) / 10; }
