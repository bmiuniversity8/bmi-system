-- 0046_fix_application_number_partial_unique.sql
-- The applications.application_number unique index was created as a full unique
-- index, which prevents multiple NULL values (draft applications without an
-- assigned number) in Postgres. Replace it with a partial unique index that
-- only enforces uniqueness when application_number IS NOT NULL.

DROP INDEX IF EXISTS idx_applications_number;

CREATE UNIQUE INDEX idx_applications_number
  ON applications (application_number)
  WHERE application_number IS NOT NULL;
