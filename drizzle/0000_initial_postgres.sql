CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requester_user_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	"reviewed_at" bigint,
	"reviewed_by" text
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"run_id" text NOT NULL,
	"content" text NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"generated_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"question_id" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"time_limit_s" integer NOT NULL,
	"questions_to_serve" integer,
	"long_to_serve" integer DEFAULT 2 NOT NULL,
	"shuffle_questions" integer DEFAULT 0 NOT NULL,
	"shuffle_options" integer DEFAULT 0 NOT NULL,
	"allow_backwards" integer DEFAULT 1 NOT NULL,
	"show_progress" integer DEFAULT 1 NOT NULL,
	"auto_submit" integer DEFAULT 1 NOT NULL,
	"allow_reconnect" integer DEFAULT 1 NOT NULL,
	"supervision_level" text DEFAULT 'normal' NOT NULL,
	"require_fullscreen" integer DEFAULT 0 NOT NULL,
	"detect_focus_loss" integer DEFAULT 1 NOT NULL,
	"block_clipboard" integer DEFAULT 0 NOT NULL,
	"record_disconnects" integer DEFAULT 1 NOT NULL,
	"violation_action" text DEFAULT 'warn_and_record' NOT NULL,
	"results_display" text DEFAULT 'score_only' NOT NULL,
	"results_when" text DEFAULT 'teacher_publishes' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	"updated_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expected_run_students" (
	"run_id" text NOT NULL,
	"google_user_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	CONSTRAINT "expected_run_students_run_id_google_user_id_pk" PRIMARY KEY("run_id","google_user_id")
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"question_id" text NOT NULL,
	"auto" integer,
	"override" integer,
	"points_awarded" numeric(8, 2)
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"at" bigint NOT NULL,
	"duration_ms" bigint DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"question_id" text,
	"meta" text DEFAULT '{}' NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"google_domain" text,
	"created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"guest_token_hash" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"joined_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	"submitted_at" bigint,
	"submit_reason" text,
	"classroom_submission_id" text,
	"late" integer DEFAULT 0 NOT NULL,
	"last_seen" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"prompt" text NOT NULL,
	"points" integer NOT NULL,
	"config" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"author_id" text,
	"exam_id" text,
	"code" varchar(6) NOT NULL,
	"title" text NOT NULL,
	"questions_snapshot" text NOT NULL,
	"time_limit_s" integer NOT NULL,
	"questions_to_serve" integer,
	"long_to_serve" integer DEFAULT 2 NOT NULL,
	"shuffle_questions" integer DEFAULT 0 NOT NULL,
	"shuffle_options" integer DEFAULT 0 NOT NULL,
	"allow_backwards" integer DEFAULT 1 NOT NULL,
	"show_progress" integer DEFAULT 1 NOT NULL,
	"auto_submit" integer DEFAULT 1 NOT NULL,
	"allow_reconnect" integer DEFAULT 1 NOT NULL,
	"supervision_level" text DEFAULT 'normal' NOT NULL,
	"require_fullscreen" integer DEFAULT 0 NOT NULL,
	"detect_focus_loss" integer DEFAULT 1 NOT NULL,
	"block_clipboard" integer DEFAULT 0 NOT NULL,
	"record_disconnects" integer DEFAULT 1 NOT NULL,
	"violation_action" text DEFAULT 'warn_and_record' NOT NULL,
	"results_display" text DEFAULT 'score_only' NOT NULL,
	"results_when" text DEFAULT 'teacher_publishes' NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"classroom_course_id" text,
	"classroom_coursework_id" text,
	"created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	"started_at" bigint,
	"ends_at" bigint,
	"ended_at" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"role" text NOT NULL,
	"google_sub" text,
	"org_id" text,
	"org_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expected_run_students" ADD CONSTRAINT "expected_run_students_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_org_status_idx" ON "access_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "access_requests_user_idx" ON "access_requests" USING btree ("requester_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_uq" ON "accounts" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_reports_scope_uq" ON "ai_reports" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "ai_reports_run_idx" ON "ai_reports" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_participant_question_uq" ON "answers" USING btree ("participant_id","question_id");--> statement-breakpoint
CREATE INDEX "answers_participant_idx" ON "answers" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "exams_org_idx" ON "exams" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "exams_author_idx" ON "exams" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "exams_subject_idx" ON "exams" USING btree ("subject");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_participant_question_uq" ON "grades" USING btree ("participant_id","question_id");--> statement-breakpoint
CREATE INDEX "incidents_participant_idx" ON "incidents" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "incidents_at_idx" ON "incidents" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_google_domain_uq" ON "organizations" USING btree ("google_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_run_user_uq" ON "participants" USING btree ("run_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_guest_token_uq" ON "participants" USING btree ("guest_token_hash");--> statement-breakpoint
CREATE INDEX "participants_run_idx" ON "participants" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_exam_position_uq" ON "questions" USING btree ("exam_id","position");--> statement-breakpoint
CREATE INDEX "questions_exam_idx" ON "questions" USING btree ("exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_code_uq" ON "runs" USING btree ("code");--> statement-breakpoint
CREATE INDEX "runs_org_idx" ON "runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "runs_author_idx" ON "runs" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "runs_exam_idx" ON "runs" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");