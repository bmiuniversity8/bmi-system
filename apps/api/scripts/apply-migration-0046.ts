import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_CORE;
if (!url) throw new Error('DATABASE_URL_CORE environment variable is required');

const pool = new Pool({ connectionString: url });

async function main() {
  console.log('Applying migration 0046: fix application_number partial unique index...');

  await pool.query(`
    DROP INDEX IF EXISTS idx_applications_number;
  `);
  console.log('Dropped old full unique index.');

  await pool.query(`
    CREATE UNIQUE INDEX idx_applications_number
      ON applications (application_number)
      WHERE application_number IS NOT NULL;
  `);
  console.log('Created partial unique index (WHERE application_number IS NOT NULL).');

  // Verify
  const result = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'applications' AND indexname = 'idx_applications_number';
  `);
  console.log('Index verification:');
  console.table(result.rows);

  await pool.end();
  console.log('Migration 0046 complete.');
}

main().catch(err => {
  console.error('Migration 0046 failed:', err);
  process.exit(1);
});
