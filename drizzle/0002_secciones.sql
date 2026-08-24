ALTER TABLE "exams" ADD COLUMN "section_quotas" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "section_quotas" text DEFAULT '{}' NOT NULL;