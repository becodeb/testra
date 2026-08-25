CREATE TABLE "exam_collaborators" (
	"exam_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permission" text DEFAULT 'view' NOT NULL,
	"can_publish_results" integer DEFAULT 0 NOT NULL,
	"can_manage_classroom" integer DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	"updated_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	CONSTRAINT "exam_collaborators_exam_id_user_id_pk" PRIMARY KEY("exam_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "participant_events" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"at" bigint NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" text,
	"meta" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text,
	"uploader_id" text,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	"updated_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "passing_score_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "feedback" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "rubric_scores" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "extra_time_s" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "deadline_at" bigint;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "reopened_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "difficulty" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "assets" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "passing_score_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "exam_collaborators" ADD CONSTRAINT "exam_collaborators_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_collaborators" ADD CONSTRAINT "exam_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_events" ADD CONSTRAINT "participant_events_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_events" ADD CONSTRAINT "participant_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_assets" ADD CONSTRAINT "question_assets_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_assets" ADD CONSTRAINT "question_assets_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_comments" ADD CONSTRAINT "quick_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_collaborators_user_idx" ON "exam_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "participant_events_participant_at_idx" ON "participant_events" USING btree ("participant_id","at");--> statement-breakpoint
CREATE INDEX "participant_events_type_idx" ON "participant_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "question_assets_exam_idx" ON "question_assets" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "quick_comments_user_idx" ON "quick_comments" USING btree ("user_id");