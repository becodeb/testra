ALTER TABLE `exams` ADD `shuffle_questions` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `shuffle_options` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `shuffle_questions` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `shuffle_options` integer DEFAULT false NOT NULL;