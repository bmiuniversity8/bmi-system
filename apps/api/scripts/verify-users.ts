import { neon } from '@neondatabase/serverless';

const NEON_URL = process.env.DATABASE_URL_CORE || "postgresql://neondb_owner:npg_Sq4liYUJj6Lk@ep-delicate-term-aws0vuty-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require";

const sql = neon(NEON_URL);

async function main() {
  console.log('🔍 Listing users in Neon database...');
  const users = await (sql as any).query(`SELECT id, email, first_name, last_name, is_verified, role FROM users`);
  console.log('Registered users:', users);

  console.log('⚡ Auto-verifying all accounts for testing convenience...');
  await (sql as any).query(`UPDATE users SET is_verified = 1 WHERE is_verified = 0`);
  console.log('✅ All registered accounts are now verified!');
}

main().catch(console.error);
