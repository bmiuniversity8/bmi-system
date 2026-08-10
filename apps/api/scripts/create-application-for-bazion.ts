import { neon } from '@neondatabase/serverless';

const NEON_URL = process.env.DATABASE_URL_CORE || "postgresql://neondb_owner:npg_Sq4liYUJj6Lk@ep-delicate-term-aws0vuty-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require";
const sql = neon(NEON_URL);

async function main() {
  console.log('📝 Submitting application for bazion001@gmail.com...');
  const userId = 'd7bcf8f6-8388-4646-9206-95727f52a0b1'; // bazion001@gmail.com
  const appId = crypto.randomUUID();

  await (sql as any).query(`
    INSERT INTO applications (id, user_id, program, degree_level, status, submitted_at, created_at)
    VALUES ($1, $2, 'BA in Biblical Studies', 'undergraduate', 'submitted', NOW(), NOW())
  `, [appId, userId]);

  console.log('✅ Application submitted for bazion001@gmail.com! App ID:', appId);
}

main().catch(console.error);
