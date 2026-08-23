-- ==============================================================================
-- BMI UNIVERSITY — INSTITUTIONAL ROLE ACCOUNTS SEED (D1 / PostgreSQL compatible)
-- ==============================================================================
-- Standard Institutional Accounts:
--   1. admin@bmi.edu       -> Executive Super Admin
--   2. registrar@bmi.edu   -> Academic Registrar
--   3. finance@bmi.edu     -> Finance Bursar
--   4. faculty@bmi.edu     -> Faculty Dean & Professor
--   5. admissions@bmi.edu  -> Admissions Officer
--   6. hr@bmi.edu          -> HR Director
--   7. library@bmi.edu     -> Chief Librarian
--   8. facilities@bmi.edu  -> Campus Facilities Director
-- ==============================================================================

-- 1. Executive Admin (Full Unrestricted Access)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_admin_001', 'admin@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'Executive', 'Admin', 'admin', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'admin', is_verified = 1, updated_at = CURRENT_TIMESTAMP;

-- 2. Academic Registrar (Programs, Grades, Transcripts)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_reg_002', 'registrar@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'Academic', 'Registrar', 'registrar', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'registrar', is_verified = 1, updated_at = CURRENT_TIMESTAMP;

-- 3. Finance Bursar (Student Ledger, Fees, Payroll)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_fin_003', 'finance@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'Finance', 'Bursar', 'finance', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'finance', is_verified = 1, updated_at = CURRENT_TIMESTAMP;

-- 4. Faculty Dean (Classes, Grading, Attendance)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_fac_004', 'faculty@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'Faculty', 'Dean', 'faculty', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'faculty', is_verified = 1, updated_at = CURRENT_TIMESTAMP;

-- 5. Admissions Officer (Applications & Enrollment)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_adm_005', 'admissions@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'Admissions', 'Officer', 'admissions', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'admissions', is_verified = 1, updated_at = CURRENT_TIMESTAMP;

-- 6. HR Director (Staff Directory & HR)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_hr_006', 'hr@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'HR', 'Director', 'hr', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'hr', is_verified = 1, updated_at = CURRENT_TIMESTAMP;

-- 7. Chief Librarian (Library & Catalogs)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_lib_007', 'library@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'Chief', 'Librarian', 'staff', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'staff', is_verified = 1, updated_at = CURRENT_TIMESTAMP;

-- 8. Campus Facilities (Hostels, Security, Maintenance)
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at)
VALUES ('user_fac_008', 'facilities@bmiuniversities.org', '$2b$10$dummyhashfordevelopmenttestingpurposes', 'Campus', 'Facilities', 'facilities', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (email) DO UPDATE SET role = 'facilities', is_verified = 1, updated_at = CURRENT_TIMESTAMP;
