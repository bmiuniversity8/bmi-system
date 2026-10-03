DROP INDEX "idx_applications_number";--> statement-breakpoint
ALTER TABLE "academic_terms" ADD COLUMN "registration_opens_at" timestamp;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD COLUMN "registration_closes_at" timestamp;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD COLUMN "census_date" timestamp;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "program_id" text;--> statement-breakpoint
ALTER TABLE "esignatures" ADD COLUMN "term_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "term_id" text;--> statement-breakpoint
CREATE INDEX "idx_apps_program_id" ON "applications" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_enrollment_deposits_payment_ref_unique" ON "enrollment_deposits" USING btree ("payment_reference");--> statement-breakpoint
CREATE INDEX "idx_esignatures_term" ON "esignatures" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_term" ON "invoices" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_applications_number" ON "applications" USING btree ("application_number") WHERE "applications"."application_number" IS NOT NULL;