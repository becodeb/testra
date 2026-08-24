import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// Dos convenciones conviven a propósito en este esquema.
//
// Las tablas de better-auth (users, sessions, accounts, verifications) usan
// tipos nativos de Postgres —boolean y timestamptz— porque better-auth accede a
// ellas por Drizzle y espera Date y boolean en sus campos.
//
// Las tablas de la aplicación conservan la representación física que tenían en
// D1: epoch en milisegundos sobre bigint, booleanos sobre integer 0/1 y JSON
// sobre text. El dominio razona en epoch ms de punta a punta (endsAt, lastSeen y
// serverNow se comparan contra Date.now() también en el navegador) y las 41
// consultas en SQL crudo de repository.ts leen esas columnas como number.
// Pasarlas a timestamptz obligaría a reescribirlas todas sin ganar nada.

const epochMs = (name: string) => bigint(name, { mode: "number" });

const createdAtMs = (name: string) =>
  epochMs(name)
    .notNull()
    .default(sql`((extract(epoch from now()) * 1000)::bigint)`);

// Booleano guardado como 0/1, tal como lo dejaba D1.
const flag = (name: string) => integer(name);

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    googleDomain: text("google_domain"),
    createdAt: createdAtMs("created_at"),
  },
  (table) => [uniqueIndex("organizations_google_domain_uq").on(table.googleDomain)],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    role: text("role", { enum: ["teacher", "student"] }).notNull(),
    googleSub: text("google_sub"),
    orgId: text("org_id").references(() => organizations.id),
    orgAdmin: boolean("org_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_uq").on(table.email),
    uniqueIndex("users_google_sub_uq").on(table.googleSub),
    index("users_org_idx").on(table.orgId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("sessions_token_uq").on(table.token),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_issuer_account_uq").on(table.issuer, table.accountId),
    index("accounts_user_idx").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const exams = pgTable(
  "exams",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    subject: text("subject").notNull(),
    instructions: text("instructions").notNull().default(""),
    timeLimitS: integer("time_limit_s").notNull(),
    // Cuántas preguntas del pozo ve cada alumno. NULL o 0 sirve todas.
    questionsToServe: integer("questions_to_serve"),
    // De esas, cuántas deben ser de desarrollo. Garantiza que a nadie le toque
    // una evaluación sin preguntas para justificar por escrito.
    longToServe: integer("long_to_serve").notNull().default(2),
    shuffleQuestions: flag("shuffle_questions").notNull().default(0),
    shuffleOptions: flag("shuffle_options").notNull().default(0),
    allowBackwards: flag("allow_backwards").notNull().default(1),
    showProgress: flag("show_progress").notNull().default(1),
    autoSubmit: flag("auto_submit").notNull().default(1),
    allowReconnect: flag("allow_reconnect").notNull().default(1),
    supervisionLevel: text("supervision_level", { enum: ["normal", "strict", "custom"] }).notNull().default("normal"),
    requireFullscreen: flag("require_fullscreen").notNull().default(0),
    detectFocusLoss: flag("detect_focus_loss").notNull().default(1),
    blockClipboard: flag("block_clipboard").notNull().default(0),
    recordDisconnects: flag("record_disconnects").notNull().default(1),
    violationAction: text("violation_action", { enum: ["warn_and_record", "record_only"] }).notNull().default("warn_and_record"),
    resultsDisplay: text("results_display", { enum: ["score_only", "score_and_answers", "hidden"] }).notNull().default("score_only"),
    resultsWhen: text("results_when", { enum: ["teacher_publishes", "after_submit", "after_run"] }).notNull().default("teacher_publishes"),
    status: text("status", { enum: ["draft", "ready"] }).notNull().default("draft"),
    createdAt: createdAtMs("created_at"),
    updatedAt: createdAtMs("updated_at"),
  },
  (table) => [
    index("exams_org_idx").on(table.orgId),
    index("exams_author_idx").on(table.authorId),
    index("exams_subject_idx").on(table.subject),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type", { enum: ["mc", "ms", "tf", "sa", "long"] }).notNull(),
    prompt: text("prompt").notNull(),
    points: integer("points").notNull(),
    config: text("config").notNull(),
  },
  (table) => [
    uniqueIndex("questions_exam_position_uq").on(table.examId, table.position),
    index("questions_exam_idx").on(table.examId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    authorId: text("author_id").references(() => users.id),
    examId: text("exam_id").references(() => exams.id, { onDelete: "set null" }),
    code: varchar("code", { length: 6 }).notNull(),
    title: text("title").notNull(),
    questionsSnapshot: text("questions_snapshot").notNull(),
    timeLimitS: integer("time_limit_s").notNull(),
    // Cuántas preguntas del pozo ve cada alumno. NULL o 0 sirve todas.
    questionsToServe: integer("questions_to_serve"),
    // De esas, cuántas deben ser de desarrollo. Garantiza que a nadie le toque
    // una evaluación sin preguntas para justificar por escrito.
    longToServe: integer("long_to_serve").notNull().default(2),
    shuffleQuestions: flag("shuffle_questions").notNull().default(0),
    shuffleOptions: flag("shuffle_options").notNull().default(0),
    allowBackwards: flag("allow_backwards").notNull().default(1),
    showProgress: flag("show_progress").notNull().default(1),
    autoSubmit: flag("auto_submit").notNull().default(1),
    allowReconnect: flag("allow_reconnect").notNull().default(1),
    supervisionLevel: text("supervision_level", { enum: ["normal", "strict", "custom"] }).notNull().default("normal"),
    requireFullscreen: flag("require_fullscreen").notNull().default(0),
    detectFocusLoss: flag("detect_focus_loss").notNull().default(1),
    blockClipboard: flag("block_clipboard").notNull().default(0),
    recordDisconnects: flag("record_disconnects").notNull().default(1),
    violationAction: text("violation_action", { enum: ["warn_and_record", "record_only"] }).notNull().default("warn_and_record"),
    resultsDisplay: text("results_display", { enum: ["score_only", "score_and_answers", "hidden"] }).notNull().default("score_only"),
    resultsWhen: text("results_when", { enum: ["teacher_publishes", "after_submit", "after_run"] }).notNull().default("teacher_publishes"),
    status: text("status", { enum: ["lobby", "running", "ended"] })
      .notNull()
      .default("lobby"),
    classroomCourseId: text("classroom_course_id"),
    classroomCourseworkId: text("classroom_coursework_id"),
    // Momento en que el docente dio los resultados por cerrados. Hasta que esto
    // tiene valor, la toma sigue en corrección: es el "listo" que habilita
    // mostrar la nota y devolverla a Classroom.
    resultsPublishedAt: epochMs("results_published_at"),
    createdAt: createdAtMs("created_at"),
    startedAt: epochMs("started_at"),
    endsAt: epochMs("ends_at"),
    endedAt: epochMs("ended_at"),
  },
  (table) => [
    uniqueIndex("runs_code_uq").on(table.code),
    index("runs_org_idx").on(table.orgId),
    index("runs_author_idx").on(table.authorId),
    index("runs_exam_idx").on(table.examId),
    index("runs_status_idx").on(table.status),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id),
    displayName: text("display_name").notNull(),
    guestTokenHash: text("guest_token_hash"),
    status: text("status", {
      enum: ["waiting", "active", "submitted", "disconnected"],
    })
      .notNull()
      .default("waiting"),
    joinedAt: createdAtMs("joined_at"),
    submittedAt: epochMs("submitted_at"),
    submitReason: text("submit_reason"),
    classroomSubmissionId: text("classroom_submission_id"),
    late: flag("late").notNull().default(0),
    lastSeen: epochMs("last_seen").notNull(),
  },
  (table) => [
    uniqueIndex("participants_run_user_uq").on(table.runId, table.userId),
    uniqueIndex("participants_guest_token_uq").on(table.guestTokenHash),
    index("participants_run_idx").on(table.runId),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    value: text("value").notNull(),
    updatedAt: createdAtMs("updated_at"),
  },
  (table) => [
    uniqueIndex("answers_participant_question_uq").on(
      table.participantId,
      table.questionId,
    ),
    index("answers_participant_idx").on(table.participantId),
  ],
);

