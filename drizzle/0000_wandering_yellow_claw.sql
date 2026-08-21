CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_uq` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`question_id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answers_participant_question_uq` ON `answers` (`participant_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `answers_participant_idx` ON `answers` (`participant_id`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`time_limit_s` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exams_org_idx` ON `exams` (`org_id`);--> statement-breakpoint
CREATE INDEX `exams_author_idx` ON `exams` (`author_id`);--> statement-breakpoint
CREATE INDEX `exams_subject_idx` ON `exams` (`subject`);--> statement-breakpoint
CREATE TABLE `expected_run_students` (
	`run_id` text NOT NULL,
	`google_user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	PRIMARY KEY(`run_id`, `google_user_id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`question_id` text NOT NULL,
	`auto` integer,
	`override` integer,
	`points_awarded` integer,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_participant_question_uq` ON `grades` (`participant_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`at` integer NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `incidents_participant_idx` ON `incidents` (`participant_id`);--> statement-breakpoint
CREATE INDEX `incidents_at_idx` ON `incidents` (`at`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`google_domain` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_google_domain_uq` ON `organizations` (`google_domain`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`submitted_at` integer,
	`submit_reason` text,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_run_user_uq` ON `participants` (`run_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `participants_run_idx` ON `participants` (`run_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`prompt` text NOT NULL,
	`points` integer NOT NULL,
	`config` text NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `questions_exam_position_uq` ON `questions` (`exam_id`,`position`);--> statement-breakpoint
CREATE INDEX `questions_exam_idx` ON `questions` (`exam_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text,
	`code` text(6) NOT NULL,
	`title` text NOT NULL,
	`questions_snapshot` text NOT NULL,
	`time_limit_s` integer NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`classroom_course_id` text,
	`classroom_coursework_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`ends_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_code_uq` ON `runs` (`code`);--> statement-breakpoint
CREATE INDEX `runs_exam_idx` ON `runs` (`exam_id`);--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_uq` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`role` text NOT NULL,
	`google_sub` text,
	`org_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_uq` ON `users` (`google_sub`);--> statement-breakpoint
CREATE INDEX `users_org_idx` ON `users` (`org_id`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);