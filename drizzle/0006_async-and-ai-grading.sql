ALTER TABLE "exams" ADD COLUMN "delivery_mode" text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "available_from" bigint;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "available_until" bigint;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "ai_grading_mode" text DEFAULT 'suggest' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "delivery_mode" text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "available_from" bigint;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "available_until" bigint;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "ai_grading_mode" text DEFAULT 'suggest' NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "attempt_started_at" bigint;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "grading_status" text DEFAULT 'auto_graded' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "graded_by_type" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "graded_at" bigint;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "graded_by" text;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "teacher_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_suggested_score" numeric(8,2);--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_confidence" numeric(5,4);--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_feedback" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_teacher_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_criteria" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_error" text;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_reviewed_at" bigint;--> statement-breakpoint
UPDATE "grades" SET "grading_status" = CASE WHEN "points_awarded" IS NULL THEN 'pending_manual' WHEN "override" = 1 THEN 'graded' ELSE 'auto_graded' END,
  "graded_by_type" = CASE WHEN "override" = 1 THEN 'teacher' ELSE 'auto' END;--> statement-breakpoint
CREATE TABLE "grading_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text,
  "requested_by" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "processed" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  "created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
  "started_at" bigint,
  "completed_at" bigint,
  "error" text
);--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_jobs" ADD CONSTRAINT "grading_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_jobs" ADD CONSTRAINT "grading_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grading_jobs_requester_status_idx" ON "grading_jobs" USING btree ("requested_by", "status");--> statement-breakpoint
CREATE INDEX "grading_jobs_run_idx" ON "grading_jobs" USING btree ("run_id");
--> statement-breakpoint
CREATE TABLE "grading_job_items" (
  "job_id" text NOT NULL,
  "grade_id" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  CONSTRAINT "grading_job_items_job_grade_pk" PRIMARY KEY("job_id", "grade_id")
);--> statement-breakpoint
ALTER TABLE "grading_job_items" ADD CONSTRAINT "grading_job_items_job_id_grading_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."grading_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_job_items" ADD CONSTRAINT "grading_job_items_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grading_job_items_status_idx" ON "grading_job_items" USING btree ("job_id", "status");
