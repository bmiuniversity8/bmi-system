-- ============================================================================
-- BMI UMS — DB-Sourced Data Migration
-- Removes reliance on frontend mock/localStorage data by adding the tables
-- that back the Verification Dashboard, Communications Center, and System
-- Settings screens, plus a persisted verification status on documents.
-- Run: npx wrangler d1 execute bmi-portal-db --local --file=migrations/0039_ums_db_sourced_data.sql
-- ============================================================================

-- ── 1. Verification Logs ───────────────────────────────────────────────────────
-- Every certificate verification attempt (valid, invalid, revoked) is recorded
-- so the admin Verification Dashboard renders real activity instead of mocks.
CREATE TABLE IF NOT EXISTS verification_logs (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  certificate_id TEXT REFERENCES certificates(id) ON DELETE SET NULL,
  serial_number  TEXT NOT NULL,
  student_name   TEXT,
  result         TEXT NOT NULL DEFAULT 'valid' CHECK(result IN ('valid','invalid','revoked')),
  method         TEXT NOT NULL DEFAULT 'online' CHECK(method IN ('online','offline','qr_scan')),
  ip_address     TEXT,
  location       TEXT,
  user_agent     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_verification_logs_serial  ON verification_logs(serial_number);
CREATE INDEX IF NOT EXISTS idx_verification_logs_created ON verification_logs(created_at);

-- ── 2. Communications (dispatch ledger) ────────────────────────────────────────
-- Persists SMS/Email/WhatsApp broadcast records so the Communications Center
-- no longer fakes history in localStorage.
CREATE TABLE IF NOT EXISTS communications (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  type       TEXT NOT NULL CHECK(type IN ('SMS','Email')),
  channel    TEXT NOT NULL DEFAULT 'email' CHECK(channel IN ('sms','email','whatsapp')),
  recipient  TEXT NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Delivered' CHECK(status IN ('Delivered','Pending','Failed')),
  sent_by    TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_communications_created ON communications(created_at);
CREATE INDEX IF NOT EXISTS idx_communications_type    ON communications(type);

-- ── 3. System Settings ─────────────────────────────────────────────────────────
-- Key/value store for institutional preferences so the Settings screen persists
-- in the database instead of localStorage.
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 4. Document verification status ────────────────────────────────────────────
-- Lets admins flag documents as pending/flagged instead of ephemeral UI state.
ALTER TABLE documents ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'verified';