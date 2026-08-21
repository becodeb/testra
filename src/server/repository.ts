import { env } from "cloudflare:workers";

import {
  examDraftSchema,
  type ExamDraft,
  type FullQuestion,
  toStudentQuestions,
} from "@/domain/exam";
import type { Actor } from "@/server/actors";
import { gradeExam, type AnswerValue } from "@/server/grading";
import { createRunCode } from "@/server/run-code";

const runtimeEnv = env as unknown as CloudflareEnv;

interface ExamRow {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  time_limit_s: number;
  status: "draft" | "ready";
  updated_at: number;
}

interface QuestionRow {
  id: string;
  position: number;
  type: FullQuestion["type"];
  prompt: string;
  points: number;
  config: string;
}

interface RunRow {
  id: string;
  exam_id: string | null;
  org_id: string | null;
  author_id: string | null;
  code: string;
  title: string;
  questions_snapshot: string;
  time_limit_s: number;
  status: "lobby" | "running" | "ended";
  classroom_course_id: string | null;
  classroom_coursework_id: string | null;
  created_at: number;
  started_at: number | null;
  ends_at: number | null;
  ended_at: number | null;
}

interface ParticipantRow {
  id: string;
  run_id: string;
  user_id: string;
  status: "waiting" | "active" | "submitted" | "disconnected";
  submitted_at: number | null;
  submit_reason: string | null;
  last_seen: number;
}

export interface ExamSummary {
  id: string;
  title: string;
  subject: string;
  status: "draft" | "ready";
  questionCount: number;
  totalPoints: number;
  runCount: number;
  lastRunAt: number | null;
  updatedAt: number;
}

export interface RunSummary {
  id: string;
  title: string;
  code: string;
  status: RunRow["status"];
  createdAt: number;
  participantCount: number;
  average: number | null;
  incidentCount: number;
}

export function examRunStub(runId: string) {
  const id = runtimeEnv.EXAM_RUNS.idFromName(runId);
  return runtimeEnv.EXAM_RUNS.get(id);
}

export async function runCommand(
  runId: string,
  path: string,
  body?: unknown,
  headers?: Headers,
) {
  const forwarded = new Headers(headers);
  if (body !== undefined) forwarded.set("content-type", "application/json");
  const target = new URL(`https://exam-run.internal${path}`);
  target.searchParams.set("runId", runId);
  return examRunStub(runId).fetch(target, {
    method: body === undefined ? "GET" : "POST",
    headers: forwarded,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function listExams(actor: Actor, query = "", subject = ""): Promise<ExamSummary[]> {
  const result = await runtimeEnv.DB.prepare(
    `SELECT e.id, e.title, e.subject, e.status, e.updated_at,
      COUNT(DISTINCT q.id) AS question_count,
      COALESCE(SUM(DISTINCT CASE WHEN q.id IS NOT NULL THEN q.points * 1000000 + q.position ELSE NULL END), 0) AS encoded_points,
      COUNT(DISTINCT r.id) AS run_count,
      MAX(r.created_at) AS last_run_at
     FROM exams e
     LEFT JOIN questions q ON q.exam_id = e.id
     LEFT JOIN runs r ON r.exam_id = e.id
     WHERE e.author_id = ? AND e.title LIKE ? AND (? = '' OR e.subject = ?)
     GROUP BY e.id
     ORDER BY e.updated_at DESC`,
  )
    .bind(actor.id, `%${query}%`, subject, subject)
    .all<{
      id: string;
      title: string;
      subject: string;
      status: "draft" | "ready";
      updated_at: number;
      question_count: number;
      encoded_points: number;
      run_count: number;
      last_run_at: number | null;
    }>();

  // The encoded aggregate keeps points correct when a run join multiplies question rows.
  return result.results.map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject,
    status: row.status,
    questionCount: Number(row.question_count),
    totalPoints: Math.floor(Number(row.encoded_points) / 1_000_000),
    runCount: Number(row.run_count),
    lastRunAt: row.last_run_at,
    updatedAt: row.updated_at,
  }));
}

