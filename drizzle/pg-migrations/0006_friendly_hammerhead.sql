CREATE TABLE "llm_feature_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"llm_profile_id" text NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"model_name" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"key_iv" text NOT NULL,
	"key_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"capabilities" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"last_tested_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_feature_bindings" ADD CONSTRAINT "llm_feature_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_feature_bindings" ADD CONSTRAINT "llm_feature_bindings_llm_profile_id_llm_profiles_id_fk" FOREIGN KEY ("llm_profile_id") REFERENCES "public"."llm_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_profiles" ADD CONSTRAINT "llm_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_feature_bindings_user_feature_uq" ON "llm_feature_bindings" USING btree ("user_id","feature");--> statement-breakpoint
CREATE INDEX "llm_feature_bindings_profile_id_idx" ON "llm_feature_bindings" USING btree ("llm_profile_id");--> statement-breakpoint
CREATE INDEX "llm_profiles_user_id_idx" ON "llm_profiles" USING btree ("user_id");