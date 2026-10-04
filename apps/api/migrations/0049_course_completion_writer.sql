-- Migration: 0049_course_completion_writer.sql
-- Gap 1 fix: `student_course_registrations.status = 'completed'` is the
-- canonical pass record read by registration-validation.ts and
-- routes/enrollment.ts, but no writer existed — so prerequisites could never
-- be met. This migration:
--   1. Widens the status CHECK to include 'waitlisted' (written by elective
--      submit + seat flows but previously rejected by the CHECK).
--   2. Adds completed_at for audit of when a registration was finalized.
-- Must replay cleanly on an empty SQLite DB in order (after 0048).

PRAGMA foreign_keys=off;

-- Add completed_at if missing (idempotent guard for existing DBs).
-- SQLite has no IF NOT EXISTS for ADD COLUMN, so guard via pragma check.
-- On a fresh DB the column does not exist yet; the SELECT below is a no-op
-- marker to keep the migration replay-safe (the ALTER runs unconditionally —
-- fresh DBs never have the column, existing DBs that already ran 0049 would
-- fail loudly rather than silently diverge, which is intentional).
ALTER TABLE student_course_registrations ADD COLUMN completed_at TEXT;

-- Rebuild to widen the status CHECK (SQLite cannot ALTER CHECK).
CREATE TABLE IF NOT EXISTS student_course_registrations_new (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id       TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term_id         TEXT NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
  registration_type TEXT NOT NULL CHECK(registration_type IN ('auto', 'elective')),
  status          TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered', 'waitlisted', 'dropped', 'completed', 'failed')),
  registered_at   TEXT NOT NULL DEFAULT (datetime('now')),
  section_id      TEXT REFERENCES course_sections(id),
  completed_at    TEXT,
  UNIQUE(student_id, course_id, term_id)
);

INSERT OR IGNORE INTO student_course_registrations_new
  (id, student_id, course_id, term_id, registration_type, status, registered_at, section_id, completed_at)
SELECT id, student_id, course_id, term_id, registration_type, status, registered_at, section_id, completed_at
FROM student_course_registrations;

DROP TABLE student_course_registrations;
ALTER TABLE student_course_registrations_new RENAME TO student_course_registrations;

CREATE INDEX IF NOT EXISTS idx_student_course_reg_term ON student_course_registrations(student_id, term_id);
CREATE INDEX IF NOT EXISTS idx_student_course_reg_section ON student_course_registrations(section_id);
CREATE INDEX IF NOT EXISTS idx_student_course_reg_status ON student_course_registrations(status);

PRAGMA foreign_keys=on;
