ALTER TABLE "participants" ADD COLUMN "classroom_google_user_id" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "classroom_email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_run_classroom_user_uq" ON "participants" USING btree ("run_id","classroom_google_user_id");
