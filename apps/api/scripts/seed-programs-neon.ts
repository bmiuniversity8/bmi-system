/**
 * BMI University – Seed Programs into Neon PostgreSQL
 * ─────────────────────────────────────────────────────
 * Run: npx tsx apps/api/scripts/seed-programs-neon.ts
 *
 * This script uses INSERT ... ON CONFLICT DO UPDATE so it is safe to run
 * multiple times without duplicating data. It seeds:
 *   - 2 faculties
 *   - 9 departments
 *   - 18 canonical degree programs
 */
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_CORE;
if (!url) throw new Error('DATABASE_URL_CORE environment variable is required');
const pool = new Pool({ connectionString: url });

async function main() {
  console.log('🌱 Connecting to Neon database...');

  // ── Faculties ──────────────────────────────────────────────────────────────
  await pool.query(`
    INSERT INTO faculties (id, name, code, description) VALUES
      ('f-theology',  'Faculty of Theology and Ministry',  'FTM', 'Theological and ministry training'),
      ('f-education', 'Faculty of Christian Education',    'FCE', 'Equipping educators and counselors')
    ON CONFLICT (code) DO UPDATE SET
      name        = EXCLUDED.name,
      description = EXCLUDED.description;
  `);
  console.log('✅ Faculties seeded');

  // ── Departments ────────────────────────────────────────────────────────────
  await pool.query(`
    INSERT INTO departments (id, name, code, faculty_id, description) VALUES
      ('d-biblical',    'Department of Biblical Studies',         'DBS', 'f-theology',  'Biblical and theological studies'),
      ('d-ministry',    'Department of Ministry & Leadership',    'DML', 'f-theology',  'Practical ministry and leadership'),
      ('d-counseling',  'Department of Christian Counseling',     'DCC', 'f-education', 'Counseling and psychological studies'),
      ('d-education',   'Department of Christian Education',      'DCE', 'f-education', 'Education and teaching methodologies'),
      ('d-apologetics', 'Department of Christian Apologetics',    'DCA', 'f-theology',  'Apologetics and cultural engagement'),
      ('d-worship',     'Department of Worship Arts',             'DWA', 'f-theology',  'Worship leadership and liturgical arts'),
      ('d-missions',    'Department of Missions and Evangelism',  'DME', 'f-theology',  'Cross-cultural missions and evangelism'),
      ('d-preaching',   'Department of Preaching and Homiletics', 'DPH', 'f-theology',  'Biblical preaching and homiletics'),
      ('d-grad-counsel','Department of Graduate Counseling',      'DGC', 'f-education', 'Graduate Christian counseling')
    ON CONFLICT (code) DO UPDATE SET
      name        = EXCLUDED.name,
      description = EXCLUDED.description,
      faculty_id  = EXCLUDED.faculty_id;
  `);
  console.log('✅ Departments seeded');

  // ── Programs ───────────────────────────────────────────────────────────────
  // 18 canonical programmes: 1 diploma, 5 BA, 6 MA/MDiv, 2 doctorates, 2 certs (active), 2 deferred
  await pool.query(`
    INSERT INTO programs (id, name, code, degree_type, level, department_id, duration_years, total_credit_hours, mode_of_study, is_active, description, icon) VALUES
      -- Diploma
      ('prg-dcmt-0000000000000000000000', 'Diploma in Christian Ministry and Theology', 'DCMT', 'Diploma', 'diploma', 'd-ministry', 1, 48, 'blended', 1,
       'A foundational one-year programme equipping students with core biblical and theological understanding, spiritual formation, and practical ministry competencies.',
       '/images/diploma-icon.png'),

      -- Bachelors
      ('prg-ba-biblical-00000000000000', 'BA in Biblical Studies', 'BABS', 'Bachelor', 'bachelor', 'd-biblical', 4, 120, 'blended', 1,
       'Gain a deep understanding of Scripture and theological foundations to serve God in ministry, education, and everyday life.',
       '/images/bachelor-icon.png'),
      ('prg-ba-christian-ed-0000000000', 'BA in Christian Education', 'BACE', 'Bachelor', 'bachelor', 'd-education', 4, 120, 'blended', 1,
       'Become equipped with biblical knowledge and teaching skills to lead and educate in Christian schools, churches, and ministry settings.',
       '/images/bachelor-icon.png'),
      ('prg-ba-ministry-000000000000000', 'BA in Ministry Leadership', 'BAML', 'Bachelor', 'bachelor', 'd-ministry', 4, 120, 'blended', 1,
       'Gain biblical knowledge and leadership skills to effectively lead in church, ministry, and community settings.',
       '/images/bachelor-icon.png'),
      ('prg-ba-theological-00000000000', 'BA in Theological Studies', 'BATS', 'Bachelor', 'bachelor', 'd-biblical', 4, 120, 'blended', 1,
       'Deepen your understanding of biblical theology and prepare for impactful roles in ministry, teaching, and further theological education.',
       '/images/bachelor-icon.png'),
      ('prg-ba-worship-0000000000000000', 'BA in Worship Leadership', 'BAWL', 'Bachelor', 'bachelor', 'd-worship', 4, 120, 'blended', 1,
       'Be equipped with biblical knowledge and practical skills to lead worship teams and cultivate meaningful worship experiences in church and ministry settings.',
       '/images/bachelor-icon.png'),

      -- Masters / MDiv
      ('prg-mdiv-0000000000000000000000', 'Master of Divinity (MDiv)', 'MDIV', 'Masters', 'master', 'd-ministry', 3, 90, 'blended', 1,
       'Gain advanced theological education, practical ministry skills, and biblical knowledge to lead and serve effectively in ministry and beyond.',
       '/images/masters-icon.png'),
      ('prg-ma-counseling-000000000000', 'MA in Christian Counseling', 'MACC', 'Masters', 'master', 'd-grad-counsel', 2, 60, 'blended', 1,
       'Be equipped with biblical principles and practical skills to provide compassionate, faith-based guidance and support in ministry and professional counseling settings.',
       '/images/masters-icon.png'),
      ('prg-ma-theology-0000000000000000', 'MA in Theological Studies', 'MATS', 'Masters', 'master', 'd-biblical', 2, 60, 'blended', 1,
       'Deepen your biblical knowledge and theological understanding to excel in ministry, academic, and leadership roles within the church and beyond.',
       '/images/masters-icon.png'),
      ('prg-ma-christian-ed-000000000000', 'MA in Christian Education', 'MACE', 'Masters', 'master', 'd-education', 2, 60, 'blended', 1,
       'Prepare with biblical foundations and educational expertise to lead and inspire in Christian schools, churches, and ministry settings.',
       '/images/masters-icon.png'),
      ('prg-ma-apologetics-00000000000', 'MA in Christian Apologetics', 'MACA', 'Masters', 'master', 'd-apologetics', 2, 60, 'blended', 1,
       'Become equipped with biblical knowledge and critical reasoning to effectively defend and communicate the Christian faith in diverse settings.',
       '/images/masters-icon.png'),
      ('prg-ma-leadership-000000000000', 'MA in Christian Leadership', 'MACL', 'Masters', 'master', 'd-ministry', 2, 60, 'blended', 1,
       'Be empowered with biblical principles and leadership skills to lead effectively in ministry, church, and organizational settings.',
       '/images/masters-icon.png'),

      -- Doctorates (active)
      ('prg-dmin-0000000000000000000000', 'Doctor of Ministry (DMin)', 'DMIN', 'Doctorate', 'doctorate', 'd-ministry', 3, 36, 'blended', 1,
       'Advance your ministry skills and theological expertise to lead with greater impact and effectiveness in church and community leadership.',
       '/images/phd-icon.png'),
      ('prg-dce-00000000000000000000000', 'Doctor of Christian Education', 'DCE', 'Doctorate', 'doctorate', 'd-education', 3, 36, 'blended', 1,
       'Equip yourself with advanced educational theory and research skills to lead and transform Christian educational institutions.',
       '/images/phd-icon.png'),

      -- Graduate Certificates (active)
      ('prg-cert-christian-00000000000', 'Graduate Certificate in Christian Studies', 'GCCS', 'Certificate', 'certificate', 'd-biblical', 1, 18, 'blended', 1,
       'Develop a deeper understanding of Christian worldview and theology to enrich your personal faith and ministry involvement.',
       NULL),
      ('prg-cert-spiritual-00000000000', 'Graduate Certificate in Spiritual Formation', 'GCSF', 'Certificate', 'certificate', 'd-ministry', 1, 18, 'blended', 1,
       'Focus on the spiritual disciplines and character formation required for deep spiritual growth and ministry longevity.',
       NULL),

      -- Deferred (is_active = 0)
      ('prg-thd-00000000000000000000000', 'Doctor of Theology (ThD)', 'THD', 'Doctorate', 'doctorate', 'd-biblical', 4, 48, 'blended', 0,
       'Pursue high-level theological research and academic scholarship to teach, write, and lead at the highest levels of Christian education.',
       '/images/phd-icon.png'),
      ('prg-cert-biblical-000000000000', 'Graduate Certificate in Biblical Studies', 'GCBS', 'Certificate', 'certificate', 'd-biblical', 1, 18, 'blended', 0,
       'Build a solid foundation in biblical interpretation and theological concepts through a flexible, short-term graduate program.',
       NULL)

    ON CONFLICT (code) DO UPDATE SET
      name               = EXCLUDED.name,
      degree_type        = EXCLUDED.degree_type,
      level              = EXCLUDED.level,
      department_id      = EXCLUDED.department_id,
      duration_years     = EXCLUDED.duration_years,
      total_credit_hours = EXCLUDED.total_credit_hours,
      mode_of_study      = EXCLUDED.mode_of_study,
      is_active          = EXCLUDED.is_active,
      description        = EXCLUDED.description,
      icon               = EXCLUDED.icon;
  `);
  console.log('✅ Programs seeded');

  // ── Verify ─────────────────────────────────────────────────────────────────
  const result = await pool.query(`SELECT code, name, level, is_active FROM programs ORDER BY is_active DESC, level, code`);
  console.log(`\n📊 Total programs in Neon: ${result.rows.length}`);
  console.table(result.rows);

  const coursesCount = await pool.query(`SELECT COUNT(*) AS count FROM courses`);
  console.log(`📚 Total courses in Neon: ${coursesCount.rows[0].count}`);

  await pool.end();
  console.log('\n🎉 Seed complete!');
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
