import {
  examDraftSchema,
  type ExamDraft,
  type FullQuestion,
  toStudentQuestions,
} from "@/domain/exam";
import type { Actor } from "@/server/actors";
import { db, type PgStatement } from "@/server/db/client";
import { dispatchRunCommand } from "@/server/exam-run-actor";
import { gradeExam, type AnswerValue } from "@/server/grading";
import { createRunCode } from "@/server/run-code";
import { hashGuestToken, readGuestSession } from "@/server/student-access";

interface ExamRow {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  time_limit_s: number;
  questions_to_serve: number | null;
  long_to_serve: number;
  shuffle_questions: number;
  shuffle_options: number;
  allow_backwards: number;
  show_progress: number;
  auto_submit: number;
  allow_reconnect: number;
  supervision_level: ExamDraft["supervisionLevel"];
  require_fullscreen: number;
  detect_focus_loss: number;
  block_clipboard: number;
  record_disconnects: number;
  violation_action: ExamDraft["violationAction"];
  results_display: ExamDraft["resultsDisplay"];
  results_when: ExamDraft["resultsWhen"];
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
  questions_to_serve: number | null;
  long_to_serve: number;
  shuffle_questions: number;
  shuffle_options: number;
  allow_backwards: number;
  show_progress: number;
  auto_submit: number;
  allow_reconnect: number;
  supervision_level: ExamDraft["supervisionLevel"];
  require_fullscreen: number;
  detect_focus_loss: number;
  block_clipboard: number;
  record_disconnects: number;
  violation_action: ExamDraft["violationAction"];
  results_display: ExamDraft["resultsDisplay"];
  results_when: ExamDraft["resultsWhen"];
  status: "lobby" | "running" | "ended";
  classroom_course_id: string | null;
  classroom_coursework_id: string | null;
  results_published_at: number | null;
  created_at: number;
  started_at: number | null;
  ends_at: number | null;
  ended_at: number | null;
}

interface ParticipantRow {
  id: string;
  run_id: string;
  user_id: string | null;
  display_name: string;
  guest_token_hash: string | null;
  status: "waiting" | "active" | "submitted" | "disconnected";
  submitted_at: number | null;
  submit_reason: string | null;
  last_seen: number;
}

