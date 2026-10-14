-- Migration: 0052_provisioning_jobs_blocked
-- Allows the 'blocked' status used by the Fees v4 id_card gate (registration fee
-- not yet settled) and adds updated_at for resume-on-settlement updates.
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. Safe to
-- re-run: copy is INSERT OR IGNORE and the temp table is renamed into place.

-- 1. Add updated_at for DBs created before this migration (guarded).
INSERT OR IGNORE INTO _migrations (name) SELECT 'add_updated_at_to_provisioning_jobs'
  WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('provisioning_jobs') WHERE name = 'updated_at');
ALTER TABLE provisioning_jobs ADD COLUMN updated_at TEXT;

-- 2. Rebuild with 'blocked' in the status CHECK.
CREATE TABLE IF NOT EXISTS provisioning_jobs_new (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  uid          TEXT NOT NULL REFERENCES persons(uid) ON DELETE CASCADE,
  job_type     TEXT NOT NULL CHECK(job_type IN ('finance', 'library', 'lms', 'portal', 'email', 'id_card')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'dead', 'blocked')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at   TEXT
);

INSERT OR IGNORE INTO provisioning_jobs_new (id, uid, job_type, status, attempts, last_error, created_at, completed_at, updated_at)
  SELECT id, uid, job_type, status, attempts, last_error, created_at, completed_at, updated_at FROM provisioning_jobs;

DROP TABLE provisioning_jobs;
ALTER TABLE provisioning_jobs_new RENAME TO provisioning_jobs;

CREATE INDEX IF NOT EXISTS idx_provisioning_uid ON provisioning_jobs(uid);
CREATE INDEX IF NOT EXISTS idx_provisioning_status ON provisioning_jobs(status);
