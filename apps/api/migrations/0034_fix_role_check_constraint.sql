-- Migration: 0034_fix_role_check_constraint.sql
-- Fixes the users.role CHECK constraint to include 'alumni' and 'verifier'.
-- SQLite does not support ALTER TABLE ALTER CONSTRAINT, so we recreate the table.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS users_new (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  phone       TEXT,
  role        TEXT NOT NULL DEFAULT 'applicant' CHECK(role IN ('applicant', 'student', 'staff', 'admin', 'alumni', 'verifier')),
  is_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  mfa_secret  TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  session_version INTEGER NOT NULL DEFAULT 1,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  account_claimed INTEGER NOT NULL DEFAULT 0,
  student_email TEXT,
  person_id TEXT,
  admission_code TEXT,
  admission_code_expires_at TEXT,
  date_of_birth TEXT,
  nationality TEXT,
  address TEXT,
  gender TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (
  id, email, password_hash, first_name, last_name, phone, role, is_verified,
  verification_token, mfa_secret, mfa_enabled, session_version, failed_login_attempts,
  locked_until, account_claimed, student_email, person_id, admission_code,
  admission_code_expires_at, date_of_birth, nationality, address, gender,
  created_at, updated_at
)
SELECT 
  id, email, password_hash, first_name, last_name, phone, role, is_verified,
  verification_token, mfa_secret, mfa_enabled, session_version, failed_login_attempts,
  locked_until, account_claimed, NULL AS student_email, person_id, admission_code,
  admission_code_expires_at, date_of_birth, nationality, address, gender,
  created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

PRAGMA foreign_keys=on;
