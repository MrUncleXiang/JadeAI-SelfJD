CREATE TABLE `github_pat_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_connection_id` text NOT NULL,
	`label` text NOT NULL,
	`account_id` text NOT NULL,
	`account_login` text NOT NULL,
	`encrypted_token` text NOT NULL,
	`token_iv` text NOT NULL,
	`token_tag` text NOT NULL,
	`key_version` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_connection_id`) REFERENCES `source_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_pat_credentials_source_connection_id_unique` ON `github_pat_credentials` (`source_connection_id`);--> statement-breakpoint
CREATE INDEX `github_pat_credentials_user_idx` ON `github_pat_credentials` (`user_id`);--> statement-breakpoint
CREATE INDEX `github_pat_credentials_account_idx` ON `github_pat_credentials` (`account_id`);