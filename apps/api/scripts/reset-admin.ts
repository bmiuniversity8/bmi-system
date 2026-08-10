import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../../packages/api-middleware/src/jwt.ts';

const NEON_URL = process.env.DATABASE_URL_CORE;
const PEPPER = process.env.PASSWORD_PEPPER;

if (!NEON_URL || !PEPPER) {
  console.error('❌ DATABASE_URL_CORE and PASSWORD_PEPPER environment variables are required.');
  process.exit(1);
}

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
