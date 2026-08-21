ALTER TABLE `participants` ADD `classroom_submission_id` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `late` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `org_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `runs` ADD `author_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `runs_org_idx` ON `runs` (`org_id`);--> statement-breakpoint
CREATE INDEX `runs_author_idx` ON `runs` (`author_id`);