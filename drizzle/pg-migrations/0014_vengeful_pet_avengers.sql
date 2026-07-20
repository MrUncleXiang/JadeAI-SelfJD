ALTER TABLE "resumes" ADD COLUMN "kind" text DEFAULT 'baseline' NOT NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "parent_resume_id" text;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "target_jd_source_id" text;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_target_jd_source_id_jd_sources_id_fk" FOREIGN KEY ("target_jd_source_id") REFERENCES "public"."jd_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resumes_user_kind_updated_idx" ON "resumes" USING btree ("user_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "resumes_parent_resume_idx" ON "resumes" USING btree ("parent_resume_id");--> statement-breakpoint
CREATE INDEX "resumes_target_jd_source_idx" ON "resumes" USING btree ("target_jd_source_id");