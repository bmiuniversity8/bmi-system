-- ============================================================================
-- Migration: 0042_workflow_and_admissions_tables.sql
--
-- Synchronizes the Cloudflare D1 schema track with the canonical core PostgreSQL
-- schema track and implements all workflow tables required for end-to-end
-- admissions, holds enforcement, atomic seat registration, and lifecycle sync.
--
-- Tables & Changes:
--   1. admissions_decisions — tracks official admission decisions, conditions,
--      offer expiry dates, and required deposit amounts.
--   2. enrollment_deposits — records confirmed deposit payments for admitted students.
--   3. enrollment_status_logs — immutable audit log of every lifecycle state transition.
--   4. esignatures — legally binding e-signatures for enrollment terms and agreements.
--   5. financial_aid_awards — student financial aid grants/disbursements.
--   6. advising_releases — advisor term clearance for registration eligibility.
--   7. course_section_waitlists — queue for full course sections with FIFO positions.
--   8. program_fees — term tuition/fee structure per academic program.
--   9. prospects — Stage 0 inquiry capture and lead tracking.
--  10. student_holds — rebuilt without restrictive check constraint, adding
--      'blocks' (default 'registration') and 'placed_by' columns.
--  11. Adds missing columns on applications, documents, course_sections, and students.
-- ============================================================================

-- 1. ADMISSIONS DECISIONS
CREATE TABLE IF NOT EXISTS admissions_decisions (
  id                TEXT PRIMARY KEY,
  application_id    TEXT NOT NULL UNIQUE,
  decision          TEXT NOT NULL,
  decided_by        TEXT NOT NULL,
  decided_at        TEXT NOT NULL DEFAULT (datetime('now')),
  conditions        TEXT,
  offer_expires_at  TEXT,
  deposit_required  INTEGER NOT NULL DEFAULT 0,
  deposit_amount    REAL NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admissions_decisions_decision ON admissions_decisions(decision);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admissions_decisions_app_unique ON admissions_decisions(application_id);

-- 2. ENROLLMENT DEPOSITS
CREATE TABLE IF NOT EXISTS enrollment_deposits (
  id                TEXT PRIMARY KEY,
  application_id    TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  amount            REAL NOT NULL,
  paid_at           TEXT NOT NULL DEFAULT (datetime('now')),
  payment_reference TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'confirmed',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enrollment_deposits_app_id ON enrollment_deposits(application_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_deposits_user_id ON enrollment_deposits(user_id);

-- 3. ENROLLMENT STATUS LOGS (Immutable audit log)
CREATE TABLE IF NOT EXISTS enrollment_status_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  person_id   TEXT,
  status      TEXT NOT NULL,
  term_id     TEXT,
  changed_by  TEXT NOT NULL,
  reason      TEXT,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enrollment_status_user ON enrollment_status_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_status_current ON enrollment_status_logs(user_id, status);

-- 4. ESIGNATURES (Binding e-signature records)
CREATE TABLE IF NOT EXISTS esignatures (
  id                    TEXT PRIMARY KEY,
  document_id           TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  person_id             TEXT,
  signed_name           TEXT NOT NULL,
  signed_at             TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address            TEXT,
  user_agent            TEXT,
  document_version_hash TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_esignatures_user_id ON esignatures(user_id);
CREATE INDEX IF NOT EXISTS idx_esignatures_doc_id ON esignatures(document_id);

-- 5. FINANCIAL AID AWARDS
CREATE TABLE IF NOT EXISTS financial_aid_awards (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  aid_type    TEXT NOT NULL,
  amount      REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'awarded',
  term_id     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_financial_aid_student ON financial_aid_awards(student_id);
CREATE INDEX IF NOT EXISTS idx_financial_aid_term ON financial_aid_awards(term_id);

-- 6. ADVISING RELEASES
CREATE TABLE IF NOT EXISTS advising_releases (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  term_id     TEXT NOT NULL,
  advisor_id  TEXT NOT NULL,
  released_at TEXT NOT NULL DEFAULT (datetime('now')),
  pin         TEXT,
  UNIQUE(student_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_advising_releases_student ON advising_releases(student_id);

-- 7. COURSE SECTION WAITLISTS
CREATE TABLE IF NOT EXISTS course_section_waitlists (
  id          TEXT PRIMARY KEY,
  section_id  TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 1,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(section_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_section ON course_section_waitlists(section_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_student ON course_section_waitlists(student_id);

-- 8. PROGRAM FEES
CREATE TABLE IF NOT EXISTS program_fees (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL,
  term_id     TEXT NOT NULL,
  amount      REAL NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(program_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_program_fees_program ON program_fees(program_id);

-- 9. PROSPECTS (Stage 0 Inquiry Tracking)
CREATE TABLE IF NOT EXISTS prospects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  program_interest  TEXT,
  source            TEXT DEFAULT 'website',
  consent_given     INTEGER NOT NULL DEFAULT 1,
  status            TEXT DEFAULT 'new',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);

-- 10. REBUILD STUDENT_HOLDS (Enforce blocks, placed_by, and expand hold types)
PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS student_holds_new (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hold_type   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  blocks      TEXT NOT NULL DEFAULT 'registration',
  placed_by   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  metadata    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

INSERT OR IGNORE INTO student_holds_new (id, student_id, hold_type, reason, blocks, placed_by, is_active, metadata, created_at, resolved_at)
SELECT id, student_id, hold_type, reason, 'registration', NULL, is_active, metadata, created_at, resolved_at FROM student_holds;

DROP TABLE student_holds;
ALTER TABLE student_holds_new RENAME TO student_holds;

CREATE INDEX IF NOT EXISTS idx_student_holds_student ON student_holds(student_id);
CREATE INDEX IF NOT EXISTS idx_student_holds_active ON student_holds(student_id, is_active);

PRAGMA foreign_keys=on;

-- 11. ADD MISSING COLUMNS TO EXISTING TABLES
ALTER TABLE applications ADD COLUMN possible_duplicate_of TEXT;
ALTER TABLE documents ADD COLUMN verified_by TEXT;
ALTER TABLE documents ADD COLUMN verified_at TEXT;
ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'upload';
ALTER TABLE course_sections ADD COLUMN seats_taken INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE course_sections ADD COLUMN seats_held INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE students ADD COLUMN official_student_id TEXT;
ALTER TABLE students ADD COLUMN catalog_year_id TEXT;

-- Record migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('0042_workflow_and_admissions_tables');
