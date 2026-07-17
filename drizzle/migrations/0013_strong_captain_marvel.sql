CREATE TABLE `jd_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`jd_source_id` text NOT NULL,
	`requirement_type` text NOT NULL,
	`text` text NOT NULL,
	`normalized_term` text DEFAULT '' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`importance_basis_points` integer DEFAULT 5000 NOT NULL,
	`source_locator` text DEFAULT '{}' NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`jd_source_id`) REFERENCES `jd_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jd_requirements_source_sort_uq` ON `jd_requirements` (`jd_source_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `jd_requirements_user_source_idx` ON `jd_requirements` (`user_id`,`jd_source_id`);--> statement-breakpoint
CREATE TABLE `jd_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`input_type` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`job_title` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`original_filename` text,
	`mime_type` text DEFAULT 'text/plain' NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_hash` text NOT NULL,
	`raw_text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`parser_id` text,
	`parser_version` text,
	`error_code` text,
	`confirmed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jd_sources_user_content_hash_uq` ON `jd_sources` (`user_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `jd_sources_user_status_updated_idx` ON `jd_sources` (`user_id`,`status`,`updated_at`);