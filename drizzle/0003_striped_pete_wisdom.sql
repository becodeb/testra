PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`guest_token_hash` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`submitted_at` integer,
	`submit_reason` text,
	`classroom_submission_id` text,
	`late` integer DEFAULT false NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_participants`("id", "run_id", "user_id", "display_name", "guest_token_hash", "status", "joined_at", "submitted_at", "submit_reason", "classroom_submission_id", "late", "last_seen")
SELECT p."id", p."run_id", p."user_id", COALESCE(u."name", 'Alumno'), NULL, p."status", p."joined_at", p."submitted_at", p."submit_reason", p."classroom_submission_id", p."late", p."last_seen"
FROM `participants` p LEFT JOIN `users` u ON u."id" = p."user_id";--> statement-breakpoint
DROP TABLE `participants`;--> statement-breakpoint
ALTER TABLE `__new_participants` RENAME TO `participants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `participants_run_user_uq` ON `participants` (`run_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_guest_token_uq` ON `participants` (`guest_token_hash`);--> statement-breakpoint
CREATE INDEX `participants_run_idx` ON `participants` (`run_id`);
