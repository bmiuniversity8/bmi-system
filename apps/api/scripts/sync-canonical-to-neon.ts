import { Pool } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const url = process.env.DATABASE_URL_CORE;
if (!url) throw new Error('DATABASE_URL_CORE environment variable is required');
const pool = new Pool({ connectionString: url });

async function main() {
  console.log('Connecting to Neon database...');

  // 1. Ensure faculties exist
  await pool.query(`
    INSERT INTO faculties (id, name, code, description) VALUES
      ('f-theology', 'Faculty of Theology and Ministry', 'FTM', 'Theological and ministry training'),
      ('f-education', 'Faculty of Christian Education', 'FCE', 'Equipping educators and counselors')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;
  `);

  // 2. Ensure departments exist
  await pool.query(`
    INSERT INTO departments (id, name, code, faculty_id, description) VALUES
      ('d-biblical', 'Department of Biblical Studies', 'DBS', (SELECT id FROM faculties WHERE code = 'FTM' LIMIT 1), 'Biblical and theological studies'),
      ('d-ministry', 'Department of Ministry & Leadership', 'DML', (SELECT id FROM faculties WHERE code = 'FTM' LIMIT 1), 'Practical ministry and leadership'),
      ('d-counseling', 'Department of Christian Counseling', 'DCC', (SELECT id FROM faculties WHERE code = 'FCE' LIMIT 1), 'Counseling and psychological studies'),
      ('d-education', 'Department of Christian Education', 'DCE', (SELECT id FROM faculties WHERE code = 'FCE' LIMIT 1), 'Education and teaching methodologies'),
      ('d-apologetics', 'Department of Christian Apologetics', 'DCA', (SELECT id FROM faculties WHERE code = 'FTM' LIMIT 1), 'Apologetics and cultural engagement'),
      ('d-worship', 'Department of Worship Arts', 'DWA', (SELECT id FROM faculties WHERE code = 'FTM' LIMIT 1), 'Worship leadership and liturgical arts'),
      ('d-missions', 'Department of Missions and Evangelism', 'DME', (SELECT id FROM faculties WHERE code = 'FTM' LIMIT 1), 'Cross-cultural missions and evangelism'),
      ('d-preaching', 'Department of Preaching and Homiletics', 'DPH', (SELECT id FROM faculties WHERE code = 'FTM' LIMIT 1), 'Biblical preaching and homiletics'),
      ('d-grad-counsel', 'Department of Graduate Counseling', 'DGC', (SELECT id FROM faculties WHERE code = 'FCE' LIMIT 1), 'Graduate Christian counseling')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, faculty_id = EXCLUDED.faculty_id;
  `);

  // 3. Reconcile programmes in Neon
  // First, check if legacy codes exist (BBS, BCE, BML, BTS, BWL, MAT) and rename or consolidate them
  await pool.query(`
    UPDATE programs SET
      name = 'BA in Biblical Studies',
      code = 'BABS',
      department_id = 'd-biblical',
      description = 'Gain a deep understanding of Scripture and theological foundations to serve God in ministry, education, and everyday life.',
      icon = '/images/bachelor-icon.png',
      is_active = 1
    WHERE code = 'BBS' OR id = 'p-ba-biblical';

    UPDATE programs SET
      name = 'BA in Christian Education',
      code = 'BACE',
      department_id = 'd-education',
      description = 'Become equipped with biblical knowledge and teaching skills to lead and educate in Christian schools, churches, and ministry settings.',
      icon = '/images/bachelor-icon.png',
      is_active = 1
    WHERE code = 'BCE' OR id = 'p-ba-education';

    UPDATE programs SET
      name = 'BA in Ministry Leadership',
      code = 'BAML',
      department_id = 'd-ministry',
      description = 'Gain biblical knowledge and leadership skills to effectively lead in church, ministry, and community settings.',
      icon = '/images/bachelor-icon.png',
      is_active = 1
    WHERE code = 'BML' OR id = 'p-ba-ministry';

    UPDATE programs SET
      name = 'BA in Theological Studies',
      code = 'BATS',
      department_id = 'd-biblical',
      description = 'Deepen your understanding of biblical theology and prepare for impactful roles in ministry, teaching, and further theological education.',
      icon = '/images/bachelor-icon.png',
      is_active = 1
    WHERE code = 'BTS' OR id = 'p-ba-theology';

    UPDATE programs SET
      name = 'BA in Worship Leadership',
      code = 'BAWL',
      department_id = 'd-worship',
      description = 'Be equipped with biblical knowledge and practical skills to lead worship teams and cultivate meaningful worship experiences in church and ministry settings.',
      icon = '/images/bachelor-icon.png',
      is_active = 1
    WHERE code = 'BWL' OR id = 'p-ba-worship';

    UPDATE programs SET
      name = 'MA in Theological Studies',
      code = 'MATS',
      department_id = 'd-biblical',
      description = 'Deepen your biblical knowledge and theological understanding to excel in ministry, academic, and leadership roles within the church and beyond.',
      icon = '/images/masters-icon.png',
      is_active = 1
    WHERE code IN ('MAT', 'MATH') OR id = 'p-ma-theology';

    UPDATE programs SET
      name = 'Master of Divinity (MDiv)',
      code = 'MDIV',
      department_id = 'd-ministry',
      description = 'Gain advanced theological education, practical ministry skills, and biblical knowledge to lead and serve effectively in ministry and beyond.',
      icon = '/images/masters-icon.png',
      is_active = 1
    WHERE code = 'MDIV';

    UPDATE programs SET
      name = 'MA in Christian Counseling',
      code = 'MACC',
      department_id = 'd-grad-counsel',
      description = 'Be equipped with biblical principles and practical skills to provide compassionate, faith-based guidance and support in ministry and professional counseling settings.',
      icon = '/images/masters-icon.png',
      is_active = 1
    WHERE code = 'MACC';

    UPDATE programs SET
      name = 'MA in Christian Education',
      code = 'MACE',
      department_id = 'd-education',
      description = 'Prepare with biblical foundations and educational expertise to lead and inspire in Christian schools, churches, and ministry settings.',
      icon = '/images/masters-icon.png',
      is_active = 1
    WHERE code = 'MACE';

    UPDATE programs SET
      name = 'MA in Christian Apologetics',
      code = 'MACA',
      department_id = 'd-apologetics',
      description = 'Become equipped with biblical knowledge and critical reasoning to effectively defend and communicate the Christian faith in diverse settings.',
      icon = '/images/masters-icon.png',
      is_active = 1
    WHERE code = 'MACA';

    UPDATE programs SET
      name = 'MA in Christian Leadership',
      code = 'MACL',
      department_id = 'd-ministry',
      description = 'Be empowered with biblical principles and leadership skills to lead effectively in ministry, church, and organizational settings.',
      icon = '/images/masters-icon.png',
      is_active = 1
    WHERE code = 'MACL';

    UPDATE programs SET
      name = 'Doctor of Ministry (DMin)',
      code = 'DMIN',
      department_id = 'd-ministry',
      description = 'Advance your ministry skills and theological expertise to lead with greater impact and effectiveness in church and community leadership.',
      icon = '/images/phd-icon.png',
      is_active = 1
    WHERE code = 'DMIN';

    UPDATE programs SET
      name = 'Doctor of Christian Education',
      code = 'DCE',
      department_id = 'd-education',
      description = 'Equip yourself with advanced educational theory and research skills to lead and transform Christian educational institutions.',
      icon = '/images/phd-icon.png',
      is_active = 1
    WHERE code = 'DCE';

    UPDATE programs SET
      name = 'Graduate Certificate in Christian Studies',
      code = 'GCCS',
      department_id = 'd-biblical',
      description = 'Develop a deeper understanding of Christian worldview and theology to enrich your personal faith and ministry involvement.',
      icon = NULL,
      is_active = 1
    WHERE code = 'GCCS';

    UPDATE programs SET
      name = 'Graduate Certificate in Spiritual Formation',
      code = 'GCSF',
      department_id = 'd-ministry',
      description = 'Focus on the spiritual disciplines and character formation required for deep spiritual growth and ministry longevity.',
      icon = NULL,
      is_active = 1
    WHERE code = 'GCSF';

    -- Deactivate deferred programs
    UPDATE programs SET
      name = 'Doctor of Theology (ThD)',
      code = 'THD',
      department_id = 'd-biblical',
      description = 'Pursue high-level theological research and academic scholarship to teach, write, and lead at the highest levels of Christian education.',
      icon = '/images/phd-icon.png',
      is_active = 0
    WHERE code = 'THD';

    UPDATE programs SET
      name = 'Graduate Certificate in Biblical Studies',
      code = 'GCBS',
      department_id = 'd-biblical',
      description = 'Build a solid foundation in biblical interpretation and theological concepts through a flexible, short-term graduate program.',
      icon = NULL,
      is_active = 0
    WHERE code = 'GCBS';

    -- Insert DCMT (Diploma in Christian Ministry and Theology) if not exists
    INSERT INTO programs (
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
    )
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      degree_type = EXCLUDED.degree_type,
      level = EXCLUDED.level,
      department_id = EXCLUDED.department_id,
      duration_years = EXCLUDED.duration_years,
      total_credit_hours = EXCLUDED.total_credit_hours,
      mode_of_study = EXCLUDED.mode_of_study,
      is_active = 1,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon;
  `);

  console.log('Programmes reconciled in Neon.');

  // 4. Load the 204 canonical courses and sync to Neon
  const genScript = fs.readFileSync(path.join(process.cwd(), '../../scripts/generate-academic-catalogue.mjs'), 'utf8');
  const match = genScript.match(/const CANONICAL_COURSES = \[([\s\S]*?)\];/);
  if (!match) throw new Error('Could not find CANONICAL_COURSES');
  const courses: Array<{ code: string; title: string; desc: string; credits: number; level: string }> = eval('[' + match[1] + ']');
  console.log(`Loaded ${courses.length} canonical courses to sync.`);

  // Upsert each course into Neon
  for (const c of courses) {
    await pool.query(`
      INSERT INTO courses (id, code, title, name, description, credits, term, capacity, level, is_active)
      VALUES (
        md5(random()::text || clock_timestamp()::text),
        $1, $2, $2, $3, $4, 'Ongoing', 150, $5, 1
      )
      ON CONFLICT (code) DO UPDATE SET
        title = EXCLUDED.title,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        credits = EXCLUDED.credits,
        level = EXCLUDED.level,
        is_active = 1;
    `, [c.code, c.title, c.desc, c.credits, c.level]);
  }
  console.log('204 courses upserted into Neon.');

  // Delete retired non-canonical course codes from Neon
  await pool.query(`
    DELETE FROM courses WHERE code IN (
      'APOL101','APOL501','EDUC101','EDUC501','WRSH101','MDIV501','MDIV510',
      'GCBS101','GCBS102','GCCS101','GCSF101','GCSF102','THD701','THD702',
      'DCE701','THEO502','BIBL502','DMIN710'
    );
  `);

  // Verify final Neon status
  const pCheck = await pool.query('SELECT code, name, level, is_active FROM programs ORDER BY is_active DESC, level, code');
  console.log(`Neon programs count: ${pCheck.rows.length}`);
  console.table(pCheck.rows);

  const cCheck = await pool.query('SELECT count(*) as count FROM courses');
  console.log(`Neon courses count: ${cCheck.rows[0].count}`);

  await pool.end();
}

main().catch(err => {
  console.error('Error during Neon sync:', err);
  process.exit(1);
});