export async function listSubjects(actor: Actor): Promise<string[]> {
  const result = await runtimeEnv.DB.prepare(
    "SELECT DISTINCT subject FROM exams WHERE author_id = ? ORDER BY subject",
  ).bind(actor.id).all<{ subject: string }>();
  return result.results.map((row) => row.subject);
}

export async function getExam(examId: string, actor: Actor): Promise<ExamDraft | null> {
  const [exam, questionResult] = await Promise.all([
    runtimeEnv.DB.prepare(
      "SELECT id, title, subject, instructions, time_limit_s, status, updated_at FROM exams WHERE id = ? AND author_id = ?",
    ).bind(examId, actor.id).first<ExamRow>(),
    runtimeEnv.DB.prepare(
      "SELECT id, position, type, prompt, points, config FROM questions WHERE exam_id = ? ORDER BY position",
    ).bind(examId).all<QuestionRow>(),
  ]);
  if (!exam) return null;
  return examDraftSchema.parse({
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    instructions: exam.instructions,
    timeLimitS: exam.time_limit_s,
    status: exam.status,
    updatedAt: new Date(exam.updated_at).toISOString(),
    questions: questionResult.results.map(parseQuestion),
  });
}

export async function saveExam(actor: Actor, input: unknown): Promise<ExamDraft> {
  if (!actor.orgId) throw new Error("Tu cuenta todavía no pertenece a una institución");
  const draft = examDraftSchema.parse(input);
  const existing = await runtimeEnv.DB.prepare("SELECT author_id FROM exams WHERE id = ?")
    .bind(draft.id)
    .first<{ author_id: string }>();
  if (existing && existing.author_id !== actor.id) throw new Error("La evaluación pertenece a otro docente");

  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    runtimeEnv.DB.prepare(
      `INSERT INTO exams (id, org_id, author_id, title, subject, instructions, time_limit_s, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, subject = excluded.subject,
       instructions = excluded.instructions, time_limit_s = excluded.time_limit_s,
       status = excluded.status, updated_at = excluded.updated_at`,
    ).bind(
      draft.id,
      actor.orgId,
      actor.id,
      draft.title,
      draft.subject,
      draft.instructions,
      draft.timeLimitS,
      draft.status,
      now,
      now,
    ),
    runtimeEnv.DB.prepare("DELETE FROM questions WHERE exam_id = ?").bind(draft.id),
  ];
  for (const question of draft.questions) {
    statements.push(
      runtimeEnv.DB.prepare(
        "INSERT INTO questions (id, exam_id, position, type, prompt, points, config) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        question.id,
        draft.id,
        question.position,
        question.type,
        question.prompt,
        question.points,
        JSON.stringify(question.config),
      ),
    );
  }
  await runtimeEnv.DB.batch(statements);
  return { ...draft, updatedAt: new Date(now).toISOString() };
}

export async function duplicateExam(examId: string, actor: Actor): Promise<ExamDraft | null> {
  const source = await getExam(examId, actor);
  if (!source) return null;
  const copyId = crypto.randomUUID();
  return saveExam(actor, {
    ...source,
    id: copyId,
    title: `${source.title} — copia`,
    status: "draft",
    updatedAt: new Date().toISOString(),
    questions: source.questions.map((question, position) => ({
      ...question,
      id: crypto.randomUUID(),
      position,
    })),
  });
}

export async function deleteExam(examId: string, actor: Actor): Promise<boolean> {
  const result = await runtimeEnv.DB.prepare("DELETE FROM exams WHERE id = ? AND author_id = ?")
    .bind(examId, actor.id)
    .run();
  return Boolean(result.meta.changes);
}

export async function createRun(actor: Actor, examId: string) {
  const exam = await getExam(examId, actor);
  if (!exam) return null;
  if (exam.status !== "ready") throw new Error("La evaluación debe estar lista antes de tomarla");

  const runId = crypto.randomUUID();
  let code = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = createRunCode();
    const collision = await runtimeEnv.DB.prepare("SELECT 1 FROM runs WHERE code = ?").bind(candidate).first();
    if (!collision) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error("No se pudo generar un código único");

  const now = Date.now();
  await runtimeEnv.DB.prepare(
    `INSERT INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lobby', ?)`,
  ).bind(
    runId,
    actor.orgId,
    actor.id,
    exam.id,
    code,
    exam.title,
    JSON.stringify(exam.questions),
    exam.timeLimitS,
    now,
  ).run();
  const response = await runCommand(runId, "/initialize", {
    runId,
    title: exam.title,
    timeLimitS: exam.timeLimitS,
  });
  if (!response.ok) throw new Error("No se pudo inicializar la toma en vivo");
  return { id: runId, code };
}

