import type { FullQuestion, QuestionAsset } from "@/domain/exam";
import type { Actor } from "@/server/actors";
import { db } from "@/server/db/client";
import { questionsForParticipant } from "@/server/participant-paper";
import { getRunForTeacher } from "@/server/repository";
import { hasFinished } from "@/lib/exam-printout";
import { clipboardDetail, copyForIncident } from "@/lib/incident-copy";

// La hoja que el docente imprime para dejar constancia en papel. Lee lo mismo
// que el detalle del alumno, pero en el formato que necesita una copia que se
// archiva: cada opción con lo que marcó el alumno y lo que era correcto, la
// devolución, la rúbrica y, solo si el docente lo pide, los avisos.

export type PrintedAnswer =
  | { kind: "choice"; multiple: boolean; options: Array<{ id: string; text: string; selected: boolean; correct: boolean }> }
  | { kind: "tf"; value: boolean | null; correct: boolean }
  | { kind: "text"; value: string; accepted: string[] | null };

export interface PrintedQuestion {
  id: string;
  number: number;
  type: FullQuestion["type"];
  prompt: string;
  assets: QuestionAsset[];
  points: number;
  pointsAwarded: number | null;
  gradingStatus: string | null;
  gradedBy: string | null;
  feedback: string;
  rubric: Array<{ id: string; label: string; maxPoints: number; awarded: number | null }>;
  answered: boolean;
  answer: PrintedAnswer;
}

export interface PrintedIncident {
  id: string;
  at: number;
  durationMs: number;
  type: string;
  title: string;
  detail: string;
  source: string;
  questionNumber: number | null;
}

export interface PrintedPaper {
  participant: {
    id: string;
    name: string;
    email: string | null;
    status: string;
    startedAt: number | null;
    submittedAt: number | null;
    submitReason: string | null;
    extraTimeS: number;
    reopenedCount: number;
  };
  score: number;
  maxPoints: number;
  percent: number;
  passed: boolean | null;
  pendingCorrections: number;
  answeredCount: number;
  questions: PrintedQuestion[];
  /** `null` cuando el docente eligió imprimir sin avisos: no es lo mismo que "no hubo". */
  incidents: PrintedIncident[] | null;
}

export interface ExamPrintout {
  run: {
    id: string;
    title: string;
    code: string;
    subject: string | null;
    organization: string | null;
    teacher: string | null;
    date: number;
    timeLimitS: number;
    passingScorePercent: number | null;
  };
  generatedAt: number;
  generatedBy: string;
  papers: PrintedPaper[];
}

interface ParticipantRow {
  id: string;
  display_name: string;
  email: string | null;
  status: string;
  attempt_started_at: number | null;
  joined_at: number;
  submitted_at: number | null;
  submit_reason: string | null;
  extra_time_s: number;
  reopened_count: number;
  assigned_questions_snapshot: string | null;
}

interface GradeRow {
  participant_id: string;
  question_id: string;
  points_awarded: number | null;
  grading_status: string;
  graded_by_type: string;
  feedback: string | null;
  rubric_scores: string | null;
}