export interface StudentAccess {
  actor: Actor | null;
  request: Request;
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

// Antes esto resolvía un stub de Durable Object y hacía un fetch contra él.
// Ahora el actor de la toma vive en este mismo proceso, así que el comando es
// una llamada a un método: se conserva la firma y el `Response` de retorno para
// no tocar las rutas de la API que ya la usan.
export async function runCommand(runId: string, path: string, body?: unknown) {
  return dispatchRunCommand(runId, path, body);
}

export async function listExams(actor: Actor, query = "", subject = ""): Promise<ExamSummary[]> {
  const result = await db.prepare(
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
  const result = await db.prepare(
    "SELECT DISTINCT subject FROM exams WHERE author_id = ? ORDER BY subject",
  ).bind(actor.id).all<{ subject: string }>();
  return result.results.map((row) => row.subject);
}

export async function getExam(examId: string, actor: Actor): Promise<ExamDraft | null> {
  const [exam, questionResult] = await Promise.all([
    db.prepare(
      "SELECT * FROM exams WHERE id = ? AND author_id = ?",
    ).bind(examId, actor.id).first<ExamRow>(),
    db.prepare(
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
    questionsToServe: exam.questions_to_serve,
    longToServe: exam.long_to_serve,
    shuffleQuestions: Boolean(exam.shuffle_questions),
    shuffleOptions: Boolean(exam.shuffle_options),
    allowBackwards: Boolean(exam.allow_backwards),
    showProgress: Boolean(exam.show_progress),
    autoSubmit: Boolean(exam.auto_submit),
    allowReconnect: Boolean(exam.allow_reconnect),
    supervisionLevel: exam.supervision_level,
    requireFullscreen: Boolean(exam.require_fullscreen),
    detectFocusLoss: Boolean(exam.detect_focus_loss),
    blockClipboard: Boolean(exam.block_clipboard),
    recordDisconnects: Boolean(exam.record_disconnects),
    violationAction: exam.violation_action,
    resultsDisplay: exam.results_display,
    resultsWhen: exam.results_when,
    status: exam.status,
    updatedAt: new Date(exam.updated_at).toISOString(),
    questions: questionResult.results.map(parseQuestion),
  });
}

export async function saveExam(actor: Actor, input: unknown): Promise<ExamDraft> {
  if (!actor.orgId) throw new Error("Tu cuenta todavía no pertenece a una institución");
  const draft = examDraftSchema.parse(input);
  const existing = await db.prepare("SELECT author_id FROM exams WHERE id = ?")
    .bind(draft.id)
    .first<{ author_id: string }>();
  if (existing && existing.author_id !== actor.id) throw new Error("La evaluación pertenece a otro docente");

  const now = Date.now();
  const statements: PgStatement[] = [
    db.prepare(
      `INSERT INTO exams (id, org_id, author_id, title, subject, instructions, time_limit_s, questions_to_serve, long_to_serve, shuffle_questions, shuffle_options,
       allow_backwards, show_progress, auto_submit, allow_reconnect, supervision_level, require_fullscreen, detect_focus_loss,
       block_clipboard, record_disconnects, violation_action, results_display, results_when, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, subject = excluded.subject,
       instructions = excluded.instructions, time_limit_s = excluded.time_limit_s,
       questions_to_serve = excluded.questions_to_serve, long_to_serve = excluded.long_to_serve,
       shuffle_questions = excluded.shuffle_questions, shuffle_options = excluded.shuffle_options,
       allow_backwards = excluded.allow_backwards, show_progress = excluded.show_progress,
       auto_submit = excluded.auto_submit, allow_reconnect = excluded.allow_reconnect,
       supervision_level = excluded.supervision_level, require_fullscreen = excluded.require_fullscreen,
       detect_focus_loss = excluded.detect_focus_loss, block_clipboard = excluded.block_clipboard,
       record_disconnects = excluded.record_disconnects, violation_action = excluded.violation_action,
       results_display = excluded.results_display, results_when = excluded.results_when,
       status = excluded.status, updated_at = excluded.updated_at`,
    ).bind(
      draft.id,
      actor.orgId,
      actor.id,
      draft.title,
      draft.subject,
      draft.instructions,
      draft.timeLimitS,
      draft.questionsToServe,
      draft.longToServe,
      draft.shuffleQuestions ? 1 : 0,
      draft.shuffleOptions ? 1 : 0,
      draft.allowBackwards ? 1 : 0,
      draft.showProgress ? 1 : 0,
      draft.autoSubmit ? 1 : 0,
      draft.allowReconnect ? 1 : 0,
      draft.supervisionLevel,
      draft.requireFullscreen ? 1 : 0,
      draft.detectFocusLoss ? 1 : 0,
      draft.blockClipboard ? 1 : 0,
      draft.recordDisconnects ? 1 : 0,
      draft.violationAction,
      draft.resultsDisplay,
      draft.resultsWhen,
      draft.status,
      now,
      now,
    ),
    db.prepare("DELETE FROM questions WHERE exam_id = ?").bind(draft.id),
  ];
  for (const question of draft.questions) {
    statements.push(
      db.prepare(
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
  await db.batch(statements);
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
  const owned = await db.prepare("SELECT id FROM exams WHERE id = ? AND author_id = ?")
    .bind(examId, actor.id).first<{ id: string }>();
  if (!owned) return false;
  await db.batch([
    db.prepare("UPDATE runs SET exam_id = NULL WHERE exam_id = ?").bind(examId),
    db.prepare("DELETE FROM exams WHERE id = ? AND author_id = ?").bind(examId, actor.id),
  ]);
  return true;
}

export async function createRun(actor: Actor, examId: string) {
  const exam = await getExam(examId, actor);
  if (!exam) return null;
  if (exam.status !== "ready") throw new Error("La evaluación debe estar preparada antes de abrir la sala");

  const runId = crypto.randomUUID();
  let code = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = createRunCode();
    const collision = await db.prepare("SELECT 1 FROM runs WHERE code = ?").bind(candidate).first();
    if (!collision) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error("No se pudo generar un código único");

  const now = Date.now();
  await db.prepare(
    `INSERT INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, questions_to_serve, long_to_serve, shuffle_questions, shuffle_options,
     allow_backwards, show_progress, auto_submit, allow_reconnect, supervision_level, require_fullscreen, detect_focus_loss,
     block_clipboard, record_disconnects, violation_action, results_display, results_when, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lobby', ?)`,
  ).bind(
    runId,
    actor.orgId,
    actor.id,
    exam.id,
    code,
    exam.title,
    JSON.stringify(exam.questions),
    exam.timeLimitS,
    exam.questionsToServe,
    exam.longToServe,
    exam.shuffleQuestions ? 1 : 0,
    exam.shuffleOptions ? 1 : 0,
    exam.allowBackwards ? 1 : 0,
    exam.showProgress ? 1 : 0,
    exam.autoSubmit ? 1 : 0,
    exam.allowReconnect ? 1 : 0,
    exam.supervisionLevel,
    exam.requireFullscreen ? 1 : 0,
    exam.detectFocusLoss ? 1 : 0,
    exam.blockClipboard ? 1 : 0,
    exam.recordDisconnects ? 1 : 0,
    exam.violationAction,
    exam.resultsDisplay,
    exam.resultsWhen,
    now,
  ).run();
  const response = await runCommand(runId, "/initialize", {
    runId,
    title: exam.title,
    timeLimitS: exam.timeLimitS,
    recordDisconnects: exam.recordDisconnects,
  });
  if (!response.ok) throw new Error("No se pudo inicializar la sesión en vivo");
  return { id: runId, code };
}

export async function getRunForTeacher(runId: string, actor: Actor): Promise<RunRow | null> {
  return db.prepare(
    `SELECT r.* FROM runs r
     LEFT JOIN exams e ON e.id = r.exam_id
     WHERE r.id = ? AND COALESCE(r.author_id, e.author_id) = ?`,
  ).bind(runId, actor.id).first<RunRow>();
}

export async function listRuns(actor: Actor): Promise<RunSummary[]> {
  const result = await db.prepare(
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

export async function getJoinableRun(rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const run = await db.prepare("SELECT * FROM runs WHERE code = ? AND status != 'ended'")
    .bind(code)
    .first<RunRow>();
  return run;
}

export async function joinRunByCode(
  actor: Actor | null,
  rawCode: string,
  displayName: string,
  guestTokenHash?: string,
) {
  const run = await getJoinableRun(rawCode);
  if (!run) return null;

  const participantId = crypto.randomUUID();
  const now = Date.now();
  if (actor) {
    await db.prepare(
      `INSERT INTO participants (id, run_id, user_id, display_name, guest_token_hash, status, joined_at, last_seen, late)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(run_id, user_id) DO UPDATE SET display_name = excluded.display_name, last_seen = excluded.last_seen`,
    ).bind(
      participantId,
      run.id,
      actor.id,
      displayName,
      run.status === "running" ? "active" : "waiting",
      now,
      now,
      run.status === "running" ? 1 : 0,
    ).run();
  } else {
    if (!guestTokenHash) throw new Error("Falta la sesión temporal del alumno");
    await db.prepare(
      `INSERT INTO participants (id, run_id, user_id, display_name, guest_token_hash, status, joined_at, last_seen, late)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      participantId,
      run.id,
      displayName,
      guestTokenHash,
      run.status === "running" ? "active" : "waiting",
      now,
      now,
      run.status === "running" ? 1 : 0,
    ).run();
  }
  const participant = actor
    ? await db.prepare("SELECT * FROM participants WHERE run_id = ? AND user_id = ?")
      .bind(run.id, actor.id).first<ParticipantRow>()
    : await db.prepare("SELECT * FROM participants WHERE id = ?")
      .bind(participantId).first<ParticipantRow>();
  if (!participant) throw new Error("No se pudo registrar al alumno");
  await runCommand(run.id, "/join", {
    participantId: participant.id,
    userId: actor?.id ?? participant.id,
    name: participant.display_name,
  });
  return { run, participant };
}

export async function getStudentSession(access: StudentAccess, code: string) {
  const run = await db.prepare("SELECT * FROM runs WHERE code = ?")
    .bind(code.trim().toUpperCase()).first<RunRow>();
  if (!run) return null;
  let participant: ParticipantRow | null = null;
  if (access.actor) {
    participant = await db.prepare(
      "SELECT * FROM participants WHERE run_id = ? AND user_id = ?",
    ).bind(run.id, access.actor.id).first<ParticipantRow>();
  }
  if (!participant) {
    const guest = readGuestSession(access.request);
    if (guest) {
      const tokenHash = await hashGuestToken(guest.token);
      participant = await db.prepare(
        "SELECT * FROM participants WHERE id = ? AND run_id = ? AND guest_token_hash = ?",
      ).bind(guest.participantId, run.id, tokenHash).first<ParticipantRow>();
    }
  }
  if (!participant) return null;
  const answerResult = await db.prepare(
    "SELECT question_id, value FROM answers WHERE participant_id = ?",
  ).bind(participant.id).all<{ question_id: string; value: string }>();
  const fullQuestions = questionsForParticipant(run, participant.id);
  return {
    run,
    participant,
    questions: toStudentQuestions(fullQuestions),
    answers: Object.fromEntries(answerResult.results.map((row) => [row.question_id, JSON.parse(row.value)])),
  };
}

/**
 * Preguntas que efectivamente vio un alumno. Con pozo de preguntas cada alumno
 * recibe un subconjunto distinto, así que corregir, calificar y mostrar respuestas
 * tiene que partir de acá y no del snapshot completo de la toma. Es determinístico:
 * se deriva de (runId, participantId), sin guardar nada extra.
 */
export function questionsForParticipant(
  run: {
    id: string;
    questions_snapshot: string;
    shuffle_questions: number;
    shuffle_options: number;
    questions_to_serve: number | null;
    long_to_serve?: number;
  },
  participantId: string,
): FullQuestion[] {
  return personalizeQuestions(
    JSON.parse(run.questions_snapshot) as FullQuestion[],
    `${run.id}:${participantId}`,
    Boolean(run.shuffle_questions),
    Boolean(run.shuffle_options),
    run.questions_to_serve,
    run.long_to_serve ?? 2,
  );
}

/**
 * Elige las preguntas que recibe un alumno garantizando la cuota de desarrollo.
 *
 * Un sorteo plano sobre el pozo puede dejar a un alumno sin ninguna pregunta para
 * justificar por escrito y a otro con seis. Acá se sortea por separado el grupo de
 * desarrollo y el resto, y después se arma el conjunto final. Si el pozo no tiene
 * suficientes de desarrollo se toman las que haya y se completa con el resto, sin
 * devolver nunca menos preguntas de las pedidas.
 */
function elegirSubconjunto(
  questions: FullQuestion[],
  seed: string,
  total: number,
  longToServe: number,
): FullQuestion[] {
  const desarrollo = questions.filter((question) => question.type === "long");
  const resto = questions.filter((question) => question.type !== "long");

  const cuotaDesarrollo = Math.max(0, Math.min(longToServe, desarrollo.length, total));
  const elegidasDesarrollo = seededShuffle(desarrollo, `${seed}:pool:long`).slice(0, cuotaDesarrollo);
  const elegidasResto = seededShuffle(resto, `${seed}:pool:resto`).slice(0, total - cuotaDesarrollo);

  // Si el resto no alcanza para llenar el cupo, se completa con más de desarrollo.
  const faltan = total - elegidasDesarrollo.length - elegidasResto.length;
  const relleno = faltan > 0
    ? desarrollo.filter((q) => !elegidasDesarrollo.includes(q)).slice(0, faltan)
    : [];

  return [...elegidasDesarrollo, ...elegidasResto, ...relleno];
}

function personalizeQuestions(
  source: FullQuestion[],
  seed: string,
  shuffleQuestions: boolean,
  shuffleOptions: boolean,
  questionsToServe?: number | null,
  longToServe = 2,
) {
  const questions = structuredClone(source);
  // El subconjunto se sortea siempre por alumno, aunque el docente no haya pedido
  // mezclar: es justamente lo que evita que dos alumnos reciban las mismas preguntas.
  const pool = questionsToServe && questionsToServe > 0 && questionsToServe < questions.length
    ? elegirSubconjunto(questions, seed, questionsToServe, longToServe)
    : questions;
  const ordered = shuffleQuestions ? seededShuffle(pool, `${seed}:questions`) : pool;
  return ordered.map((question, position) => {
    const next = { ...question, position } as FullQuestion;
    if (shuffleOptions && (next.type === "mc" || next.type === "ms")) {
      next.config.options = seededShuffle(next.config.options, `${seed}:${next.id}:options`);
    }
    return next;
  });
}

function seededShuffle<T>(source: T[], seed: string) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  const next = [...source];
  for (let index = next.length - 1; index > 0; index -= 1) {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    const target = Math.floor(random * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

export async function participantOwnedBy(participantId: string, access: StudentAccess) {
  if (access.actor) {
    const participant = await db.prepare(
      `SELECT p.*, r.status AS run_status, r.ends_at, r.questions_snapshot,
            r.shuffle_questions, r.shuffle_options, r.questions_to_serve, r.long_to_serve
       FROM participants p JOIN runs r ON r.id = p.run_id
       WHERE p.id = ? AND p.user_id = ?`,
    ).bind(participantId, access.actor.id).first<ParticipantRow & {
      run_status: RunRow["status"];
      ends_at: number | null;
      questions_snapshot: string;
      shuffle_questions: number;
      shuffle_options: number;
      questions_to_serve: number | null;
      long_to_serve: number;
    }>();
    if (participant) return participant;
  }
  const guest = readGuestSession(access.request);
  if (!guest || guest.participantId !== participantId) return null;
  const tokenHash = await hashGuestToken(guest.token);
  return db.prepare(
    `SELECT p.*, r.status AS run_status, r.ends_at, r.questions_snapshot,
            r.shuffle_questions, r.shuffle_options, r.questions_to_serve, r.long_to_serve
     FROM participants p JOIN runs r ON r.id = p.run_id
     WHERE p.id = ? AND p.guest_token_hash = ?`,
  ).bind(participantId, tokenHash).first<ParticipantRow & {
    run_status: RunRow["status"];
    ends_at: number | null;
    questions_snapshot: string;
    shuffle_questions: number;
    shuffle_options: number;
    questions_to_serve: number | null;
    long_to_serve: number;
  }>();
}

export async function saveAnswer(access: StudentAccess, participantId: string, questionId: string, value: AnswerValue) {
  const participant = await participantOwnedBy(participantId, access);
  if (!participant || participant.status === "submitted") return null;
  if (participant.run_status !== "running" || (participant.ends_at !== null && participant.ends_at <= Date.now())) {
    throw new Error("La sesión ya no acepta respuestas");
  }
  const questions = questionsForParticipant(
    { ...participant, id: participant.run_id },
    participant.id,
  );
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error("La pregunta no pertenece a esta sesión");
  const now = Date.now();
  await db.prepare(
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

export async function submitParticipant(access: StudentAccess, participantId: string, reason: "manual" | "timer") {
  const participant = await participantOwnedBy(participantId, access);
  if (!participant) return null;
  if (participant.status === "submitted") return { submittedAt: participant.submitted_at };
  const questions = questionsForParticipant(
    { ...participant, id: participant.run_id },
    participant.id,
  );
  const answerResult = await db.prepare(
    "SELECT question_id, value FROM answers WHERE participant_id = ?",
  ).bind(participantId).all<{ question_id: string; value: string }>();
  const grade = gradeExam(
    questions,
    answerResult.results.map((row) => ({ questionId: row.question_id, value: JSON.parse(row.value) })),
  );
  const now = Date.now();
  const statements: PgStatement[] = [
    db.prepare(
      "UPDATE participants SET status = 'submitted', submitted_at = ?, submit_reason = ?, last_seen = ? WHERE id = ?",
    ).bind(now, reason, now, participantId),
  ];
  for (const questionGrade of grade.questions) {
    statements.push(
      db.prepare(
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
  await db.batch(statements);
  await runCommand(participant.run_id, "/submit", { participantId, reason, at: now });
  return { submittedAt: now, grade };
}

export async function getMonitorSnapshot(runId: string, actor: Actor) {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  const [participantResult, incidentResult, expectedResult] = await Promise.all([
    db.prepare(
      `SELECT p.id, p.status, p.joined_at, p.submitted_at, p.last_seen, p.late,
       p.display_name AS name, u.email,
       (SELECT COUNT(*) FROM answers a WHERE a.participant_id = p.id) AS answered,
       (SELECT SUM(COALESCE(g.points_awarded, 0)) FROM grades g WHERE g.participant_id = p.id) AS score,
       (SELECT COUNT(*) FROM grades g WHERE g.participant_id = p.id AND g.points_awarded IS NULL) AS pending_manual
       FROM participants p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.run_id = ? ORDER BY p.display_name`,
    ).bind(runId).all<Record<string, string | number | null>>(),
    db.prepare(
      `SELECT i.id, i.participant_id, i.at, i.duration_ms, i.type, i.meta, i.source, p.display_name AS name
       FROM incidents i JOIN participants p ON p.id = i.participant_id
       WHERE p.run_id = ? ORDER BY i.at DESC LIMIT 200`,
    ).bind(runId).all<Record<string, string | number>>(),
    db.prepare(
      "SELECT google_user_id, name, email FROM expected_run_students WHERE run_id = ? ORDER BY name",
    ).bind(runId).all<Record<string, string | null>>(),
  ]);
  const allQuestions = JSON.parse(run.questions_snapshot) as FullQuestion[];
  const served = run.questions_to_serve;
  const questionCount = served && served > 0 && served < allQuestions.length ? served : allQuestions.length;
  // Con pozo de preguntas cada alumno recibe un subconjunto propio, y esos
  // subconjuntos pueden sumar puntajes distintos. El porcentaje es entonces lo
  // único comparable entre alumnos, así que se calcula acá contra el máximo real
  // de cada uno en vez de contra un total único de la toma.
  const participants = participantResult.results.map((participant) => {
    const maxPoints = questionsForParticipant(run, String(participant.id))
      .reduce((sum, question) => sum + question.points, 0);
    const score = Number(participant.score ?? 0);
    return {
      ...participant,
      max_points: maxPoints,
      percent: maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0,
    };
  });
  const totalPoints = allQuestions.reduce((sum, question) => sum + question.points, 0);
  return {
    run: { ...run, questions_snapshot: undefined },
    questionCount,
    totalPoints,
    poolSize: allQuestions.length,
    participants,
    incidents: incidentResult.results.map((row) => ({
      ...row,
      meta: typeof row.meta === "string" ? JSON.parse(row.meta) : {},
    })),
    expected: expectedResult.results,
    serverNow: Date.now(),
  };
}

export async function getParticipantDetail(participantId: string, actor: Actor) {
  const participant = await db.prepare(
    `SELECT p.*, r.id AS run_id, r.title, r.questions_snapshot,
            r.shuffle_questions, r.shuffle_options, r.questions_to_serve, r.long_to_serve
     FROM participants p JOIN runs r ON r.id = p.run_id
     LEFT JOIN exams e ON e.id = r.exam_id
     WHERE p.id = ? AND COALESCE(r.author_id, e.author_id) = ?`,
  ).bind(participantId, actor.id).first<ParticipantRow & {
    title: string;
    questions_snapshot: string;
    shuffle_questions: number;
    shuffle_options: number;
    questions_to_serve: number | null;
    long_to_serve: number;
  }>();
  if (!participant) return null;

  const [answerResult, gradeResult, incidentResult] = await Promise.all([
    db.prepare("SELECT question_id, value, updated_at FROM answers WHERE participant_id = ?")
      .bind(participantId).all<{ question_id: string; value: string; updated_at: number }>(),
    db.prepare("SELECT question_id, auto, override, points_awarded FROM grades WHERE participant_id = ?")
      .bind(participantId).all<{ question_id: string; auto: number | null; override: number | null; points_awarded: number | null }>(),
    db.prepare("SELECT id, at, duration_ms, type, meta, source, question_id FROM incidents WHERE participant_id = ? ORDER BY at")
      .bind(participantId).all<{ id: string; at: number; duration_ms: number; type: string; meta: string; source: string; question_id: string | null }>(),
  ]);
  const questions = questionsForParticipant(
    { ...participant, id: participant.run_id },
    participant.id,
  );
  const answersByQuestion = new Map(answerResult.results.map((answer) => [answer.question_id, answer]));
  const gradesByQuestion = new Map(gradeResult.results.map((grade) => [grade.question_id, grade]));
  const questionById = new Map(questions.map((question, index) => [question.id, { ...question, number: index + 1 }]));

  return {
    participant: { id: participant.id, name: participant.display_name, status: participant.status, submittedAt: participant.submitted_at },
    run: { id: participant.run_id, title: participant.title },
    questions: questions.map((question, index) => {
      const answer = answersByQuestion.get(question.id);
      const grade = gradesByQuestion.get(question.id);
      return {
        id: question.id,
        number: index + 1,
        prompt: question.prompt,
        type: question.type,
        points: question.points,
        answer: answer ? JSON.parse(answer.value) : null,
        answerText: answer ? formatAnswer(question, JSON.parse(answer.value)) : "Sin responder",
        correctAnswer: formatCorrectAnswer(question),
        answeredAt: answer?.updated_at ?? null,
        pointsAwarded: grade?.points_awarded ?? null,
        manuallyOverridden: Boolean(grade?.override),
      };
    }),
    incidents: incidentResult.results.map((incident) => {
      const meta = typeof incident.meta === "string" ? JSON.parse(incident.meta) as Record<string, unknown> : {};
      const questionId = incident.question_id ?? (typeof meta.questionId === "string" ? meta.questionId : null);
      const question = questionId ? questionById.get(questionId) : null;
      return { ...incident, meta, questionId, questionNumber: question?.number ?? null, questionPrompt: question?.prompt ?? null };
    }),
  };
}

export async function getRunAnalysisData(runId: string, actor: Actor) {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  const participants = await db.prepare("SELECT id FROM participants WHERE run_id = ? ORDER BY display_name")
    .bind(runId).all<{ id: string }>();
  const details = await Promise.all(participants.results.map((row) => getParticipantDetail(row.id, actor)));
  return { run: { id: run.id, title: run.title, code: run.code }, participants: details.filter(Boolean) };
}

export async function listPendingCorrections(actor: Actor, runId?: string) {
  const result = await db.prepare(
    `SELECT p.id AS participant_id, p.run_id, p.submitted_at, p.display_name AS name, r.title,
      r.questions_snapshot, a.question_id, a.value, g.points_awarded
     FROM participants p
     JOIN runs r ON r.id = p.run_id
     LEFT JOIN exams e ON e.id = r.exam_id
     JOIN answers a ON a.participant_id = p.id
     LEFT JOIN grades g ON g.participant_id = p.id AND g.question_id = a.question_id
     WHERE p.status = 'submitted' AND COALESCE(r.author_id, e.author_id) = ?
       AND (? = '' OR p.run_id = ?)
     ORDER BY p.submitted_at DESC`,
  ).bind(actor.id, runId ?? "", runId ?? "").all<{
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
  const row = await db.prepare(
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
  await db.prepare(
    `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded)
     VALUES (?, ?, ?, NULL, 1, ?)
     ON CONFLICT(participant_id, question_id) DO UPDATE SET override = 1, points_awarded = excluded.points_awarded`,
  ).bind(crypto.randomUUID(), input.participantId, input.questionId, input.pointsAwarded).run();
  return true;
}

/** Cuántas respuestas de desarrollo siguen sin nota en esta toma. */
export async function pendingManualCount(runId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS pending
     FROM participants p JOIN grades g ON g.participant_id = p.id
     WHERE p.run_id = ? AND g.points_awarded IS NULL`,
  ).bind(runId).first<{ pending: number }>();
  return Number(row?.pending ?? 0);
}

/**
 * El "listo" del docente: da la corrección por cerrada. Es lo que habilita
 * mostrarle la nota al alumno y devolverla a Classroom, y por eso exige que no
 * queden desarrollos sin corregir: publicar a medias deja notas que después
 * cambian, y en Classroom eso ya quedó asentado.
 */
export async function publishRunResults(actor: Actor, runId: string) {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  if (run.status !== "ended") throw new Error("La sesión todavía está en curso");

  const pending = await pendingManualCount(runId);
  if (pending > 0) {
    throw new Error(`Faltan corregir ${pending} respuesta${pending === 1 ? "" : "s"} de desarrollo`);
  }

  const now = run.results_published_at ?? Date.now();
  if (!run.results_published_at) {
    await db.prepare("UPDATE runs SET results_published_at = ? WHERE id = ?").bind(now, runId).run();
  }
  return {
    publishedAt: now,
    alreadyPublished: Boolean(run.results_published_at),
    classroomLinked: Boolean(run.classroom_course_id && run.classroom_coursework_id),
  };
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

function formatAnswer(question: FullQuestion, value: AnswerValue): string {
  if (question.type === "mc") return question.config.options.find((option) => option.id === value)?.text ?? String(value ?? "");
  if (question.type === "ms") {
    const selected = Array.isArray(value) ? value : [];
    return question.config.options.filter((option) => selected.includes(option.id)).map((option) => option.text).join(", ") || "Sin responder";
  }
  if (question.type === "tf") return value === true ? "Verdadero" : value === false ? "Falso" : "Sin responder";
  return String(value ?? "Sin responder");
}

function formatCorrectAnswer(question: FullQuestion): string | null {
  if (question.type === "mc") return question.config.options.find((option) => option.id === question.config.correctOptionId)?.text ?? null;
  if (question.type === "ms") return question.config.options.filter((option) => question.config.correctOptionIds.includes(option.id)).map((option) => option.text).join(", ");
  if (question.type === "tf") return question.config.correct ? "Verdadero" : "Falso";
  if (question.type === "sa") return question.config.accepted.join(" / ");
  return null;
}

// --- Consola de plataforma --------------------------------------------------
//
// Todo lo de arriba filtra por `actor` (su organizacion, sus evaluaciones). Lo
// que sigue NO filtra por nada a proposito: es la vista de superadmin. Por eso
// vive junto y separado, y las rutas que lo usan chequean `isSuperadmin` antes
// de llamar.

export interface PlatformOrganization {
  id: string;
  name: string;
  google_domain: string | null;
  created_at: number;
  teachers: number;
  students: number;
  exams: number;
  runs: number;
  live_runs: number;
}

export interface PlatformLiveRun {
  id: string;
  code: string;
  title: string;
  status: "lobby" | "running";
  started_at: number | null;
  ends_at: number | null;
  created_at: number;
  org_name: string | null;
  teacher_name: string | null;
  teacher_email: string | null;
  participants: number;
  active: number;
  submitted: number;
}

export async function getPlatformOverview() {
  // Los conteos van como subconsultas y no como JOIN + COUNT DISTINCT: un JOIN
  // multiplica filas y los totales salen inflados.
  const organizations = await db.prepare(
    `SELECT o.id, o.name, o.google_domain, o.created_at,
       (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.role = 'teacher') AS teachers,
       (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.role = 'student') AS students,
       (SELECT COUNT(*) FROM exams e WHERE e.org_id = o.id) AS exams,
       (SELECT COUNT(*) FROM runs r WHERE r.org_id = o.id) AS runs,
       (SELECT COUNT(*) FROM runs r WHERE r.org_id = o.id AND r.status IN ('lobby','running')) AS live_runs
     FROM organizations o
     ORDER BY o.name`,
  ).all<PlatformOrganization>();

  const liveRuns = await db.prepare(
    `SELECT r.id, r.code, r.title, r.status, r.started_at, r.ends_at, r.created_at,
       o.name AS org_name, u.name AS teacher_name, u.email AS teacher_email,
       (SELECT COUNT(*) FROM participants p WHERE p.run_id = r.id) AS participants,
       (SELECT COUNT(*) FROM participants p WHERE p.run_id = r.id AND p.status = 'active') AS active,
       (SELECT COUNT(*) FROM participants p WHERE p.run_id = r.id AND p.status = 'submitted') AS submitted
     FROM runs r
     LEFT JOIN organizations o ON o.id = r.org_id
     LEFT JOIN users u ON u.id = r.author_id
     WHERE r.status IN ('lobby','running')
     ORDER BY r.status DESC, r.created_at DESC`,
  ).all<PlatformLiveRun>();

  const totals = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM organizations) AS organizations,
       (SELECT COUNT(*) FROM users WHERE role = 'teacher') AS teachers,
       (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
       (SELECT COUNT(*) FROM exams) AS exams,
       (SELECT COUNT(*) FROM runs) AS runs,
       (SELECT COUNT(*) FROM participants) AS participants,
       (SELECT COUNT(*) FROM answers) AS answers,
       (SELECT COUNT(*) FROM runs WHERE status IN ('lobby','running')) AS live_runs`,
  ).first<{
    organizations: number; teachers: number; students: number; exams: number;
    runs: number; participants: number; answers: number; live_runs: number;
  }>();

  const recentRuns = await db.prepare(
    `SELECT r.id, r.code, r.title, r.status, r.created_at, r.ended_at, r.results_published_at,
       o.name AS org_name, u.name AS teacher_name,
       (SELECT COUNT(*) FROM participants p WHERE p.run_id = r.id) AS participants
     FROM runs r
     LEFT JOIN organizations o ON o.id = r.org_id
     LEFT JOIN users u ON u.id = r.author_id
     WHERE r.status = 'ended'
     ORDER BY COALESCE(r.ended_at, r.created_at) DESC
     LIMIT 12`,
  ).all<{
    id: string; code: string; title: string; status: string; created_at: number;
    ended_at: number | null; results_published_at: number | null;
    org_name: string | null; teacher_name: string | null; participants: number;
  }>();

  return {
    organizations: organizations.results,
    liveRuns: liveRuns.results,
    recentRuns: recentRuns.results,
    totals: totals ?? {
      organizations: 0, teachers: 0, students: 0, exams: 0,
      runs: 0, participants: 0, answers: 0, live_runs: 0,
    },
    serverNow: Date.now(),
  };
}

export type PlatformOverview = Awaited<ReturnType<typeof getPlatformOverview>>;
