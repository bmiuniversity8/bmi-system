import { neon } from '@neondatabase/serverless';

const NEON_URL = process.env.DATABASE_URL_CORE || process.env.DATABASE_URL;
if (!NEON_URL) {
  throw new Error("DATABASE_URL_CORE or DATABASE_URL environment variable is required.");
}
const sql = neon(NEON_URL);

async function main() {
  console.log('🚀 Applying migration 0001 to Neon PostgreSQL...');

  const statements = [
    // Tables
    `CREATE TABLE IF NOT EXISTS "admissions_decisions" (
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
    );`,
    `CREATE TABLE IF NOT EXISTS "enrollment_deposits" (
      "id" text PRIMARY KEY NOT NULL,
      "application_id" text NOT NULL,
      "user_id" text NOT NULL,
      "amount" real NOT NULL,
      "paid_at" timestamp DEFAULT now() NOT NULL,
      "payment_reference" text NOT NULL,
      "status" text DEFAULT 'confirmed' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "enrollment_status_logs" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "person_id" text,
      "status" text NOT NULL,
      "term_id" text,
      "changed_by" text NOT NULL,
      "reason" text,
      "changed_at" timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "esignatures" (
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
    );`,
    `CREATE TABLE IF NOT EXISTS "financial_aid_awards" (
      "id" text PRIMARY KEY NOT NULL,
      "student_id" text NOT NULL,
      "aid_type" text NOT NULL,
      "amount" real NOT NULL,
      "status" text DEFAULT 'awarded' NOT NULL,
      "term_id" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "advising_releases" (
      "id" text PRIMARY KEY NOT NULL,
      "student_id" text NOT NULL,
      "term_id" text NOT NULL,
      "advisor_id" text NOT NULL,
      "released_at" timestamp DEFAULT now() NOT NULL,
      "pin" text
    );`,
    `CREATE TABLE IF NOT EXISTS "course_section_waitlists" (
      "id" text PRIMARY KEY NOT NULL,
      "section_id" text NOT NULL,
      "student_id" text NOT NULL,
      "position" integer DEFAULT 1 NOT NULL,
      "added_at" timestamp DEFAULT now() NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS "program_fees" (
      "id" text PRIMARY KEY NOT NULL,
      "program_id" text NOT NULL,
      "term_id" text NOT NULL,
      "amount" real NOT NULL,
      "description" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );`,

    // Columns
    `ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "possible_duplicate_of" text;`,
    `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "verification_status" text DEFAULT 'self_reported' NOT NULL;`,
    `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "verified_by" text;`,
    `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;`,
    `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'upload';`,
    `ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "description" text;`,
    `ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "icon" text;`,
    `ALTER TABLE "course_sections" ADD COLUMN IF NOT EXISTS "seats_taken" integer DEFAULT 0 NOT NULL;`,
    `ALTER TABLE "course_sections" ADD COLUMN IF NOT EXISTS "seats_held" integer DEFAULT 0 NOT NULL;`,
    `ALTER TABLE "student_holds" ADD COLUMN IF NOT EXISTS "blocks" text DEFAULT 'registration' NOT NULL;`,
    `ALTER TABLE "student_holds" ADD COLUMN IF NOT EXISTS "placed_by" text;`,
    `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "official_student_id" text;`,
    `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "catalog_year_id" text;`,

    // Indexes
    `CREATE UNIQUE INDEX IF NOT EXISTS "admissions_decisions_app_id_unique" ON "admissions_decisions" USING btree ("application_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_admissions_decisions_decision" ON "admissions_decisions" USING btree ("decision");`,
    `CREATE INDEX IF NOT EXISTS "idx_enrollment_deposits_app_id" ON "enrollment_deposits" USING btree ("application_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_enrollment_deposits_user_id" ON "enrollment_deposits" USING btree ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_enrollment_status_user" ON "enrollment_status_logs" USING btree ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_enrollment_status_current" ON "enrollment_status_logs" USING btree ("user_id","status");`,
    `CREATE INDEX IF NOT EXISTS "idx_esignatures_user_id" ON "esignatures" USING btree ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_esignatures_doc_id" ON "esignatures" USING btree ("document_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_financial_aid_student" ON "financial_aid_awards" USING btree ("student_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_financial_aid_term" ON "financial_aid_awards" USING btree ("term_id");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "advising_releases_student_term_unique" ON "advising_releases" USING btree ("student_id","term_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_advising_releases_student" ON "advising_releases" USING btree ("student_id");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "course_section_waitlists_section_student_unique" ON "course_section_waitlists" USING btree ("section_id","student_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_waitlist_section" ON "course_section_waitlists" USING btree ("section_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_waitlist_student" ON "course_section_waitlists" USING btree ("student_id");`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "program_fees_program_term_unique" ON "program_fees" USING btree ("program_id","term_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_program_fees_program" ON "program_fees" USING btree ("program_id");`,
    `CREATE INDEX IF NOT EXISTS "idx_programs_level" ON "programs" USING btree ("level");`,
    `CREATE INDEX IF NOT EXISTS "idx_programs_active" ON "programs" USING btree ("is_active");`,
    `CREATE INDEX IF NOT EXISTS "idx_student_holds_active" ON "student_holds" USING btree ("student_id","is_active");`
  ];

  let successCount = 0;
  for (const stmt of statements) {
    try {
      await (sql as any).query(stmt);
      successCount++;
    } catch (e: any) {
      console.error('Error executing statement:', stmt.slice(0, 60), '...', e.message);
    }
  }

  console.log(`✅ Applied ${successCount}/${statements.length} statements successfully!`);

  // Verify column exists now
  const cols = await (sql as any).query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'applications' AND column_name = 'possible_duplicate_of';
  `);
  console.log('possible_duplicate_of in applications:', cols);
}

main().catch(console.error);