export async function getRunForTeacher(runId: string, actor: Actor): Promise<RunRow | null> {
  return runtimeEnv.DB.prepare(
    `SELECT r.* FROM runs r
     LEFT JOIN exams e ON e.id = r.exam_id
     WHERE r.id = ? AND COALESCE(r.author_id, e.author_id) = ?`,
  ).bind(runId, actor.id).first<RunRow>();
}

export async function listRuns(actor: Actor): Promise<RunSummary[]> {
  const result = await runtimeEnv.DB.prepare(
    `WITH participant_scores AS (
       SELECT p.id, p.run_id, SUM(COALESCE(g.points_awarded, 0)) AS score
       FROM participants p LEFT JOIN grades g ON g.participant_id = p.id
       WHERE p.status = 'submitted' GROUP BY p.id
     ), score_totals AS (
       SELECT run_id, COUNT(*) AS participant_count, AVG(score) AS average FROM participant_scores GROUP BY run_id
     ), incident_totals AS (
       SELECT p.run_id, COUNT(i.id) AS incident_count FROM participants p
       JOIN incidents i ON i.participant_id = p.id GROUP BY p.run_id
     )
     SELECT r.id, r.title, r.code, r.status, r.created_at,
      COALESCE(s.participant_count, 0) AS participant_count,
      COALESCE(i.incident_count, 0) AS incident_count,
      s.average
     FROM runs r
     LEFT JOIN exams e ON e.id = r.exam_id
     LEFT JOIN score_totals s ON s.run_id = r.id
     LEFT JOIN incident_totals i ON i.run_id = r.id
     WHERE COALESCE(r.author_id, e.author_id) = ?
     ORDER BY r.created_at DESC`,
  ).bind(actor.id).all<{
    id: string;
    title: string;
    code: string;
    status: RunRow["status"];
    created_at: number;
    participant_count: number;
    incident_count: number;
    average: number | null;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    title: row.title,
    code: row.code,
    status: row.status,
    createdAt: row.created_at,
    participantCount: Number(row.participant_count),
    average: row.average === null ? null : Number(row.average),
    incidentCount: Number(row.incident_count),
  }));
}

export async function joinRunByCode(actor: Actor, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const run = await runtimeEnv.DB.prepare("SELECT * FROM runs WHERE code = ? AND status != 'ended'")
    .bind(code)
    .first<RunRow>();
  if (!run) return null;
  if (run.org_id && actor.orgId && run.org_id !== actor.orgId) return null;

  const participantId = crypto.randomUUID();
  const now = Date.now();
  await runtimeEnv.DB.prepare(
    `INSERT INTO participants (id, run_id, user_id, status, joined_at, last_seen, late)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, user_id) DO UPDATE SET last_seen = excluded.last_seen`,
  ).bind(
    participantId,
    run.id,
    actor.id,
    run.status === "running" ? "active" : "waiting",
    now,
    now,
    run.status === "running" ? 1 : 0,
  ).run();
  const participant = await runtimeEnv.DB.prepare(
    "SELECT * FROM participants WHERE run_id = ? AND user_id = ?",
  ).bind(run.id, actor.id).first<ParticipantRow>();
  if (!participant) throw new Error("No se pudo registrar al alumno");
  await runCommand(run.id, "/join", {
    participantId: participant.id,
    userId: actor.id,
    name: actor.name,
  });
  return { run, participant };
}

export async function getStudentSession(actor: Actor, code: string) {
  const joined = await joinRunByCode(actor, code);
  if (!joined) return null;
  const answerResult = await runtimeEnv.DB.prepare(
    "SELECT question_id, value FROM answers WHERE participant_id = ?",
  ).bind(joined.participant.id).all<{ question_id: string; value: string }>();
  const fullQuestions = JSON.parse(joined.run.questions_snapshot) as FullQuestion[];
  return {
    run: joined.run,
    participant: joined.participant,
    questions: toStudentQuestions(fullQuestions),
    answers: Object.fromEntries(answerResult.results.map((row) => [row.question_id, JSON.parse(row.value)])),
  };
}

