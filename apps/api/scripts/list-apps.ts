import { neon } from '@neondatabase/serverless';

const NEON_URL = process.env.DATABASE_URL_CORE || "postgresql://neondb_owner:npg_Sq4liYUJj6Lk@ep-delicate-term-aws0vuty-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require";
const sql = neon(NEON_URL);

async function main() {
  console.log('🔍 Listing all applications in Neon database...');
  const apps = await (sql as any).query(`
    SELECT a.id, a.user_id, a.program, a.degree_level, a.status, a.submitted_at, u.email, u.first_name, u.last_name
    FROM applications a JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
  `);
  console.log('Applications in Neon DB:', apps);
}

main().catch(console.error);
