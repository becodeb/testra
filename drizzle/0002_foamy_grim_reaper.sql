CREATE TABLE `accounts_new` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text NOT NULL,
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
);--> statement-breakpoint
INSERT INTO `accounts_new` (
	`id`, `account_id`, `provider_id`, `issuer`, `user_id`, `access_token`, `refresh_token`, `id_token`,
	`access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at`
)
SELECT
	`id`,
	CASE WHEN `provider_id` = 'credential' THEN `user_id` ELSE `account_id` END,
	`provider_id`,
	CASE
		WHEN `provider_id` = 'credential' THEN 'local:credential'
		WHEN `provider_id` = 'google' THEN 'https://accounts.google.com'
		ELSE 'local:oauth:' || `provider_id`
	END,
	`user_id`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`,
	`refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at`
FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `accounts_new` RENAME TO `accounts`;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_issuer_account_uq` ON `accounts` (`issuer`,`account_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);