export async function getExamPrintout(
  actor: Actor,
  options: { runId: string; participantId?: string; includeIncidents: boolean },
): Promise<ExamPrintout | null> {
  const run = await getRunForTeacher(options.runId, actor);
  if (!run) return null;

  // El filtro por alumno va en la consulta y no después: así un id de otra toma
  // no trae nada, en vez de colarse en la hoja de esta.
  const participantResult = await db.prepare(
    `SELECT p.id, p.display_name, COALESCE(p.classroom_email, u.email) AS email, p.status,
            p.attempt_started_at, p.joined_at, p.submitted_at, p.submit_reason,
            p.extra_time_s, p.reopened_count, p.assigned_questions_snapshot
     FROM participants p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.run_id = ? AND (? = '' OR p.id = ?)
     ORDER BY p.display_name`,
  ).bind(run.id, options.participantId ?? "", options.participantId ?? "").all<ParticipantRow>();
  const finished = participantResult.results.filter((participant) => hasFinished(participant.status));
  if (options.participantId && !finished.length) return null;

  const [meta, gradeResult, answerResult, incidentResult] = await Promise.all([
    db.prepare(
      `SELECT e.subject, o.name AS organization, u.name AS teacher
       FROM runs r
       LEFT JOIN exams e ON e.id = r.exam_id
       LEFT JOIN organizations o ON o.id = r.org_id
       LEFT JOIN users u ON u.id = COALESCE(r.author_id, e.author_id)
       WHERE r.id = ?`,
    ).bind(run.id).first<{ subject: string | null; organization: string | null; teacher: string | null }>(),
    db.prepare(
      `SELECT g.participant_id, g.question_id, g.points_awarded, g.grading_status, g.graded_by_type, g.feedback, g.rubric_scores
       FROM grades g JOIN participants p ON p.id = g.participant_id
       WHERE p.run_id = ?`,
    ).bind(run.id).all<GradeRow>(),
    db.prepare(
      `SELECT a.participant_id, a.question_id, a.value
       FROM answers a JOIN participants p ON p.id = a.participant_id
       WHERE p.run_id = ?`,
    ).bind(run.id).all<{ participant_id: string; question_id: string; value: string }>(),
    options.includeIncidents
      ? db.prepare(
          `SELECT i.id, i.participant_id, i.at, i.duration_ms, i.type, i.meta, i.source, i.question_id
           FROM incidents i JOIN participants p ON p.id = i.participant_id
           WHERE p.run_id = ? ORDER BY i.at`,
        ).bind(run.id).all<{ id: string; participant_id: string; at: number; duration_ms: number; type: string; meta: string | null; source: string; question_id: string | null }>()
      : Promise.resolve({ results: [] }),
  ]);

  const grades = groupBy(gradeResult.results, (grade) => grade.participant_id);
  const answers = groupBy(answerResult.results, (answer) => answer.participant_id);
  const incidents = groupBy(incidentResult.results, (incident) => incident.participant_id);

  const papers = finished.map((participant): PrintedPaper => {
    const questions = questionsForParticipant(run, { id: participant.id, assigned_questions_snapshot: participant.assigned_questions_snapshot });
    const gradeByQuestion = new Map((grades.get(participant.id) ?? []).map((grade) => [grade.question_id, grade]));
    const answerByQuestion = new Map((answers.get(participant.id) ?? []).map((answer) => [answer.question_id, parseJson(answer.value)]));
    const numberByQuestion = new Map(questions.map((question, index) => [question.id, index + 1]));

    const printed = questions.map((question, index) => {
      const grade = gradeByQuestion.get(question.id);
      const value = answerByQuestion.get(question.id);
      const rubricScores = parseRecord(grade?.rubric_scores);
      return {
        id: question.id,
        number: index + 1,
        type: question.type,
        prompt: question.prompt,
        assets: question.assets ?? [],
        points: question.points,
        pointsAwarded: grade?.points_awarded ?? null,
        gradingStatus: grade?.grading_status ?? null,
        gradedBy: grade?.graded_by_type ?? null,
        feedback: grade?.feedback?.trim() ?? "",
        rubric: question.type === "long"
          ? (question.config.rubric ?? []).map((criterion) => {
              const awarded = rubricScores[criterion.id];
              return { ...criterion, awarded: typeof awarded === "number" ? awarded : null };
            })
          : [],
        answered: isAnswered(value),
        answer: printedAnswer(question, value),
      };
    });

    const score = printed.reduce((sum, question) => sum + (question.pointsAwarded ?? 0), 0);
    const maxPoints = printed.reduce((sum, question) => sum + question.points, 0);
    const percent = maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0;
    const pendingCorrections = (grades.get(participant.id) ?? [])
      .filter((grade) => grade.grading_status !== "auto_graded" && grade.grading_status !== "graded").length;

    return {
      participant: {
        id: participant.id,
        name: participant.display_name,
        email: participant.email,
        status: participant.status,
        startedAt: participant.attempt_started_at ?? participant.joined_at ?? null,
        submittedAt: participant.submitted_at,
        submitReason: participant.submit_reason,
        extraTimeS: participant.extra_time_s,
        reopenedCount: participant.reopened_count,
      },
      score,
      maxPoints,
      percent,
      passed: run.passing_score_percent === null ? null : percent >= Number(run.passing_score_percent),
      pendingCorrections,
      answeredCount: printed.filter((question) => question.answered).length,
      questions: printed,
      incidents: options.includeIncidents
        ? (incidents.get(participant.id) ?? []).map((incident) => {
            const meta = parseRecord(incident.meta);
            const questionId = incident.question_id ?? (typeof meta.questionId === "string" ? meta.questionId : null);
            return {
              id: incident.id,
              at: Number(incident.at),
              durationMs: Number(incident.duration_ms ?? 0),
              type: incident.type,
              title: copyForIncident(incident.type).title,
              detail: incident.type === "atajo-copiar-pegar" ? clipboardDetail(meta) : "",
              source: incident.source,
              questionNumber: questionId ? numberByQuestion.get(questionId) ?? null : null,
            };
          })
        : null,
    };
  });

  return {
    run: {
      id: run.id,
      title: run.title,
      code: run.code,
      subject: meta?.subject ?? null,
      organization: meta?.organization ?? null,
      teacher: meta?.teacher ?? null,
      date: Number(run.started_at ?? run.created_at),
      timeLimitS: run.time_limit_s,
      passingScorePercent: run.passing_score_percent === null ? null : Number(run.passing_score_percent),
    },
    generatedAt: Date.now(),
    generatedBy: actor.name,
    papers,
  };
}

function printedAnswer(question: FullQuestion, value: unknown): PrintedAnswer {
  if (question.type === "mc" || question.type === "ms") {
    const selected = question.type === "mc" ? [value] : Array.isArray(value) ? value : [];
    const correct = question.type === "mc" ? [question.config.correctOptionId] : question.config.correctOptionIds;
    return {
      kind: "choice",
      multiple: question.type === "ms",
      options: question.config.options.map((option) => ({
        id: option.id,
        text: option.text,
        selected: selected.includes(option.id),
        correct: correct.includes(option.id),
      })),
    };
  }
  if (question.type === "tf") return { kind: "tf", value: typeof value === "boolean" ? value : null, correct: question.config.correct };
  return {
    kind: "text",
    value: typeof value === "string" ? value : "",
    accepted: question.type === "sa" ? question.config.accepted : null,
  };
}

function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null | undefined): Record<string, unknown> {
  const parsed = parseJson(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
