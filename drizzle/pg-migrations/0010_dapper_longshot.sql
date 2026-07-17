CREATE TABLE "github_pat_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"label" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "github_pat_credentials_source_connection_id_unique" UNIQUE("source_connection_id")
);
--> statement-breakpoint
ALTER TABLE "github_pat_credentials" ADD CONSTRAINT "github_pat_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pat_credentials" ADD CONSTRAINT "github_pat_credentials_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_pat_credentials_user_idx" ON "github_pat_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_pat_credentials_account_idx" ON "github_pat_credentials" USING btree ("account_id");