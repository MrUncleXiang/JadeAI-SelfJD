ALTER TABLE `resumes` ADD `kind` text DEFAULT 'baseline' NOT NULL;--> statement-breakpoint
ALTER TABLE `resumes` ADD `parent_resume_id` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `target_jd_source_id` text REFERENCES jd_sources(id);--> statement-breakpoint
CREATE INDEX `resumes_user_kind_updated_idx` ON `resumes` (`user_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE INDEX `resumes_parent_resume_idx` ON `resumes` (`parent_resume_id`);--> statement-breakpoint
CREATE INDEX `resumes_target_jd_source_idx` ON `resumes` (`target_jd_source_id`);