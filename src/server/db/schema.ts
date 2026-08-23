import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    googleDomain: text("google_domain"),
    createdAt: timestamp("created_at"),
  },
  (table) => [uniqueIndex("organizations_google_domain_uq").on(table.googleDomain)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    role: text("role", { enum: ["teacher", "student"] }).notNull(),
    googleSub: text("google_sub"),
    orgId: text("org_id").references(() => organizations.id),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("users_email_uq").on(table.email),
    uniqueIndex("users_google_sub_uq").on(table.googleSub),
    index("users_org_idx").on(table.orgId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
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

export const accounts = sqliteTable(
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
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("accounts_issuer_account_uq").on(table.issuer, table.accountId),
    index("accounts_user_idx").on(table.userId),
  ],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const exams = sqliteTable(
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
    shuffleQuestions: integer("shuffle_questions", { mode: "boolean" }).notNull().default(false),
    shuffleOptions: integer("shuffle_options", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["draft", "ready"] }).notNull().default("draft"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("exams_org_idx").on(table.orgId),
    index("exams_author_idx").on(table.authorId),
    index("exams_subject_idx").on(table.subject),
  ],
);

export const questions = sqliteTable(
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
    config: text("config", { mode: "json" }).notNull(),
  },
  (table) => [
    uniqueIndex("questions_exam_position_uq").on(table.examId, table.position),
    index("questions_exam_idx").on(table.examId),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id),
    authorId: text("author_id").references(() => users.id),
    examId: text("exam_id").references(() => exams.id, { onDelete: "set null" }),
    code: text("code", { length: 6 }).notNull(),
    title: text("title").notNull(),
    questionsSnapshot: text("questions_snapshot", { mode: "json" }).notNull(),
    timeLimitS: integer("time_limit_s").notNull(),
    shuffleQuestions: integer("shuffle_questions", { mode: "boolean" }).notNull().default(false),
    shuffleOptions: integer("shuffle_options", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["lobby", "running", "ended"] })
      .notNull()
      .default("lobby"),
    classroomCourseId: text("classroom_course_id"),
    classroomCourseworkId: text("classroom_coursework_id"),
    createdAt: timestamp("created_at"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("runs_code_uq").on(table.code),
    index("runs_org_idx").on(table.orgId),
    index("runs_author_idx").on(table.authorId),
    index("runs_exam_idx").on(table.examId),
    index("runs_status_idx").on(table.status),
  ],
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .references(() => users.id),
    displayName: text("display_name").notNull(),
    guestTokenHash: text("guest_token_hash"),
    status: text("status", {
      enum: ["waiting", "active", "submitted", "disconnected"],
    })
      .notNull()
      .default("waiting"),
    joinedAt: timestamp("joined_at"),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
    submitReason: text("submit_reason"),
    classroomSubmissionId: text("classroom_submission_id"),
    late: integer("late", { mode: "boolean" }).notNull().default(false),
    lastSeen: integer("last_seen", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("participants_run_user_uq").on(table.runId, table.userId),
    uniqueIndex("participants_guest_token_uq").on(table.guestTokenHash),
    index("participants_run_idx").on(table.runId),
  ],
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    value: text("value", { mode: "json" }).notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("answers_participant_question_uq").on(
      table.participantId,
      table.questionId,
    ),
    index("answers_participant_idx").on(table.participantId),
  ],
);

export const grades = sqliteTable(
  "grades",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    auto: integer("auto", { mode: "boolean" }),
    override: integer("override", { mode: "boolean" }),
    pointsAwarded: integer("points_awarded"),
  },
  (table) => [
    uniqueIndex("grades_participant_question_uq").on(
      table.participantId,
      table.questionId,
    ),
  ],
);

export const incidents = sqliteTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    type: text("type").notNull(),
    meta: text("meta", { mode: "json" }).notNull().default({}),
    source: text("source", { enum: ["client", "server"] }).notNull(),
  },
  (table) => [
    index("incidents_participant_idx").on(table.participantId),
    index("incidents_at_idx").on(table.at),
  ],
);

export const expectedRunStudents = sqliteTable(
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
