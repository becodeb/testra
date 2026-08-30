-- Adecuaciones: versiones paralelas de una evaluación asignadas por alumno.
ALTER TABLE "exams" ADD COLUMN "adapted_from_id" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "assigned_exam_id" text;--> statement-breakpoint
-- Nombre explicito: `runs` ya tiene `questions_snapshot`, y las consultas
-- que unen las dos tablas con `p.*` terminarian con dos columnas iguales.
ALTER TABLE "participants" ADD COLUMN "assigned_questions_snapshot" text;--> statement-breakpoint
CREATE INDEX "exams_adapted_from_idx" ON "exams" USING btree ("adapted_from_id");
