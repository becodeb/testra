import {
  examDraftSchema,
  type ExamDraft,
  type FullQuestion,
  toStudentQuestions,
} from "@/domain/exam";
import type { Actor } from "@/server/actors";
import { db, type PgStatement } from "@/server/db/client";
import { dispatchRunCommand } from "@/server/exam-run-actor";
import { personalizeQuestions } from "@/domain/pool";
import { gradeExam, type AnswerValue } from "@/server/grading";
import { createRunCode } from "@/server/run-code";
import { hashGuestToken, readGuestSession } from "@/server/student-access";
import { getExamCapabilities, getRunCapabilities } from "@/server/exam-permissions";
import { buildExamAnalytics, type AnalyticsAttempt } from "@/server/analytics";
import { normalizeStudentEmail } from "@/lib/student-identity";
import { syncAutomaticClassroomGrade } from "@/server/classroom-submission-service";
import { asyncAttemptDeadline, asyncAvailabilityState } from "@/server/run-time";

interface ExamRow {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  time_limit_s: number;
  delivery_mode: ExamDraft["deliveryMode"];
  available_from: number | null;
  available_until: number | null;
  ai_grading_mode: ExamDraft["aiGradingMode"];
  questions_to_serve: number | null;
  long_to_serve: number;
  section_quotas: string;
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
  passing_score_percent: number | null;
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
  section: string | null;
  difficulty: FullQuestion["difficulty"] | null;
  assets: string;
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
  delivery_mode: ExamDraft["deliveryMode"];
  available_from: number | null;
  available_until: number | null;
  ai_grading_mode: ExamDraft["aiGradingMode"];
  questions_to_serve: number | null;
  long_to_serve: number;
  section_quotas: string;
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
  passing_score_percent: number | null;
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
  status: "waiting" | "active" | "submitted" | "disconnected" | "expired";
  submitted_at: number | null;
  attempt_started_at: number | null;
  submit_reason: string | null;
  classroom_google_user_id: string | null;
  classroom_email: string | null;
  extra_time_s: number;
  deadline_at: number | null;
  reopened_count: number;
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
  ownerName: string;
  accessRole: "owner" | "view" | "edit" | "correct";
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
  deliveryMode: RunRow["delivery_mode"];
  availableFrom: number | null;
  availableUntil: number | null;
  /** Respuestas que todavia esperan correccion. Ordena la bandeja por trabajo. */
  pendingCorrections: number;
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
    `SELECT e.id, e.title, e.subject, e.status, e.updated_at, owner.name AS owner_name,
      CASE WHEN e.author_id = ? THEN 'owner' ELSE c.permission END AS access_role,
      (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
      (SELECT COALESCE(SUM(q.points), 0) FROM questions q WHERE q.exam_id = e.id) AS total_points,
      (SELECT COUNT(*) FROM runs r WHERE r.exam_id = e.id) AS run_count,
      (SELECT MAX(r.created_at) FROM runs r WHERE r.exam_id = e.id) AS last_run_at
     FROM exams e
     JOIN users owner ON owner.id = e.author_id
     LEFT JOIN exam_collaborators c ON c.exam_id = e.id AND c.user_id = ?
     WHERE (e.author_id = ? OR c.user_id IS NOT NULL)
       AND lower(e.title) LIKE lower(?) AND (? = '' OR e.subject = ?)
     ORDER BY e.updated_at DESC`,
  )
    .bind(actor.id, actor.id, actor.id, `%${query}%`, subject, subject)
    .all<{
      id: string;
      title: string;
      subject: string;
      status: "draft" | "ready";
      updated_at: number;
      question_count: number;
      total_points: number;
      run_count: number;
      last_run_at: number | null;
      owner_name: string;
      access_role: "owner" | "view" | "edit" | "correct";
    }>();

  return result.results.map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject,
    status: row.status,
    questionCount: Number(row.question_count),
    totalPoints: Number(row.total_points),
    runCount: Number(row.run_count),
    lastRunAt: row.last_run_at,
    updatedAt: row.updated_at,
    ownerName: row.owner_name,
    accessRole: row.access_role,
  }));
}

export async function listSubjects(actor: Actor): Promise<string[]> {
  const result = await db.prepare(
    `SELECT DISTINCT e.subject FROM exams e
     LEFT JOIN exam_collaborators c ON c.exam_id = e.id AND c.user_id = ?
     WHERE e.author_id = ? OR c.user_id IS NOT NULL ORDER BY e.subject`,
  ).bind(actor.id, actor.id).all<{ subject: string }>();
  return result.results.map((row) => row.subject);
}

export async function getExam(examId: string, actor: Actor): Promise<ExamDraft | null> {
  const capabilities = await getExamCapabilities(examId, actor);
  if (!capabilities.view) return null;
  const [exam, questionResult] = await Promise.all([
    db.prepare("SELECT * FROM exams WHERE id = ?").bind(examId).first<ExamRow>(),
    db.prepare(
      "SELECT id, position, type, prompt, points, config, section, difficulty, assets FROM questions WHERE exam_id = ? ORDER BY position",
    ).bind(examId).all<QuestionRow>(),
  ]);
  if (!exam) return null;
  return examDraftSchema.parse({
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    instructions: exam.instructions,
    timeLimitS: exam.time_limit_s,
    deliveryMode: exam.delivery_mode,
    availableFrom: exam.available_from === null ? null : new Date(exam.available_from).toISOString(),
    availableUntil: exam.available_until === null ? null : new Date(exam.available_until).toISOString(),
    aiGradingMode: exam.ai_grading_mode,
    questionsToServe: exam.questions_to_serve,
    longToServe: exam.long_to_serve,
    sectionQuotas: safeQuotas(exam.section_quotas),
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
    passingScorePercent: exam.passing_score_percent,
    status: exam.status,
    updatedAt: new Date(exam.updated_at).toISOString(),
    questions: questionResult.results.map(parseQuestion),
  });
}