export const grades = pgTable(
  "grades",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    auto: flag("auto"),
    override: flag("override"),
    // Medio punto tiene que entrar acá: la cola de corrección manual usa un
    // input con step 0.5. En D1 alcanzaba con una columna integer porque SQLite
    // guarda 0.5 tal cual en una columna con esa afinidad; Postgres redondearía,
    // así que la columna es numérica de verdad.
    pointsAwarded: numeric("points_awarded", { precision: 8, scale: 2, mode: "number" }),
  },
  (table) => [
    uniqueIndex("grades_participant_question_uq").on(
      table.participantId,
      table.questionId,
    ),
  ],
);

export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    at: epochMs("at").notNull(),
    durationMs: epochMs("duration_ms").notNull().default(0),
    type: text("type").notNull(),
    questionId: text("question_id"),
    meta: text("meta").notNull().default("{}"),
    source: text("source", { enum: ["client", "server"] }).notNull(),
  },
  (table) => [
    index("incidents_participant_idx").on(table.participantId),
    index("incidents_at_idx").on(table.at),
  ],
);

export const accessRequests = pgTable(
  "access_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    requestedAt: createdAtMs("requested_at"),
    reviewedAt: epochMs("reviewed_at"),
    reviewedBy: text("reviewed_by").references(() => users.id),
  },
  (table) => [index("access_requests_org_status_idx").on(table.organizationId, table.status), index("access_requests_user_idx").on(table.requesterUserId)],
);

export const aiReports = pgTable(
  "ai_reports",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type", { enum: ["run", "participant"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    model: text("model").notNull(),
    inputHash: text("input_hash").notNull(),
    generatedAt: createdAtMs("generated_at"),
  },
  (table) => [uniqueIndex("ai_reports_scope_uq").on(table.scopeType, table.scopeId), index("ai_reports_run_idx").on(table.runId)],
);

export const expectedRunStudents = pgTable(
  "expected_run_students",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    googleUserId: text("google_user_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
  },
  (table) => [primaryKey({ columns: [table.runId, table.googleUserId] })],
);
