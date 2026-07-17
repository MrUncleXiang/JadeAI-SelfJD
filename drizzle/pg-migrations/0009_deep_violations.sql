CREATE TABLE "github_connection_states" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"return_path" text DEFAULT '/knowledge' NOT NULL,
	"expires_at" integer NOT NULL,
	"consumed_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "github_connection_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"permissions" text DEFAULT '{}' NOT NULL,
	"suspended_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "github_installations_source_connection_id_unique" UNIQUE("source_connection_id"),
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "source_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_synced_at" integer,
	"last_error_code" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_repository_id" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_commit_sha" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"request_id" text,
	"webhook_delivery_id" text,
	"next_attempt_at" integer,
	"started_at" integer,
	"completed_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "sync_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"installation_id" text,
	"repository_external_id" text,
	"ref" text,
	"before_sha" text,
	"after_sha" text,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"sync_job_id" text,
	"error_code" text,
	"received_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"processed_at" integer
);
--> statement-breakpoint
DROP INDEX "source_snapshots_repository_commit_uq";--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "security_findings" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "llm_eligible" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "github_connection_states" ADD CONSTRAINT "github_connection_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connection_states" ADD CONSTRAINT "github_connection_states_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_source_repository_id_source_repositories_id_fk" FOREIGN KEY ("source_repository_id") REFERENCES "public"."source_repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_connection_states_user_idx" ON "github_connection_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_connection_states_expires_at_idx" ON "github_connection_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "github_installations_user_idx" ON "github_installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_installations_account_idx" ON "github_installations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "source_connections_user_provider_idx" ON "source_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "sync_jobs_user_status_idx" ON "sync_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "sync_jobs_repository_created_idx" ON "sync_jobs" USING btree ("source_repository_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_jobs_next_attempt_idx" ON "sync_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_installation_idx" ON "webhook_deliveries" USING btree ("installation_id","received_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_repository_idx" ON "webhook_deliveries" USING btree ("repository_external_id","received_at");--> statement-breakpoint
CREATE INDEX "source_repositories_connection_selected_idx" ON "source_repositories" USING btree ("source_connection_id","selected");--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshots_repository_commit_uq" ON "source_snapshots" USING btree ("source_repository_id","commit_sha","parser_id","parser_version");