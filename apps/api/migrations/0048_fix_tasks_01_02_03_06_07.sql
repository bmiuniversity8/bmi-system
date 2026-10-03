-- Migration: 0048_fix_tasks_01_02_03_06_07.sql
-- Consolidated schema fixes for BMI-all-fix-prompts Tasks 01, 02, 03, 06, 07.
-- Must replay cleanly on an empty SQLite DB in order.
--
-- 1. Rebuild `applications` with wider status CHECK adding 'withdrawn' and 'expired'
--    (Tasks 01/02). Preserves every column present after 0047 plus all indexes
--    (including the partial unique index on application_number from 0046).
-- 2. UNIQUE index on enrollment_deposits(payment_reference) for idempotent
--    deposit fulfillment (Task 03).
-- 3. Add registration_opens_at, registration_closes_at, census_date to
--    academic_terms (Task 06; used by Tasks 07/08).
-- 4. Add nullable term_id to invoices and esignatures (Task 07).

PRAGMA foreign_keys=off;

-- ─── 1. Rebuild applications with wider CHECK ──────────────────────────────
CREATE TABLE IF NOT EXISTS applications_new (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program         TEXT NOT NULL,
  program_id      TEXT REFERENCES programs(id),
  degree_level    TEXT NOT NULL CHECK(degree_level IN ('undergraduate','graduate','doctorate','certificate','diploma')),
  status          TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('draft','submitted','under_review','accepted','rejected','waitlisted','withdrawn','expired')),
  personal_statement TEXT,
  prior_education TEXT,
  submitted_at    TEXT,
  reviewed_at     TEXT,
  reviewer_id     TEXT REFERENCES users(id),
  reviewer_notes  TEXT,
  application_number TEXT,
  high_school     TEXT,
  graduation_year INTEGER,
  gpa             REAL,
  possible_duplicate_of TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO applications_new (
  id, user_id, program, program_id, degree_level, status, personal_statement, prior_education,
  submitted_at, reviewed_at, reviewer_id, reviewer_notes, application_number,
  high_school, graduation_year, gpa, possible_duplicate_of, created_at, updated_at
)
SELECT
  id, user_id, program, program_id, degree_level, status, personal_statement, prior_education,
  submitted_at, reviewed_at, reviewer_id, reviewer_notes, application_number,
  high_school, graduation_year, gpa, possible_duplicate_of, created_at, updated_at
FROM applications;

DROP TABLE applications;
ALTER TABLE applications_new RENAME TO applications;

CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at);
CREATE INDEX IF NOT EXISTS idx_applications_program_level ON applications(program, degree_level);
CREATE INDEX IF NOT EXISTS idx_apps_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_apps_program_id ON applications(program_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_number ON applications(application_number) WHERE application_number IS NOT NULL;

-- ─── 2. Idempotent deposits (Task 03) ──────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_deposits_payment_ref_unique
  ON enrollment_deposits(payment_reference);

-- ─── 3. Registration window + census date (Task 06) ────────────────────────
ALTER TABLE academic_terms ADD COLUMN registration_opens_at TEXT;
ALTER TABLE academic_terms ADD COLUMN registration_closes_at TEXT;
ALTER TABLE academic_terms ADD COLUMN census_date TEXT;

-- ─── 4. Term-scoped finance + agreement (Task 07) ──────────────────────────
ALTER TABLE invoices ADD COLUMN term_id TEXT REFERENCES academic_terms(id);
CREATE INDEX IF NOT EXISTS idx_invoices_term ON invoices(term_id);

ALTER TABLE esignatures ADD COLUMN term_id TEXT REFERENCES academic_terms(id);
CREATE INDEX IF NOT EXISTS idx_esignatures_term ON esignatures(term_id);

-- Default credit cap used by registration validation (Task 06).
INSERT OR IGNORE INTO app_config (key, value) VALUES ('max_credits_per_term', '18');

PRAGMA foreign_keys=on;