export async function saveExam(actor: Actor, input: unknown): Promise<ExamDraft> {
  const draft = examDraftSchema.parse(input);
  const existing = await db.prepare("SELECT author_id FROM exams WHERE id = ?")
    .bind(draft.id)
    .first<{ author_id: string }>();
  if (existing) {
    const capabilities = await getExamCapabilities(draft.id, actor);
    if (!capabilities.edit) throw new Error("No tenés permiso para editar esta evaluación");
  }

  const now = Date.now();
  const statements: PgStatement[] = [
    db.prepare(
      `INSERT INTO exams (id, org_id, author_id, title, subject, instructions, time_limit_s, delivery_mode, available_from, available_until, ai_grading_mode, questions_to_serve, long_to_serve, section_quotas, shuffle_questions, shuffle_options,
       allow_backwards, show_progress, auto_submit, allow_reconnect, supervision_level, require_fullscreen, detect_focus_loss,
       block_clipboard, record_disconnects, violation_action, results_display, results_when, passing_score_percent, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, subject = excluded.subject,
       instructions = excluded.instructions, time_limit_s = excluded.time_limit_s,
       delivery_mode = excluded.delivery_mode, available_from = excluded.available_from,
       available_until = excluded.available_until, ai_grading_mode = excluded.ai_grading_mode,
       questions_to_serve = excluded.questions_to_serve, long_to_serve = excluded.long_to_serve,
       section_quotas = excluded.section_quotas,
       shuffle_questions = excluded.shuffle_questions, shuffle_options = excluded.shuffle_options,
       allow_backwards = excluded.allow_backwards, show_progress = excluded.show_progress,
       auto_submit = excluded.auto_submit, allow_reconnect = excluded.allow_reconnect,
       supervision_level = excluded.supervision_level, require_fullscreen = excluded.require_fullscreen,
       detect_focus_loss = excluded.detect_focus_loss, block_clipboard = excluded.block_clipboard,
       record_disconnects = excluded.record_disconnects, violation_action = excluded.violation_action,
       results_display = excluded.results_display, results_when = excluded.results_when,
       passing_score_percent = excluded.passing_score_percent,
       status = excluded.status, updated_at = excluded.updated_at`,
    ).bind(
      draft.id,
      actor.orgId,
      actor.id,
      draft.title,
      draft.subject,
      draft.instructions,
      draft.timeLimitS,
      draft.deliveryMode,
      draft.availableFrom ? Date.parse(draft.availableFrom) : null,
      draft.availableUntil ? Date.parse(draft.availableUntil) : null,
      draft.aiGradingMode,
      draft.questionsToServe,
      draft.longToServe,
      JSON.stringify(draft.sectionQuotas ?? {}),
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
      draft.passingScorePercent ?? null,
      draft.status,
      now,
      now,
    ),
    db.prepare("DELETE FROM questions WHERE exam_id = ?").bind(draft.id),
  ];
  for (const question of draft.questions) {
    statements.push(
      db.prepare(
        "INSERT INTO questions (id, exam_id, position, type, prompt, points, config, section, difficulty, assets) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        question.id,
        draft.id,
        question.position,
        question.type,
        question.prompt,
        question.points,
        JSON.stringify(question.config),
        question.section || null,
        question.difficulty ?? null,
        JSON.stringify(question.assets ?? []),
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
  const capabilities = await getExamCapabilities(examId, actor);
  if (!capabilities.openRuns) return null;
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
  const availableFrom = exam.availableFrom ? Date.parse(exam.availableFrom) : null;
  const availableUntil = exam.availableUntil ? Date.parse(exam.availableUntil) : null;
  const initialStatus = exam.deliveryMode === "async" ? "running" : "lobby";
  await db.prepare(
    `INSERT INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, delivery_mode, available_from, available_until, ai_grading_mode, questions_to_serve, long_to_serve, section_quotas, shuffle_questions, shuffle_options,
     allow_backwards, show_progress, auto_submit, allow_reconnect, supervision_level, require_fullscreen, detect_focus_loss,
     block_clipboard, record_disconnects, violation_action, results_display, results_when, passing_score_percent, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    runId,
    actor.orgId,
    actor.id,
    exam.id,
    code,
    exam.title,
    JSON.stringify(exam.questions),
    exam.timeLimitS,
    exam.deliveryMode,
    availableFrom,
    availableUntil,
    exam.aiGradingMode,
    exam.questionsToServe,
    exam.longToServe,
    JSON.stringify(exam.sectionQuotas ?? {}),
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
    exam.passingScorePercent ?? null,
    initialStatus,
    now,
  ).run();
  const response = await runCommand(runId, "/initialize", {
    runId,
    title: exam.title,
    timeLimitS: exam.timeLimitS,
    recordDisconnects: exam.recordDisconnects,
    status: initialStatus,
    endsAt: exam.deliveryMode === "async" ? availableUntil : null,
    deliveryMode: exam.deliveryMode,
    availableFrom,
    availableUntil,
  });
  if (!response.ok) throw new Error("No se pudo inicializar la sesión en vivo");
  return { id: runId, code };
}

export async function getRunForTeacher(runId: string, actor: Actor): Promise<RunRow | null> {
  const capabilities = await getRunCapabilities(runId, actor);
  if (!capabilities.view) return null;
  return db.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first<RunRow>();
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
     ), pending_totals AS (
       SELECT p.run_id, COUNT(*) AS pending_count
       FROM participants p JOIN grades g ON g.participant_id = p.id
       WHERE p.status = 'submitted' AND g.grading_status NOT IN ('graded', 'auto_graded')
       GROUP BY p.run_id
     )
     SELECT r.id, r.title, r.code, r.status, r.created_at, r.delivery_mode, r.available_from, r.available_until,
      COALESCE(s.participant_count, 0) AS participant_count,
      COALESCE(i.incident_count, 0) AS incident_count,
      COALESCE(pt.pending_count, 0) AS pending_count,
      s.average
     FROM runs r
     LEFT JOIN exams e ON e.id = r.exam_id
     LEFT JOIN exam_collaborators c ON c.exam_id = e.id AND c.user_id = ?
     LEFT JOIN score_totals s ON s.run_id = r.id
     LEFT JOIN incident_totals i ON i.run_id = r.id
     LEFT JOIN pending_totals pt ON pt.run_id = r.id
     WHERE COALESCE(r.author_id, e.author_id) = ? OR c.user_id IS NOT NULL
     ORDER BY r.created_at DESC`,
  ).bind(actor.id, actor.id).all<{
    id: string;
    title: string;
    code: string;
    status: RunRow["status"];
    created_at: number;
    participant_count: number;
    incident_count: number;
    pending_count: number;
    average: number | null;
    delivery_mode: RunRow["delivery_mode"];
    available_from: number | null;
    available_until: number | null;
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
    deliveryMode: row.delivery_mode,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    pendingCorrections: Number(row.pending_count),
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
  classroomEmail?: string | null,
) {
  const run = await getJoinableRun(rawCode);
  if (!run) return null;
  if (run.delivery_mode === "async" && run.available_until !== null && Date.now() >= run.available_until) {
    throw new Error("La ventana para iniciar esta evaluación ya cerró");
  }

  let classroomIdentity: { googleUserId: string; email: string } | null = null;
  if (run.classroom_course_id && run.classroom_coursework_id) {
    const email = normalizeStudentEmail(classroomEmail);
    if (!email) throw new Error("Ingresá el correo con el que figurás en Google Classroom");
    const expected = await db.prepare(
      "SELECT google_user_id, email FROM expected_run_students WHERE run_id = ? AND LOWER(email) = ?",
    ).bind(run.id, email).all<{ google_user_id: string; email: string | null }>();
    if (expected.results.length !== 1 || !expected.results[0].email) {
      throw new Error("Ese correo no figura en el curso de Google Classroom publicado para esta evaluación");
    }
    classroomIdentity = { googleUserId: expected.results[0].google_user_id, email: normalizeStudentEmail(expected.results[0].email)! };
    const claimed = await db.prepare(
      "SELECT id, user_id FROM participants WHERE run_id = ? AND classroom_google_user_id = ?",
    ).bind(run.id, classroomIdentity.googleUserId).first<{ id: string; user_id: string | null }>();
    if (claimed && (!actor || claimed.user_id !== actor.id)) {
      throw new Error("Ese alumno ya ingresó a esta evaluación. Debe continuar desde el mismo dispositivo.");
    }
  }

  const participantId = crypto.randomUUID();
  const now = Date.now();
  if (actor) {
    await db.prepare(
      `INSERT INTO participants (id, run_id, user_id, display_name, guest_token_hash, classroom_google_user_id, classroom_email, status, joined_at, last_seen, late, attempt_started_at, deadline_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, user_id) DO UPDATE SET display_name = excluded.display_name, classroom_google_user_id = excluded.classroom_google_user_id, classroom_email = excluded.classroom_email, last_seen = excluded.last_seen`,
    ).bind(
      participantId,
      run.id,
      actor.id,
      displayName,
      classroomIdentity?.googleUserId ?? null,
      classroomIdentity?.email ?? null,
      run.delivery_mode === "async" ? "waiting" : run.status === "running" ? "active" : "waiting",
      now,
      now,
      run.delivery_mode === "sync" && run.status === "running" ? 1 : 0,
      run.delivery_mode === "sync" && run.status === "running" ? now : null,
      run.delivery_mode === "sync" && run.status === "running" ? run.ends_at : null,
    ).run();
  } else {
    if (!guestTokenHash) throw new Error("Falta la sesión temporal del alumno");
    await db.prepare(
      `INSERT INTO participants (id, run_id, user_id, display_name, guest_token_hash, classroom_google_user_id, classroom_email, status, joined_at, last_seen, late, attempt_started_at, deadline_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      participantId,
      run.id,
      displayName,
      guestTokenHash,
      classroomIdentity?.googleUserId ?? null,
      classroomIdentity?.email ?? null,
      run.delivery_mode === "async" ? "waiting" : run.status === "running" ? "active" : "waiting",
      now,
      now,
      run.delivery_mode === "sync" && run.status === "running" ? 1 : 0,
      run.delivery_mode === "sync" && run.status === "running" ? now : null,
      run.delivery_mode === "sync" && run.status === "running" ? run.ends_at : null,
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
    status: participant.status,
    deadlineAt: participant.deadline_at,
    attemptStartedAt: participant.attempt_started_at,
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
    section_quotas?: string | null;
  },
  participantId: string,
): FullQuestion[] {
  let sectionQuotas: Record<string, number> = {};
  if (run.section_quotas) {
    try {
      sectionQuotas = JSON.parse(run.section_quotas) as Record<string, number>;
    } catch {
      // Una toma vieja o un valor corrupto no puede dejar al alumno sin examen:
      // se cae al sorteo plano de siempre.
    }
  }
  return personalizeQuestions(
    JSON.parse(run.questions_snapshot) as FullQuestion[],
    `${run.id}:${participantId}`,
    Boolean(run.shuffle_questions),
    Boolean(run.shuffle_options),
    run.questions_to_serve,
    run.long_to_serve ?? 2,
    sectionQuotas,
  );
}

export async function participantOwnedBy(participantId: string, access: StudentAccess) {
  if (access.actor) {
    const participant = await db.prepare(
      `SELECT p.*, r.status AS run_status, r.ends_at, r.delivery_mode, r.available_from, r.available_until, r.time_limit_s, r.questions_snapshot,
            r.shuffle_questions, r.shuffle_options, r.questions_to_serve, r.long_to_serve, r.section_quotas
       FROM participants p JOIN runs r ON r.id = p.run_id
       WHERE p.id = ? AND p.user_id = ?`,
    ).bind(participantId, access.actor.id).first<ParticipantRow & {
      run_status: RunRow["status"];
      ends_at: number | null;
      delivery_mode: RunRow["delivery_mode"];
      available_from: number | null;
      available_until: number | null;
      time_limit_s: number;
      questions_snapshot: string;
      shuffle_questions: number;
      shuffle_options: number;
      questions_to_serve: number | null;
      long_to_serve: number;
      section_quotas: string;
    }>();
    if (participant) return participant;
  }
  const guest = readGuestSession(access.request);
  if (!guest || guest.participantId !== participantId) return null;
  const tokenHash = await hashGuestToken(guest.token);
  return db.prepare(
    `SELECT p.*, r.status AS run_status, r.ends_at, r.delivery_mode, r.available_from, r.available_until, r.time_limit_s, r.questions_snapshot,
            r.shuffle_questions, r.shuffle_options, r.questions_to_serve, r.long_to_serve, r.section_quotas
     FROM participants p JOIN runs r ON r.id = p.run_id
     WHERE p.id = ? AND p.guest_token_hash = ?`,
  ).bind(participantId, tokenHash).first<ParticipantRow & {
    run_status: RunRow["status"];
    ends_at: number | null;
    delivery_mode: RunRow["delivery_mode"];
    available_from: number | null;
    available_until: number | null;
    time_limit_s: number;
    questions_snapshot: string;
    shuffle_questions: number;
    shuffle_options: number;
    questions_to_serve: number | null;
    long_to_serve: number;
    section_quotas: string;
  }>();
}

export async function startAsyncAttempt(access: StudentAccess, participantId: string) {
  const participant = await participantOwnedBy(participantId, access);
  if (!participant) return null;
  if (participant.delivery_mode !== "async" || participant.available_from === null || participant.available_until === null) {
    throw new Error("Esta evaluación no usa inicio individual");
  }
  if (participant.status === "active" || participant.status === "disconnected") {
    return { startedAt: participant.attempt_started_at, deadlineAt: participant.deadline_at, serverNow: Date.now() };
  }
  if (participant.status !== "waiting") throw new Error("Este intento ya no se puede iniciar");
  const now = Date.now();
  const availability = asyncAvailabilityState(participant.available_from, participant.available_until, now);
  if (availability === "upcoming") throw new Error("La evaluación todavía no está disponible");
  if (availability === "closed") throw new Error("La ventana para iniciar esta evaluación ya cerró");
  const deadlineAt = asyncAttemptDeadline(now, participant.time_limit_s, participant.extra_time_s);
  const updated = await db.prepare(
    `UPDATE participants SET status = 'active', attempt_started_at = ?, deadline_at = ?, last_seen = ?
     WHERE id = ? AND status = 'waiting' RETURNING id`,
  ).bind(now, deadlineAt, now, participantId).first<{ id: string }>();
  if (!updated) throw new Error("El intento ya fue iniciado desde otra sesión");
  await db.batch([
    db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ? AND status != 'ended'").bind(now, participant.run_id),
    db.prepare("INSERT INTO participant_events (id, participant_id, at, type, meta) VALUES (?, ?, ?, 'attempt-started', ?)")
      .bind(crypto.randomUUID(), participantId, now, JSON.stringify({ deadlineAt })),
  ]);
  await runCommand(participant.run_id, "/async-start", { participantId, startedAt: now, deadlineAt });
  return { startedAt: now, deadlineAt, serverNow: now };
}

export async function saveAnswer(access: StudentAccess, participantId: string, questionId: string, value: AnswerValue) {
  const participant = await participantOwnedBy(participantId, access);
  if (!participant) return null;
  if (participant.status !== "active" && participant.status !== "disconnected") throw new Error("Iniciá tu intento antes de responder");
  const effectiveDeadline = participant.deadline_at ?? participant.ends_at;
  if (participant.run_status !== "running" || (effectiveDeadline !== null && effectiveDeadline <= Date.now())) {
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
    answerLength: typeof value === "string" ? value.trim().length : 0,
    at: now,
  });
  return { updatedAt: now };
}

export async function submitParticipant(access: StudentAccess, participantId: string, reason: "manual" | "timer") {
  const participant = await participantOwnedBy(participantId, access);
  if (!participant) return null;
  if (participant.status === "submitted") return { submittedAt: participant.submitted_at };
  if (participant.status !== "active" && participant.status !== "disconnected") throw new Error("Este intento no está en curso");
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
        `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded, grading_status, graded_by_type, graded_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 'auto', ?)
         ON CONFLICT(participant_id, question_id) DO UPDATE SET auto = excluded.auto, points_awarded = excluded.points_awarded,
           grading_status = excluded.grading_status, graded_by_type = excluded.graded_by_type, graded_at = excluded.graded_at`,
      ).bind(
        crypto.randomUUID(),
        participantId,
        questionGrade.questionId,
        questionGrade.auto === null ? null : questionGrade.auto ? 1 : 0,
        questionGrade.pointsAwarded,
        questionGrade.pointsAwarded === null ? "pending_manual" : "auto_graded",
        questionGrade.pointsAwarded === null ? null : now,
      ),
    );
  }
  await db.batch(statements);
  await runCommand(participant.run_id, "/submit", { participantId, reason, at: now });
  const score = grade.questions.reduce((total, question) => total + (question.pointsAwarded ?? 0), 0);
  const maxPoints = questions.reduce((total, question) => total + question.points, 0);
  void syncAutomaticClassroomGrade({ runId: participant.run_id, participantId, score, maxPoints, hasPendingManual: grade.questions.some((question) => question.pointsAwarded === null) })
    .catch((error) => console.error("[classroom] no se pudo devolver una nota automática", error));
  return { submittedAt: now, grade };
}

export async function getMonitorSnapshot(runId: string, actor: Actor) {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  const [participantResult, incidentResult, expectedResult, eventResult] = await Promise.all([
    db.prepare(
      `SELECT p.id, p.status, p.joined_at, p.submitted_at, p.last_seen, p.late,
       p.extra_time_s, p.deadline_at, p.attempt_started_at, p.reopened_count,
       p.display_name AS name, COALESCE(p.classroom_email, u.email) AS email,
       (SELECT COUNT(*) FROM answers a WHERE a.participant_id = p.id) AS answered,
       (SELECT SUM(COALESCE(g.points_awarded, 0)) FROM grades g WHERE g.participant_id = p.id) AS score,
       (SELECT COUNT(*) FROM grades g WHERE g.participant_id = p.id AND g.grading_status NOT IN ('auto_graded', 'graded')) AS pending_manual
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
    db.prepare(
      `SELECT pe.id, pe.participant_id, pe.at, pe.type, pe.actor_user_id, pe.meta, u.name AS actor_name
       FROM participant_events pe JOIN participants p ON p.id = pe.participant_id
       LEFT JOIN users u ON u.id = pe.actor_user_id
       WHERE p.run_id = ? ORDER BY pe.at DESC LIMIT 500`,
    ).bind(runId).all<Record<string, string | number | null>>(),
  ]);
  const allQuestions = JSON.parse(run.questions_snapshot) as FullQuestion[];
  const representativeQuestions = questionsForParticipant(run, "__progress-preview__");
  const questionCount = representativeQuestions.length;
  // Con pozo de preguntas cada alumno recibe un subconjunto propio, y esos
  // subconjuntos pueden sumar puntajes distintos. El porcentaje es entonces lo
  // único comparable entre alumnos, así que se calcula acá contra el máximo real
  // de cada uno en vez de contra un total único de la toma.
  const participants = participantResult.results.map((participant) => {
    const assignedQuestions = questionsForParticipant(run, String(participant.id));
    const maxPoints = assignedQuestions.reduce((sum, question) => sum + question.points, 0);
    const score = Number(participant.score ?? 0);
    return {
      ...participant,
      assigned_questions: assignedQuestions.length,
      max_points: maxPoints,
      percent: maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0,
    };
  });
  const totalPoints = representativeQuestions.reduce((sum, question) => sum + question.points, 0);
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
    events: eventResult.results.map((row) => ({ ...row, meta: typeof row.meta === "string" ? JSON.parse(row.meta) : {} })),
    serverNow: Date.now(),
  };
}

export async function getParticipantDetail(participantId: string, actor: Actor) {
  const participantRun = await db.prepare("SELECT run_id FROM participants WHERE id = ?")
    .bind(participantId).first<{ run_id: string }>();
  if (!participantRun || !(await getRunCapabilities(participantRun.run_id, actor)).view) return null;
  const participant = await db.prepare(
    `SELECT p.*, r.id AS run_id, r.title, r.questions_snapshot,
            r.shuffle_questions, r.shuffle_options, r.questions_to_serve, r.long_to_serve, r.section_quotas
     FROM participants p JOIN runs r ON r.id = p.run_id
     WHERE p.id = ?`,
  ).bind(participantId).first<ParticipantRow & {
    title: string;
    questions_snapshot: string;
    shuffle_questions: number;
    shuffle_options: number;
    questions_to_serve: number | null;
    long_to_serve: number;
    section_quotas: string;
  }>();
  if (!participant) return null;

  const [answerResult, gradeResult, incidentResult, eventResult] = await Promise.all([
    db.prepare("SELECT question_id, value, updated_at FROM answers WHERE participant_id = ?")
      .bind(participantId).all<{ question_id: string; value: string; updated_at: number }>(),
    db.prepare("SELECT question_id, auto, override, points_awarded FROM grades WHERE participant_id = ?")
      .bind(participantId).all<{ question_id: string; auto: number | null; override: number | null; points_awarded: number | null }>(),
    db.prepare("SELECT id, at, duration_ms, type, meta, source, question_id FROM incidents WHERE participant_id = ? ORDER BY at")
      .bind(participantId).all<{ id: string; at: number; duration_ms: number; type: string; meta: string; source: string; question_id: string | null }>(),
    db.prepare("SELECT pe.id, pe.at, pe.type, pe.meta, u.name AS actor_name FROM participant_events pe LEFT JOIN users u ON u.id = pe.actor_user_id WHERE pe.participant_id = ? ORDER BY pe.at")
      .bind(participantId).all<{ id: string; at: number; type: string; meta: string; actor_name: string | null }>(),
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
    timeline: [
      ...eventResult.results.map((event) => ({ id: event.id, at: event.at, type: event.type, kind: "event", actorName: event.actor_name, meta: typeof event.meta === "string" ? JSON.parse(event.meta) : {} })),
      ...incidentResult.results.map((incident) => ({ id: incident.id, at: incident.at, type: incident.type, kind: "incident", actorName: null, meta: typeof incident.meta === "string" ? JSON.parse(incident.meta) : {} })),
    ].sort((left, right) => left.at - right.at),
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
      r.questions_snapshot, g.question_id, a.value, g.points_awarded, g.feedback, g.rubric_scores,
      g.grading_status, g.teacher_note, g.ai_suggested_score, g.ai_confidence, g.ai_feedback, g.ai_teacher_note, g.ai_criteria, g.ai_error
     FROM participants p
     JOIN runs r ON r.id = p.run_id
     LEFT JOIN exams e ON e.id = r.exam_id
     JOIN grades g ON g.participant_id = p.id
     LEFT JOIN answers a ON a.participant_id = p.id AND a.question_id = g.question_id
     LEFT JOIN exam_collaborators c ON c.exam_id = e.id AND c.user_id = ?
     WHERE p.status = 'submitted' AND (COALESCE(r.author_id, e.author_id) = ? OR c.permission = 'correct')
       AND (? = '' OR p.run_id = ?)
     ORDER BY p.submitted_at DESC`,
  ).bind(actor.id, actor.id, runId ?? "", runId ?? "").all<{
    participant_id: string;
    run_id: string;
    submitted_at: number;
    name: string;
    title: string;
    questions_snapshot: string;
    question_id: string;
    value: string | null;
    points_awarded: number | null;
    feedback: string | null;
    rubric_scores: string | null;
    grading_status: string;
    teacher_note: string;
    ai_suggested_score: number | null;
    ai_confidence: number | null;
    ai_feedback: string;
    ai_teacher_note: string;
    ai_criteria: string;
    ai_error: string | null;
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
      answer: row.value === null ? "" : JSON.parse(row.value) as string,
      pointsAwarded: row.points_awarded,
      feedback: row.feedback ?? "",
      rubricScores: safeJsonObject(row.rubric_scores),
      rubric: question.type === "long" ? question.config.rubric ?? [] : [],
      gradingStatus: row.grading_status,
      teacherNote: row.teacher_note,
      aiSuggestedScore: row.ai_suggested_score,
      aiConfidence: row.ai_confidence,
      aiFeedback: row.ai_feedback,
      aiTeacherNote: row.ai_teacher_note,
      aiCriteria: safeJsonArray(row.ai_criteria),
      aiError: row.ai_error,
      // Viajan para poder editarlos desde la pantalla de correccion.
      gradingCriteria: question.type === "long" ? question.config.gradingCriteria ?? "" : "",
      referenceAnswer: question.type === "long" ? question.config.referenceAnswer ?? "" : "",
    }];
  });
}

export async function saveManualGrade(
  actor: Actor,
  input: { participantId: string; questionId: string; pointsAwarded: number; feedback?: string; teacherNote?: string; rubricScores?: Record<string, number> },
) {
  const participantRun = await db.prepare("SELECT run_id FROM participants WHERE id = ?").bind(input.participantId).first<{ run_id: string }>();
  if (!participantRun || !(await getRunCapabilities(participantRun.run_id, actor)).correct) return false;
  const row = await db.prepare(
    `SELECT r.questions_snapshot FROM participants p JOIN runs r ON r.id = p.run_id
     WHERE p.id = ?`,
  ).bind(input.participantId).first<{ questions_snapshot: string }>();
  if (!row) return false;
  const question = (JSON.parse(row.questions_snapshot) as FullQuestion[]).find(
    (candidate) => candidate.id === input.questionId && candidate.type === "long",
  );
  if (!question || question.type !== "long" || input.pointsAwarded < 0 || input.pointsAwarded > question.points) {
    throw new Error("El puntaje está fuera del rango permitido");
  }
  const rubric = question.config.rubric ?? [];
  if (rubric.length) {
    const scores = input.rubricScores ?? {};
    for (const criterion of rubric) {
      const score = Number(scores[criterion.id] ?? 0);
      if (score < 0 || score > criterion.maxPoints) throw new Error(`El criterio “${criterion.label}” está fuera de rango`);
    }
    const total = rubric.reduce((sum, criterion) => sum + Number(scores[criterion.id] ?? 0), 0);
    if (Math.abs(total - input.pointsAwarded) > .001) throw new Error("El puntaje debe coincidir con la suma de la rúbrica");
  }
  await db.prepare(
    `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded, feedback, teacher_note, rubric_scores, grading_status, graded_by_type, graded_at, graded_by, ai_reviewed_at)
     VALUES (?, ?, ?, NULL, 1, ?, ?, ?, ?, 'graded', 'teacher', ?, ?, ?)
     ON CONFLICT(participant_id, question_id) DO UPDATE SET override = 1, points_awarded = excluded.points_awarded, feedback = excluded.feedback, rubric_scores = excluded.rubric_scores,
       teacher_note = excluded.teacher_note, grading_status = 'graded', graded_by_type = 'teacher', graded_at = excluded.graded_at, graded_by = excluded.graded_by, ai_reviewed_at = CASE WHEN grades.ai_suggested_score IS NULL THEN grades.ai_reviewed_at ELSE excluded.ai_reviewed_at END`,
  ).bind(crypto.randomUUID(), input.participantId, input.questionId, input.pointsAwarded, (input.feedback ?? "").slice(0, 4000), (input.teacherNote ?? "").slice(0, 4000), JSON.stringify(input.rubricScores ?? {}), Date.now(), actor.id, Date.now()).run();
  return true;
}

export async function rejectAiSuggestion(actor: Actor, participantId: string, questionId: string) {
  const participant = await db.prepare("SELECT run_id FROM participants WHERE id = ?").bind(participantId).first<{ run_id: string }>();
  if (!participant || !(await getRunCapabilities(participant.run_id, actor)).correct) return false;
  await db.prepare(`UPDATE grades SET grading_status = 'pending_manual', ai_suggested_score = NULL, ai_confidence = NULL,
    ai_feedback = '', ai_teacher_note = '', ai_criteria = '[]', ai_reviewed_at = ? WHERE participant_id = ? AND question_id = ?`)
    .bind(Date.now(), participantId, questionId).run();
  return true;
}

/**
 * Carga los criterios de correccion con IA de una pregunta despues de tomada la
 * evaluacion.
 *
 * Escribe sobre `runs.questions_snapshot` y no sobre la evaluacion original: es
 * la copia congelada que lee el corrector, y la unica que puede cambiar la
 * sugerencia de esta toma sin tocar las preguntas de tomas anteriores.
 */
export async function saveAiCriteria(
  actor: Actor,
  runId: string,
  questionId: string,
  input: { gradingCriteria: string; referenceAnswer: string },
) {
  if (!(await getRunCapabilities(runId, actor)).correct) return false;
  const row = await db.prepare("SELECT questions_snapshot FROM runs WHERE id = ?").bind(runId).first<{ questions_snapshot: string }>();
  if (!row) return false;

  const questions = JSON.parse(row.questions_snapshot) as FullQuestion[];
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question || question.type !== "long") return false;

  question.config = {
    ...question.config,
    gradingCriteria: input.gradingCriteria,
    referenceAnswer: input.referenceAnswer,
  };
  await db.prepare("UPDATE runs SET questions_snapshot = ? WHERE id = ?")
    .bind(JSON.stringify(questions), runId).run();
  return true;
}

export async function teacherPendingCorrectionCount(actor: Actor) {
  const row = await db.prepare(`SELECT COUNT(*) AS pending FROM grades g JOIN participants p ON p.id = g.participant_id
    JOIN runs r ON r.id = p.run_id LEFT JOIN exams e ON e.id = r.exam_id LEFT JOIN exam_collaborators c ON c.exam_id = e.id AND c.user_id = ?
    WHERE p.status = 'submitted' AND g.grading_status NOT IN ('auto_graded', 'graded') AND (COALESCE(r.author_id, e.author_id) = ? OR c.permission = 'correct')`)
    .bind(actor.id, actor.id).first<{ pending: number }>();
  return Number(row?.pending ?? 0);
}

export async function getExamAnalytics(runId: string, actor: Actor) {
  const currentRun = await getRunForTeacher(runId, actor);
  if (!currentRun) return null;
  const examId = currentRun.exam_id;
  const scopeColumn = examId ? "r.exam_id" : "r.id";
  const scopeValue = examId ?? runId;
  const runResult = await db.prepare(
    `SELECT r.* FROM runs r WHERE ${scopeColumn} = ? ORDER BY r.created_at`,
  ).bind(scopeValue).all<RunRow>();
  const [participantResult, answerResult, gradeResult, incidentResult, expectedResult] = await Promise.all([
    db.prepare(`SELECT p.* FROM participants p JOIN runs r ON r.id = p.run_id WHERE ${scopeColumn} = ?`)
      .bind(scopeValue).all<ParticipantRow & { joined_at: number }>(),
    db.prepare(`SELECT a.participant_id, a.question_id, a.value FROM answers a JOIN participants p ON p.id = a.participant_id JOIN runs r ON r.id = p.run_id WHERE ${scopeColumn} = ?`)
      .bind(scopeValue).all<{ participant_id: string; question_id: string; value: string }>(),
    db.prepare(`SELECT g.participant_id, g.question_id, g.auto, g.points_awarded FROM grades g JOIN participants p ON p.id = g.participant_id JOIN runs r ON r.id = p.run_id WHERE ${scopeColumn} = ?`)
      .bind(scopeValue).all<{ participant_id: string; question_id: string; auto: number | null; points_awarded: number | null }>(),
    db.prepare(`SELECT i.participant_id, i.type FROM incidents i JOIN participants p ON p.id = i.participant_id JOIN runs r ON r.id = p.run_id WHERE ${scopeColumn} = ?`)
      .bind(scopeValue).all<{ participant_id: string; type: string }>(),
    db.prepare(`SELECT ers.run_id, COUNT(*) AS expected FROM expected_run_students ers JOIN runs r ON r.id = ers.run_id WHERE ${scopeColumn} = ? GROUP BY ers.run_id`)
      .bind(scopeValue).all<{ run_id: string; expected: number }>(),
  ]);
  const answersByParticipant = groupRows(answerResult.results, "participant_id");
  const gradesByParticipant = groupRows(gradeResult.results, "participant_id");
  const incidentsByParticipant = groupRows(incidentResult.results, "participant_id");
  const runById = new Map(runResult.results.map((run) => [run.id, run]));
  const attempts: AnalyticsAttempt[] = participantResult.results.map((participant) => {
    const run = runById.get(participant.run_id)!;
    return {
      runId: run.id,
      participantId: participant.id,
      status: participant.status,
      startedAt: run.started_at,
      joinedAt: participant.joined_at,
      submittedAt: participant.submitted_at,
      assigned: questionsForParticipant(run, participant.id),
      answers: new Map((answersByParticipant.get(participant.id) ?? []).map((answer) => [String(answer.question_id), JSON.parse(String(answer.value))])),
      grades: new Map((gradesByParticipant.get(participant.id) ?? []).map((grade) => [String(grade.question_id), { auto: grade.auto === null ? null : Boolean(grade.auto), points: grade.points_awarded === null ? null : Number(grade.points_awarded) }])),
      incidentTypes: (incidentsByParticipant.get(participant.id) ?? []).map((incident) => String(incident.type)),
    };
  });
  const expectedByRun = new Map(expectedResult.results.map((row) => [row.run_id, Number(row.expected)]));
  const perRun = runResult.results.map((run) => {
    const runAttempts = attempts.filter((attempt) => attempt.runId === run.id);
    const expected = Math.max(expectedByRun.get(run.id) ?? 0, runAttempts.length);
    return { run: { id: run.id, title: run.title, code: run.code, createdAt: run.created_at }, analytics: buildExamAnalytics(runAttempts, expected, run.passing_score_percent) };
  });
  const aggregateExpected = runResult.results.reduce((sum, run) => sum + Math.max(expectedByRun.get(run.id) ?? 0, attempts.filter((attempt) => attempt.runId === run.id).length), 0);
  return { current: perRun.find((item) => item.run.id === runId)!, aggregate: buildExamAnalytics(attempts, aggregateExpected, currentRun.passing_score_percent), perRun };
}

function groupRows<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) { const value = String(row[key]); grouped.set(value, [...(grouped.get(value) ?? []), row]); }
  return grouped;
}

export async function listQuickComments(actor: Actor) {
  const result = await db.prepare("SELECT id, text FROM quick_comments WHERE user_id = ? ORDER BY updated_at DESC").bind(actor.id).all<{ id: string; text: string }>();
  return result.results;
}

export async function saveQuickComment(actor: Actor, input: { id?: string; text: string }) {
  const now = Date.now();
  const id = input.id ?? crypto.randomUUID();
  const text = input.text.trim().slice(0, 500);
  if (!text) throw new Error("El comentario está vacío");
  await db.prepare(`INSERT INTO quick_comments (id, user_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at WHERE quick_comments.user_id = excluded.user_id`)
    .bind(id, actor.id, text, now, now).run();
  return { id, text };
}

export async function deleteQuickComment(actor: Actor, id: string) {
  const result = await db.prepare("DELETE FROM quick_comments WHERE id = ? AND user_id = ?").bind(id, actor.id).run();
  return result.meta.changes > 0;
}

/** Cuántas respuestas de desarrollo siguen sin nota en esta toma. */
export async function pendingManualCount(runId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS pending
     FROM participants p JOIN grades g ON g.participant_id = p.id
     WHERE p.run_id = ? AND g.grading_status NOT IN ('auto_graded', 'graded')`,
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
  if (!(await getRunCapabilities(runId, actor)).publishResults) throw new Error("No tenés permiso para publicar resultados");
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

/** Las cuotas viajan como JSON en texto; un valor corrupto no puede romper la lectura. */
function safeQuotas(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseQuestion(row: QuestionRow): FullQuestion {
  return {
    id: row.id,
    position: row.position,
    type: row.type,
    prompt: row.prompt,
    points: row.points,
    section: row.section ?? undefined,
    difficulty: row.difficulty ?? undefined,
    assets: safeJsonArray(row.assets),
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

function safeJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try { const value = JSON.parse(raw) as unknown; return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {}; }
  catch { return {}; }
}

export interface PlatformExam {
  id: string;
  title: string;
  subject: string;
  status: "draft" | "ready";
  updated_at: number;
  teacher_name: string | null;
  teacher_email: string | null;
  questions: number;
  runs: number;
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

  const platformExams = await db.prepare(
    `SELECT e.id, e.title, e.subject, e.status, e.updated_at,
       u.name AS teacher_name, u.email AS teacher_email,
       (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS questions,
       (SELECT COUNT(*) FROM runs r WHERE r.exam_id = e.id) AS runs
     FROM exams e LEFT JOIN users u ON u.id = e.author_id
     ORDER BY e.updated_at DESC`,
  ).all<PlatformExam>();

  return {
    organizations: organizations.results,
    liveRuns: liveRuns.results,
    recentRuns: recentRuns.results,
    platformExams: platformExams.results,
    totals: totals ?? {
      organizations: 0, teachers: 0, students: 0, exams: 0,
      runs: 0, participants: 0, answers: 0, live_runs: 0,
    },
    serverNow: Date.now(),
  };
}

export async function getPlatformExamDetail(examId: string) {
  const exam = await db.prepare(
    `SELECT e.id, e.title, e.subject, e.instructions, e.status, e.updated_at,
       u.name AS teacher_name, u.email AS teacher_email,
       (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS questions
     FROM exams e LEFT JOIN users u ON u.id = e.author_id WHERE e.id = ?`,
  ).bind(examId).first<Record<string, string | number | null>>();
  if (!exam) return null;
  const runs = await db.prepare(
    `SELECT id, code, status, created_at, started_at, ended_at,
       (SELECT COUNT(*) FROM participants p WHERE p.run_id = runs.id) AS participants
     FROM runs WHERE exam_id = ? ORDER BY created_at DESC`,
  ).bind(examId).all<Record<string, string | number | null>>();
  return { exam, runs: runs.results };
}

export type PlatformOverview = Awaited<ReturnType<typeof getPlatformOverview>>;
