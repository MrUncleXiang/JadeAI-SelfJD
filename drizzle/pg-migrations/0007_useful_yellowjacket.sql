CREATE TABLE "resume_change_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"change_set_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"type" text NOT NULL,
	"section_id" text,
	"item_id" text,
	"expected_hash" text,
	"value" text,
	"reason" text NOT NULL,
	"evidence_ids" text DEFAULT '[]' NOT NULL,
	"jd_requirement_ids" text DEFAULT '[]' NOT NULL,
	"confidence_basis_points" integer DEFAULT 0 NOT NULL,
	"diff" text DEFAULT '{}' NOT NULL,
	"selected" integer DEFAULT 0 NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_change_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resume_id" text NOT NULL,
	"base_version_id" text NOT NULL,
	"applied_version_id" text,
	"status" text DEFAULT 'validated' NOT NULL,
	"llm_profile_id" text,
	"provider" text,
	"model_name" text,
	"prompt_version" text DEFAULT 'resume-patch-v1' NOT NULL,
	"request_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"warnings" text DEFAULT '[]' NOT NULL,
	"validation_result" text DEFAULT '{}' NOT NULL,
	"raw_model_output" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resume_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" text NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_change_operations" ADD CONSTRAINT "resume_change_operations_change_set_id_resume_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."resume_change_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_change_sets" ADD CONSTRAINT "resume_change_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_change_sets" ADD CONSTRAINT "resume_change_sets_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_change_sets" ADD CONSTRAINT "resume_change_sets_base_version_id_resume_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_change_sets" ADD CONSTRAINT "resume_change_sets_applied_version_id_resume_versions_id_fk" FOREIGN KEY ("applied_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_change_sets" ADD CONSTRAINT "resume_change_sets_llm_profile_id_llm_profiles_id_fk" FOREIGN KEY ("llm_profile_id") REFERENCES "public"."llm_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_change_operations_set_operation_uq" ON "resume_change_operations" USING btree ("change_set_id","operation_id");--> statement-breakpoint
CREATE INDEX "resume_change_operations_change_set_idx" ON "resume_change_operations" USING btree ("change_set_id","sort_order");--> statement-breakpoint
CREATE INDEX "resume_change_sets_user_resume_idx" ON "resume_change_sets" USING btree ("user_id","resume_id");--> statement-breakpoint
CREATE INDEX "resume_change_sets_base_version_idx" ON "resume_change_sets" USING btree ("base_version_id");--> statement-breakpoint
CREATE INDEX "resume_change_sets_created_at_idx" ON "resume_change_sets" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_versions_resume_number_uq" ON "resume_versions" USING btree ("resume_id","version_number");--> statement-breakpoint
CREATE INDEX "resume_versions_user_resume_idx" ON "resume_versions" USING btree ("user_id","resume_id");--> statement-breakpoint
CREATE INDEX "resume_versions_resume_created_at_idx" ON "resume_versions" USING btree ("resume_id","created_at");