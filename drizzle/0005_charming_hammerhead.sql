CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `access_requests_org_status_idx` ON `access_requests` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `access_requests_user_idx` ON `access_requests` (`requester_user_id`);--> statement-breakpoint
CREATE TABLE `ai_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`run_id` text NOT NULL,
	`content` text NOT NULL,
	`model` text NOT NULL,
	`input_hash` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_reports_scope_uq` ON `ai_reports` (`scope_type`,`scope_id`);--> statement-breakpoint
CREATE INDEX `ai_reports_run_idx` ON `ai_reports` (`run_id`);--> statement-breakpoint
ALTER TABLE `exams` ADD `allow_backwards` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `show_progress` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `auto_submit` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `allow_reconnect` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `supervision_level` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `require_fullscreen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `detect_focus_loss` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `block_clipboard` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `record_disconnects` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `violation_action` text DEFAULT 'warn_and_record' NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `results_display` text DEFAULT 'score_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `exams` ADD `results_when` text DEFAULT 'teacher_publishes' NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `question_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `allow_backwards` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `show_progress` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `auto_submit` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `allow_reconnect` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `supervision_level` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `require_fullscreen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `detect_focus_loss` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `block_clipboard` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `record_disconnects` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `violation_action` text DEFAULT 'warn_and_record' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `results_display` text DEFAULT 'score_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `results_when` text DEFAULT 'teacher_publishes' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `org_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE users SET org_admin = true WHERE role = 'teacher' AND org_id IS NOT NULL AND id IN (
  SELECT u.id FROM users u WHERE u.role = 'teacher' AND u.org_id IS NOT NULL
  AND u.created_at = (SELECT MIN(first_teacher.created_at) FROM users first_teacher WHERE first_teacher.org_id = u.org_id AND first_teacher.role = 'teacher')
);
