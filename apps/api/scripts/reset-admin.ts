import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../../packages/api-middleware/src/jwt.ts';

const NEON_URL = process.env.DATABASE_URL_CORE || "postgresql://neondb_owner:npg_Sq4liYUJj6Lk@ep-delicate-term-aws0vuty-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PEPPER = process.env.PASSWORD_PEPPER || "quTCeS7M1pb8/3i3uhwOk+M5bMn6zmfBTDKFfu8Ax4RorUMOMRIMDbPbA2T6PgXK";

const sql = neon(NEON_URL);

async function main() {
  console.log('🔑 Resetting admin@bmiuniversities.org password...');
  const hash = await hashPassword('AdminPassword123!', PEPPER);

  await (sql as any).query(`
    INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified)
    VALUES ('admin-001', 'admin@bmiuniversities.org', $1, 'Admin', 'User', 'admin', 1)
    ON CONFLICT (id) DO UPDATE SET
      password_hash = $1,
      is_verified = 1,
      role = 'admin';
  `, [hash]);

  console.log('✅ Admin credentials set successfully!');
}

main().catch(console.error);
