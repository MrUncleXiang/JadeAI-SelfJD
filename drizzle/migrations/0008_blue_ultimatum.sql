CREATE TABLE `llm_feature_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`feature` text NOT NULL,
	`llm_profile_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`llm_profile_id`) REFERENCES `llm_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_feature_bindings_user_feature_uq` ON `llm_feature_bindings` (`user_id`,`feature`);--> statement-breakpoint
CREATE INDEX `llm_feature_bindings_profile_id_idx` ON `llm_feature_bindings` (`llm_profile_id`);--> statement-breakpoint
CREATE TABLE `llm_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text NOT NULL,
	`model_name` text NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`key_iv` text NOT NULL,
	`key_tag` text NOT NULL,
	`key_version` integer NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`last_tested_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `llm_profiles_user_id_idx` ON `llm_profiles` (`user_id`);