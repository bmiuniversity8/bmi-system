-- Migration: 0047_fix_applications_degree_level_check.sql
-- Fixes the applications.degree_level CHECK constraint in SQLite/D1 to include 'diploma'.
-- SQLite does not support ALTER TABLE ALTER CONSTRAINT, so we recreate the table.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS applications_new (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program         TEXT NOT NULL,
  program_id      TEXT REFERENCES programs(id),
  degree_level    TEXT NOT NULL CHECK(degree_level IN ('undergraduate','graduate','doctorate','certificate','diploma')),
  status          TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('draft','submitted','under_review','accepted','rejected','waitlisted')),
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
CREATE INDEX IF NOT EXISTS idx_apps_program_id ON applications(program_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_number ON applications(application_number) WHERE application_number IS NOT NULL;

PRAGMA foreign_keys=on;
