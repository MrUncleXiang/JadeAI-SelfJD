CREATE TABLE `resume_change_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`change_set_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`type` text NOT NULL,
	`section_id` text,
	`item_id` text,
	`expected_hash` text,
	`value` text,
	`reason` text NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`jd_requirement_ids` text DEFAULT '[]' NOT NULL,
	`confidence_basis_points` integer DEFAULT 0 NOT NULL,
	`diff` text DEFAULT '{}' NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`result` text DEFAULT 'pending' NOT NULL,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`change_set_id`) REFERENCES `resume_change_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resume_change_operations_set_operation_uq` ON `resume_change_operations` (`change_set_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `resume_change_operations_change_set_idx` ON `resume_change_operations` (`change_set_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `resume_change_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`base_version_id` text NOT NULL,
	`applied_version_id` text,
	`status` text DEFAULT 'validated' NOT NULL,
	`llm_profile_id` text,
	`provider` text,
	`model_name` text,
	`prompt_version` text DEFAULT 'resume-patch-v1' NOT NULL,
	`request_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`validation_result` text DEFAULT '{}' NOT NULL,
	`raw_model_output` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `resume_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`applied_version_id`) REFERENCES `resume_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`llm_profile_id`) REFERENCES `llm_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `resume_change_sets_user_resume_idx` ON `resume_change_sets` (`user_id`,`resume_id`);--> statement-breakpoint
CREATE INDEX `resume_change_sets_base_version_idx` ON `resume_change_sets` (`base_version_id`);--> statement-breakpoint
CREATE INDEX `resume_change_sets_created_at_idx` ON `resume_change_sets` (`created_at`);--> statement-breakpoint
CREATE TABLE `resume_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`snapshot` text NOT NULL,
	`source` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resume_versions_resume_number_uq` ON `resume_versions` (`resume_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `resume_versions_user_resume_idx` ON `resume_versions` (`user_id`,`resume_id`);--> statement-breakpoint
CREATE INDEX `resume_versions_resume_created_at_idx` ON `resume_versions` (`resume_id`,`created_at`);