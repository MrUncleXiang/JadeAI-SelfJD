CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"outcome" text NOT NULL,
	"request_id" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_version" integer NOT NULL,
	"expires_at" integer NOT NULL,
	"last_seen_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"user_agent_hash" text,
	"ip_prefix" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"revoked_at" integer,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" integer,
	"created_by" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"disabled_at" integer,
	CONSTRAINT "invitations_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "password_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_normalized" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_normalized" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" integer;--> statement-breakpoint
UPDATE "users"
SET "email_normalized" = lower(trim("email"))
WHERE "email" IS NOT NULL
	AND trim("email") <> ''
	AND lower(trim("email")) IN (
		SELECT lower(trim("email"))
		FROM "users"
		WHERE "email" IS NOT NULL AND trim("email") <> ''
		GROUP BY lower(trim("email"))
		HAVING count(*) = 1
	);--> statement-breakpoint
INSERT INTO "audit_events" ("id", "action", "target_type", "target_id", "outcome", "metadata")
SELECT 'migration-email-conflict-' || "id", 'auth.migration_identity_conflict', 'user', "id", 'failure', '{"reason":"duplicate_normalized_email"}'
FROM "users"
WHERE "email" IS NOT NULL
	AND trim("email") <> ''
	AND lower(trim("email")) IN (
		SELECT lower(trim("email"))
		FROM "users"
		WHERE "email" IS NOT NULL AND trim("email") <> ''
		GROUP BY lower(trim("email"))
		HAVING count(*) > 1
	);--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invitations_created_by_idx" ON "invitations" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_normalized_unique" UNIQUE("username_normalized");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_unique" UNIQUE("email_normalized");
