CREATE TABLE `career_fact_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`career_fact_id` text NOT NULL,
	`claim_type` text NOT NULL,
	`claim` text NOT NULL,
	`normalized_claim` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`career_fact_id`) REFERENCES `career_facts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `career_fact_claims_fact_type_normalized_uq` ON `career_fact_claims` (`career_fact_id`,`claim_type`,`normalized_claim`);--> statement-breakpoint
CREATE INDEX `career_fact_claims_user_fact_idx` ON `career_fact_claims` (`user_id`,`career_fact_id`);--> statement-breakpoint
CREATE TABLE `career_fact_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`career_fact_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`path` text NOT NULL,
	`locator` text NOT NULL,
	`content_hash` text NOT NULL,
	`excerpt_hash` text,
	`summary` text DEFAULT '' NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`career_fact_id`) REFERENCES `career_facts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_document_id`) REFERENCES `source_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `career_fact_evidence_fact_document_locator_hash_uq` ON `career_fact_evidence` (`career_fact_id`,`source_document_id`,`locator`,`content_hash`);--> statement-breakpoint
CREATE INDEX `career_fact_evidence_user_fact_idx` ON `career_fact_evidence` (`user_id`,`career_fact_id`);--> statement-breakpoint
CREATE TABLE `career_fact_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`career_fact_id` text NOT NULL,
	`related_fact_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`career_fact_id`) REFERENCES `career_facts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_fact_id`) REFERENCES `career_facts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `career_fact_relations_fact_related_type_uq` ON `career_fact_relations` (`career_fact_id`,`related_fact_id`,`relation_type`);--> statement-breakpoint
CREATE INDEX `career_fact_relations_user_fact_idx` ON `career_fact_relations` (`user_id`,`career_fact_id`);--> statement-breakpoint
CREATE TABLE `career_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`fact_type` text NOT NULL,
	`canonical_key` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`structured_data` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`confidence_basis_points` integer DEFAULT 0 NOT NULL,
	`content_hash` text NOT NULL,
	`supersedes_fact_id` text,
	`superseded_by_fact_id` text,
	`created_by` text DEFAULT 'import' NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`source_parser_id` text,
	`source_parser_version` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `career_facts_user_key_hash_uq` ON `career_facts` (`user_id`,`canonical_key`,`content_hash`);--> statement-breakpoint
CREATE INDEX `career_facts_user_status_type_idx` ON `career_facts` (`user_id`,`status`,`fact_type`);--> statement-breakpoint
CREATE INDEX `career_facts_supersedes_idx` ON `career_facts` (`supersedes_fact_id`);--> statement-breakpoint
CREATE TABLE `fact_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`career_fact_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`before_state` text,
	`after_state` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`career_fact_id`) REFERENCES `career_facts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fact_review_events_user_fact_created_idx` ON `fact_review_events` (`user_id`,`career_fact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `source_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_snapshot_id` text NOT NULL,
	`path` text NOT NULL,
	`blob_sha` text,
	`content_hash` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`text_content` text,
	`parse_status` text DEFAULT 'ready' NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `source_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_documents_snapshot_path_uq` ON `source_documents` (`source_snapshot_id`,`path`);--> statement-breakpoint
CREATE INDEX `source_documents_user_id_idx` ON `source_documents` (`user_id`);--> statement-breakpoint
CREATE TABLE `source_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_connection_id` text,
	`external_repository_id` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`selected` integer DEFAULT true NOT NULL,
	`last_head_sha` text,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_repositories_user_source_external_uq` ON `source_repositories` (`user_id`,`source_type`,`external_repository_id`);--> statement-breakpoint
CREATE INDEX `source_repositories_user_id_idx` ON `source_repositories` (`user_id`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_repository_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`tree_sha` text,
	`parent_snapshot_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_repository_id`) REFERENCES `source_repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_snapshots_repository_commit_uq` ON `source_snapshots` (`source_repository_id`,`commit_sha`);--> statement-breakpoint
CREATE INDEX `source_snapshots_user_id_idx` ON `source_snapshots` (`user_id`);