-- 0045_reconcile_canonical_programmes.sql
-- BMI University: Reconcile and deduplicate programmes
-- Ensures exactly 16 active programmes, 2 deferred programmes, and 0 duplicates.
PRAGMA foreign_keys = OFF;

-- 1. Insert or update DCMT (Diploma in Christian Ministry and Theology)
INSERT OR REPLACE INTO programs (
  id, name, code, degree_type, level, department_id,
  duration_years, total_credit_hours, mode_of_study, is_active, description, icon
) VALUES (
  'prg-dcmt-0000000000000000000000',
  'Diploma in Christian Ministry and Theology',
  'DCMT',
  'Diploma',
  'diploma',
  'd-ministry',
  1,
  48,
  'blended',
  1,
  'A foundational one-year programme equipping students with core biblical and theological understanding, spiritual formation, and practical ministry competencies.',
  '/images/diploma-icon.png'
);

-- 2. Update Undergraduate Canonical Programmes
UPDATE programs SET
  name = 'BA in Biblical Studies',
  code = 'BABS',
  department_id = 'd-biblical',
  description = 'Gain a deep understanding of Scripture and theological foundations to serve God in ministry, education, and everyday life.',
  icon = '/images/bachelor-icon.png',
  is_active = 1
WHERE id = 'prg-ba-biblical-00000000000000';

UPDATE programs SET
  name = 'BA in Christian Education',
  code = 'BACE',
  department_id = 'd-education',
  description = 'Become equipped with biblical knowledge and teaching skills to lead and educate in Christian schools, churches, and ministry settings.',
  icon = '/images/bachelor-icon.png',
  is_active = 1
WHERE id = 'prg-ba-christian-ed-0000000000';

UPDATE programs SET
  name = 'BA in Ministry Leadership',
  code = 'BAML',
  department_id = 'd-ministry',
  description = 'Gain biblical knowledge and leadership skills to effectively lead in church, ministry, and community settings.',
  icon = '/images/bachelor-icon.png',
  is_active = 1
WHERE id = 'prg-ba-ministry-000000000000000';

UPDATE programs SET
  name = 'BA in Theological Studies',
  code = 'BATS',
  department_id = 'd-biblical',
  description = 'Deepen your understanding of biblical theology and prepare for impactful roles in ministry, teaching, and further theological education.',
  icon = '/images/bachelor-icon.png',
  is_active = 1
WHERE id = 'prg-ba-theological-00000000000';

UPDATE programs SET
  name = 'BA in Worship Leadership',
  code = 'BAWL',
  department_id = 'd-worship',
  description = 'Be equipped with biblical knowledge and practical skills to lead worship teams and cultivate meaningful worship experiences in church and ministry settings.',
  icon = '/images/bachelor-icon.png',
  is_active = 1
WHERE id = 'prg-ba-worship-0000000000000000';

-- 3. Update Graduate & Doctoral Canonical Programmes
UPDATE programs SET
  name = 'Master of Divinity (MDiv)',
  code = 'MDIV',
  department_id = 'd-ministry',
  description = 'Gain advanced theological education, practical ministry skills, and biblical knowledge to lead and serve effectively in ministry and beyond.',
  icon = '/images/masters-icon.png',
  is_active = 1
WHERE id = 'prg-mdiv-0000000000000000000000';

UPDATE programs SET
  name = 'MA in Christian Counseling',
  code = 'MACC',
  department_id = 'd-grad-counsel',
  description = 'Be equipped with biblical principles and practical skills to provide compassionate, faith-based guidance and support in ministry and professional counseling settings.',
  icon = '/images/masters-icon.png',
  is_active = 1
WHERE id = 'prg-ma-counseling-000000000000';

UPDATE programs SET
  name = 'MA in Theological Studies',
  code = 'MATS',
  department_id = 'd-biblical',
  description = 'Deepen your biblical knowledge and theological understanding to excel in ministry, academic, and leadership roles within the church and beyond.',
  icon = '/images/masters-icon.png',
  is_active = 1
WHERE id = 'prg-ma-theology-0000000000000000';

UPDATE programs SET
  name = 'MA in Christian Education',
  code = 'MACE',
  department_id = 'd-education',
  description = 'Prepare with biblical foundations and educational expertise to lead and inspire in Christian schools, churches, and ministry settings.',
  icon = '/images/masters-icon.png',
  is_active = 1
WHERE id = 'prg-ma-christian-ed-000000000000';

UPDATE programs SET
  name = 'MA in Christian Apologetics',
  code = 'MACA',
  department_id = 'd-apologetics',
  description = 'Become equipped with biblical knowledge and critical reasoning to effectively defend and communicate the Christian faith in diverse settings.',
  icon = '/images/masters-icon.png',
  is_active = 1
WHERE id = 'prg-ma-apologetics-00000000000';

UPDATE programs SET
  name = 'MA in Christian Leadership',
  code = 'MACL',
  department_id = 'd-ministry',
  description = 'Be empowered with biblical principles and leadership skills to lead effectively in ministry, church, and organizational settings.',
  icon = '/images/masters-icon.png',
  is_active = 1
WHERE id = 'prg-ma-leadership-000000000000';

UPDATE programs SET
  name = 'Doctor of Ministry (DMin)',
  code = 'DMIN',
  department_id = 'd-ministry',
  description = 'Advance your ministry skills and theological expertise to lead with greater impact and effectiveness in church and community leadership.',
  icon = '/images/phd-icon.png',
  is_active = 1
WHERE id = 'prg-dmin-0000000000000000000000';

