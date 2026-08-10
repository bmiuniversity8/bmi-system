import { neon } from '@neondatabase/serverless';

const NEON_URL = process.env.DATABASE_URL_CORE || "postgresql://neondb_owner:npg_Sq4liYUJj6Lk@ep-delicate-term-aws0vuty-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require";

const sql = neon(NEON_URL);

async function main() {
  console.log('🚀 Fixing Neon PostgreSQL email_logs schema...');

  const ddlStatements = [
    `ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS to_address TEXT;`,
    `UPDATE email_logs SET to_address = recipient WHERE to_address IS NULL AND recipient IS NOT NULL;`
  ];

  for (const ddl of ddlStatements) {
    try {
      await (sql as any).query(ddl);
      console.log('✅ Executed schema fix successfully');
    } catch (e: any) {
      console.error('⚠️ Note:', e.message);
    }
  }

  console.log('🎉 Neon PostgreSQL Schema fix complete!');
}

main().catch(console.error);
