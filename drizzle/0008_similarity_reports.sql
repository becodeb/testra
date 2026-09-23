CREATE TABLE "similarity_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"report" text NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL,
	"updated_at" bigint DEFAULT ((extract(epoch from now()) * 1000)::bigint) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "similarity_reports" ADD CONSTRAINT "similarity_reports_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "similarity_reports_run_uq" ON "similarity_reports" USING btree ("run_id");