UPDATE programs SET
  name = 'Doctor of Christian Education',
  code = 'DCE',
  department_id = 'd-education',
  description = 'Equip yourself with advanced educational theory and research skills to lead and transform Christian educational institutions.',
  icon = '/images/phd-icon.png',
  is_active = 1
WHERE id = 'prg-dce-00000000000000000000000';

UPDATE programs SET
  name = 'Graduate Certificate in Christian Studies',
  code = 'GCCS',
  department_id = 'd-biblical',
  description = 'Develop a deeper understanding of Christian worldview and theology to enrich your personal faith and ministry involvement.',
  icon = NULL,
  is_active = 1
WHERE id = 'prg-cert-christian-00000000000';

UPDATE programs SET
  name = 'Graduate Certificate in Spiritual Formation',
  code = 'GCSF',
  department_id = 'd-ministry',
  description = 'Focus on the spiritual disciplines and character formation required for deep spiritual growth and ministry longevity.',
  icon = NULL,
  is_active = 1
WHERE id = 'prg-cert-spiritual-00000000000';

-- 4. Update Deferred Programmes (is_active = 0)
UPDATE programs SET
  name = 'Doctor of Theology (ThD)',
  code = 'THD',
  department_id = 'd-biblical',
  description = 'Pursue high-level theological research and academic scholarship to teach, write, and lead at the highest levels of Christian education.',
  icon = '/images/phd-icon.png',
  is_active = 0
WHERE id = 'prg-thd-00000000000000000000000';

UPDATE programs SET
  name = 'Graduate Certificate in Biblical Studies',
  code = 'GCBS',
  department_id = 'd-biblical',
  description = 'Build a solid foundation in biblical interpretation and theological concepts through a flexible, short-term graduate program.',
  icon = NULL,
  is_active = 0
WHERE id = 'prg-cert-biblical-000000000000';

-- 5. Reconcile Foreign Key References to Legacy IDs
UPDATE applications SET program_id = 'prg-ba-biblical-00000000000000' WHERE program_id = 'p-ba-biblical';
UPDATE applications SET program_id = 'prg-ba-christian-ed-0000000000' WHERE program_id = 'p-ba-education';
UPDATE applications SET program_id = 'prg-ba-ministry-000000000000000' WHERE program_id = 'p-ba-ministry';
UPDATE applications SET program_id = 'prg-ba-theological-00000000000' WHERE program_id = 'p-ba-theology';
UPDATE applications SET program_id = 'prg-ba-worship-0000000000000000' WHERE program_id = 'p-ba-worship';
UPDATE applications SET program_id = 'prg-ma-theology-0000000000000000' WHERE program_id = 'p-ma-theology';
UPDATE applications SET program_id = 'prg-dcmt-0000000000000000000000' WHERE program_id = 'p-dip-ministry';

UPDATE students SET program_id = 'prg-ba-biblical-00000000000000' WHERE program_id = 'p-ba-biblical';
UPDATE students SET program_id = 'prg-ba-christian-ed-0000000000' WHERE program_id = 'p-ba-education';
UPDATE students SET program_id = 'prg-ba-ministry-000000000000000' WHERE program_id = 'p-ba-ministry';
UPDATE students SET program_id = 'prg-ba-theological-00000000000' WHERE program_id = 'p-ba-theology';
UPDATE students SET program_id = 'prg-ba-worship-0000000000000000' WHERE program_id = 'p-ba-worship';
UPDATE students SET program_id = 'prg-ma-theology-0000000000000000' WHERE program_id = 'p-ma-theology';
UPDATE students SET program_id = 'prg-dcmt-0000000000000000000000' WHERE program_id = 'p-dip-ministry';

UPDATE student_programs SET program_id = 'prg-ba-biblical-00000000000000' WHERE program_id = 'p-ba-biblical';
UPDATE student_programs SET program_id = 'prg-ba-christian-ed-0000000000' WHERE program_id = 'p-ba-education';
UPDATE student_programs SET program_id = 'prg-ba-ministry-000000000000000' WHERE program_id = 'p-ba-ministry';
UPDATE student_programs SET program_id = 'prg-ba-theological-00000000000' WHERE program_id = 'p-ba-theology';
UPDATE student_programs SET program_id = 'prg-ba-worship-0000000000000000' WHERE program_id = 'p-ba-worship';
UPDATE student_programs SET program_id = 'prg-ma-theology-0000000000000000' WHERE program_id = 'p-ma-theology';
UPDATE student_programs SET program_id = 'prg-dcmt-0000000000000000000000' WHERE program_id = 'p-dip-ministry';

UPDATE program_curriculum SET program_id = 'prg-dcmt-0000000000000000000000' WHERE program_id = 'p-dip-ministry';
UPDATE program_fees SET program_id = 'prg-dcmt-0000000000000000000000' WHERE program_id = 'p-dip-ministry';
UPDATE transfer_credits SET recipient_program_id = 'prg-dcmt-0000000000000000000000' WHERE recipient_program_id = 'p-dip-ministry';
UPDATE advanced_standing SET program_id = 'prg-dcmt-0000000000000000000000' WHERE program_id = 'p-dip-ministry';

-- 6. Delete Legacy Duplicate Programme Rows
DELETE FROM programs WHERE id IN (
  'p-ba-biblical',
  'p-ba-education',
  'p-ba-ministry',
  'p-ba-theology',
  'p-ba-worship',
  'p-ma-theology',
  'p-dip-ministry'
);

PRAGMA foreign_keys = ON;

-- 7. Record Migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('0045_reconcile_canonical_programmes');
