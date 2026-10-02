CREATE TABLE "admissions_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL,
	"conditions" text,
	"offer_expires_at" timestamp,
	"deposit_required" integer DEFAULT 0 NOT NULL,
	"deposit_amount" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" real NOT NULL,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"payment_reference" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_status_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"person_id" text,
	"status" text NOT NULL,
	"term_id" text,
	"changed_by" text NOT NULL,
	"reason" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esignatures" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"person_id" text,
	"signed_name" text NOT NULL,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"document_version_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_aid_awards" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"aid_type" text NOT NULL,
	"amount" real NOT NULL,
	"status" text DEFAULT 'awarded' NOT NULL,
	"term_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advising_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"term_id" text NOT NULL,
	"advisor_id" text NOT NULL,
	"released_at" timestamp DEFAULT now() NOT NULL,
	"pin" text
);
--> statement-breakpoint
CREATE TABLE "course_section_waitlists" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"student_id" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_fees" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"term_id" text NOT NULL,
	"amount" real NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "possible_duplicate_of" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "verification_status" text DEFAULT 'self_reported' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source" text DEFAULT 'upload';--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "course_sections" ADD COLUMN "seats_taken" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "course_sections" ADD COLUMN "seats_held" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_holds" ADD COLUMN "blocks" text DEFAULT 'registration' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_holds" ADD COLUMN "placed_by" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "official_student_id" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "catalog_year_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_decisions_app_id_unique" ON "admissions_decisions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "idx_admissions_decisions_decision" ON "admissions_decisions" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "idx_enrollment_deposits_app_id" ON "enrollment_deposits" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "idx_enrollment_deposits_user_id" ON "enrollment_deposits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_enrollment_status_user" ON "enrollment_status_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_enrollment_status_current" ON "enrollment_status_logs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_esignatures_user_id" ON "esignatures" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_esignatures_doc_id" ON "esignatures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_financial_aid_student" ON "financial_aid_awards" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_financial_aid_term" ON "financial_aid_awards" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advising_releases_student_term_unique" ON "advising_releases" USING btree ("student_id","term_id");--> statement-breakpoint
CREATE INDEX "idx_advising_releases_student" ON "advising_releases" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_section_waitlists_section_student_unique" ON "course_section_waitlists" USING btree ("section_id","student_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_section" ON "course_section_waitlists" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_student" ON "course_section_waitlists" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_fees_program_term_unique" ON "program_fees" USING btree ("program_id","term_id");--> statement-breakpoint
CREATE INDEX "idx_program_fees_program" ON "program_fees" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "idx_programs_level" ON "programs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_programs_active" ON "programs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_student_holds_active" ON "student_holds" USING btree ("student_id","is_active");