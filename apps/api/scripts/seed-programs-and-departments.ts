import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_CORE;
if (!url) throw new Error('DATABASE_URL_CORE environment variable is required');
const pool = new Pool({ connectionString: url });

async function main() {
  console.log('🔄 Updating program levels in Neon...');
  await pool.query(`
    UPDATE programs SET level = 'bachelor' WHERE degree_type = 'Bachelor' OR code LIKE 'BA%';
    UPDATE programs SET level = 'master' WHERE degree_type = 'Masters' OR code IN ('MDIV', 'MACC', 'MATS', 'MACE', 'MACA', 'MACL');
    UPDATE programs SET level = 'doctorate' WHERE degree_type = 'Doctorate' OR code IN ('DMIN', 'DCE', 'THD');
    UPDATE programs SET level = 'certificate' WHERE degree_type = 'Certificate' OR code LIKE 'GC%';
    UPDATE programs SET level = 'diploma' WHERE degree_type = 'Diploma' OR code = 'DCMT';
  `);

  console.log('🔄 Assigning department_id to all courses in Neon...');
  await pool.query(`
    -- Apologetics
    UPDATE courses SET department_id = 'd-apologetics' WHERE code LIKE 'APO%';

    -- Biblical Studies & Languages & Theology & Church History
    UPDATE courses SET department_id = 'd-biblical'
    WHERE code LIKE 'BIBL%' OR code LIKE 'LANG%' OR code LIKE 'THEO%' OR code LIKE 'CHST%' OR code LIKE 'PHIL%' OR code LIKE 'ETHC%';

    -- Education & Gen Ed
    UPDATE courses SET department_id = 'd-education'
    WHERE code LIKE 'CED%' OR code LIKE 'COMM%' OR code LIKE 'DIGI%' OR code LIKE 'ENGL%' OR code LIKE 'GEN%' OR code LIKE 'ICT%' OR code LIKE 'MATH%' OR code LIKE 'RES%' OR code LIKE 'SOC%';

    -- Graduate Counseling (>= 500) vs Undergraduate Counseling (< 500)
    UPDATE courses SET department_id = 'd-grad-counsel'
    WHERE code LIKE 'COUN5%' OR code LIKE 'COUN6%' OR code LIKE 'COUN7%';

    UPDATE courses SET department_id = 'd-counseling'
    WHERE (code LIKE 'COUN%' AND department_id IS NULL);

    -- Worship
    UPDATE courses SET department_id = 'd-worship' WHERE code LIKE 'WOR%';

    -- Preaching
    UPDATE courses SET department_id = 'd-preaching' WHERE code LIKE 'PREA%';

    -- Missions & Evangelism
    UPDATE courses SET department_id = 'd-missions' WHERE code LIKE 'MISS%' OR code LIKE 'EVAN%';

    -- Ministry & Leadership
    UPDATE courses SET department_id = 'd-ministry'
    WHERE code LIKE 'MIN%' OR code LIKE 'PAST%' OR code LIKE 'LEAD%' OR code LIKE 'SPFM%' OR code LIKE 'DISC%' OR code LIKE 'SUPM%' OR code LIKE 'ECLE%' OR code LIKE 'DMIN%';
  `);

  const unassigned = await pool.query(`SELECT COUNT(*) as count FROM courses WHERE department_id IS NULL`);
  console.log('Unassigned courses count:', unassigned.rows[0].count);

  const sample = await pool.query(`
    SELECT c.code, c.title, c.credits, c.level, d.name as department_name
    FROM courses c
    LEFT JOIN departments d ON c.department_id = d.id
    LIMIT 5
  `);
  console.log('Sample updated courses:');
  console.table(sample.rows);

  const progs = await pool.query(`SELECT code, name, degree_type, level FROM programs ORDER BY code`);
  console.log('Updated programs:');
  console.table(progs.rows);

  await pool.end();
}

main().catch(console.error);