export async function participantOwnedBy(participantId: string, actor: Actor) {
  return runtimeEnv.DB.prepare(
    `SELECT p.*, r.status AS run_status, r.ends_at, r.questions_snapshot
     FROM participants p JOIN runs r ON r.id = p.run_id
     WHERE p.id = ? AND p.user_id = ?`,
  ).bind(participantId, actor.id).first<ParticipantRow & {
    run_status: RunRow["status"];
    ends_at: number | null;
    questions_snapshot: string;
  }>();
}

export async function saveAnswer(actor: Actor, participantId: string, questionId: string, value: AnswerValue) {
  const participant = await participantOwnedBy(participantId, actor);
  if (!participant || participant.status === "submitted") return null;
  if (participant.run_status !== "running" || (participant.ends_at !== null && participant.ends_at <= Date.now())) {
    throw new Error("La toma ya no acepta respuestas");
  }
  const questions = JSON.parse(participant.questions_snapshot) as FullQuestion[];
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error("La pregunta no pertenece a esta toma");
  const now = Date.now();
  await runtimeEnv.DB.prepare(
    `INSERT INTO answers (id, participant_id, question_id, value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(participant_id, question_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), participantId, questionId, JSON.stringify(value), now).run();
  await runCommand(participant.run_id, "/answer-saved", {
    participantId,
    questionId,
    questionType: question.type,
    at: now,
  });
  return { updatedAt: now };
}

export async function submitParticipant(actor: Actor, participantId: string, reason: "manual" | "timer") {
  const participant = await participantOwnedBy(participantId, actor);
  if (!participant) return null;
  if (participant.status === "submitted") return { submittedAt: participant.submitted_at };
  const questions = JSON.parse(participant.questions_snapshot) as FullQuestion[];
  const answerResult = await runtimeEnv.DB.prepare(
    "SELECT question_id, value FROM answers WHERE participant_id = ?",
  ).bind(participantId).all<{ question_id: string; value: string }>();
  const grade = gradeExam(
    questions,
    answerResult.results.map((row) => ({ questionId: row.question_id, value: JSON.parse(row.value) })),
  );
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    runtimeEnv.DB.prepare(
      "UPDATE participants SET status = 'submitted', submitted_at = ?, submit_reason = ?, last_seen = ? WHERE id = ?",
    ).bind(now, reason, now, participantId),
  ];
  for (const questionGrade of grade.questions) {
    statements.push(
      runtimeEnv.DB.prepare(
        `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(participant_id, question_id) DO UPDATE SET auto = excluded.auto, points_awarded = excluded.points_awarded`,
      ).bind(
        crypto.randomUUID(),
        participantId,
        questionGrade.questionId,
        questionGrade.auto === null ? null : questionGrade.auto ? 1 : 0,
        questionGrade.pointsAwarded,
      ),
    );
  }
  await runtimeEnv.DB.batch(statements);
  await runCommand(participant.run_id, "/submit", { participantId, reason, at: now });
  return { submittedAt: now, grade };
}

export async function getMonitorSnapshot(runId: string, actor: Actor) {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  const [participantResult, incidentResult, expectedResult] = await Promise.all([
    runtimeEnv.DB.prepare(
      `SELECT p.id, p.status, p.joined_at, p.submitted_at, p.last_seen, p.late,
       u.name, u.email,
       (SELECT COUNT(*) FROM answers a WHERE a.participant_id = p.id) AS answered,
       (SELECT SUM(COALESCE(g.points_awarded, 0)) FROM grades g WHERE g.participant_id = p.id) AS score,
       (SELECT COUNT(*) FROM grades g WHERE g.participant_id = p.id AND g.points_awarded IS NULL) AS pending_manual
       FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.run_id = ? ORDER BY u.name`,
    ).bind(runId).all<Record<string, string | number | null>>(),
    runtimeEnv.DB.prepare(
      `SELECT i.id, i.participant_id, i.at, i.duration_ms, i.type, i.meta, i.source, u.name
       FROM incidents i JOIN participants p ON p.id = i.participant_id
       JOIN users u ON u.id = p.user_id WHERE p.run_id = ? ORDER BY i.at DESC LIMIT 200`,
    ).bind(runId).all<Record<string, string | number>>(),
    runtimeEnv.DB.prepare(
      "SELECT google_user_id, name, email FROM expected_run_students WHERE run_id = ? ORDER BY name",
    ).bind(runId).all<Record<string, string | null>>(),
  ]);
  const questionCount = (JSON.parse(run.questions_snapshot) as FullQuestion[]).length;
  return {
    run: { ...run, questions_snapshot: undefined },
    questionCount,
    participants: participantResult.results,
    incidents: incidentResult.results.map((row) => ({
      ...row,
      meta: typeof row.meta === "string" ? JSON.parse(row.meta) : {},
    })),
    expected: expectedResult.results,
    serverNow: Date.now(),
  };
}

export async function listPendingCorrections(actor: Actor) {
  const result = await runtimeEnv.DB.prepare(
    `SELECT p.id AS participant_id, p.run_id, p.submitted_at, u.name, r.title,
      r.questions_snapshot, a.question_id, a.value, g.points_awarded
     FROM participants p
     JOIN users u ON u.id = p.user_id
     JOIN runs r ON r.id = p.run_id
     LEFT JOIN exams e ON e.id = r.exam_id
     JOIN answers a ON a.participant_id = p.id
     LEFT JOIN grades g ON g.participant_id = p.id AND g.question_id = a.question_id
     WHERE p.status = 'submitted' AND COALESCE(r.author_id, e.author_id) = ?
     ORDER BY p.submitted_at DESC`,
  ).bind(actor.id).all<{
    participant_id: string;
    run_id: string;
    submitted_at: number;
    name: string;
    title: string;
    questions_snapshot: string;
    question_id: string;
    value: string;
    points_awarded: number | null;
  }>();
  return result.results.flatMap((row) => {
    const question = (JSON.parse(row.questions_snapshot) as FullQuestion[]).find(
      (candidate) => candidate.id === row.question_id && candidate.type === "long",
    );
    if (!question) return [];
    return [{
      participantId: row.participant_id,
      runId: row.run_id,
      studentName: row.name,
      runTitle: row.title,
      submittedAt: row.submitted_at,
      questionId: question.id,
      prompt: question.prompt,
      maxPoints: question.points,
      answer: JSON.parse(row.value) as string,
      pointsAwarded: row.points_awarded,
    }];
  });
}

export async function saveManualGrade(
  actor: Actor,
  input: { participantId: string; questionId: string; pointsAwarded: number },
) {
  const row = await runtimeEnv.DB.prepare(
    `SELECT r.questions_snapshot FROM participants p JOIN runs r ON r.id = p.run_id
     LEFT JOIN exams e ON e.id = r.exam_id
     WHERE p.id = ? AND COALESCE(r.author_id, e.author_id) = ?`,
  ).bind(input.participantId, actor.id).first<{ questions_snapshot: string }>();
  if (!row) return false;
  const question = (JSON.parse(row.questions_snapshot) as FullQuestion[]).find(
    (candidate) => candidate.id === input.questionId && candidate.type === "long",
  );
  if (!question || input.pointsAwarded < 0 || input.pointsAwarded > question.points) {
    throw new Error("El puntaje está fuera del rango permitido");
  }
  await runtimeEnv.DB.prepare(
    `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded)
     VALUES (?, ?, ?, NULL, 1, ?)
     ON CONFLICT(participant_id, question_id) DO UPDATE SET override = 1, points_awarded = excluded.points_awarded`,
  ).bind(crypto.randomUUID(), input.participantId, input.questionId, input.pointsAwarded).run();
  return true;
}

function parseQuestion(row: QuestionRow): FullQuestion {
  return {
    id: row.id,
    position: row.position,
    type: row.type,
    prompt: row.prompt,
    points: row.points,
    config: JSON.parse(row.config),
  } as FullQuestion;
}
