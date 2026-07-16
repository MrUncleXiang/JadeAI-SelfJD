CREATE TABLE "auth_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"window_started_at" integer NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" integer,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limits_blocked_until_idx" ON "auth_rate_limits" USING btree ("blocked_until");