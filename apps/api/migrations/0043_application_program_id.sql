-- Migration: 0043_application_program_id
-- Canonical program reference on applications.
-- `program` (name) stays as denormalized display; `program_id` is authoritative
-- for curriculum, fees, provisioning and reporting.

ALTER TABLE applications ADD COLUMN program_id TEXT REFERENCES programs(id);

CREATE INDEX IF NOT EXISTS idx_apps_program_id ON applications(program_id);

-- Backfill: resolve existing name-based rows to canonical IDs (first match wins).
UPDATE applications
SET program_id = (SELECT id FROM programs WHERE programs.name = applications.program LIMIT 1)
WHERE program_id IS NULL;
