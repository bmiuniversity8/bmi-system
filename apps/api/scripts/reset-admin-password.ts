import { createCoreDb } from '../lib/db';
import { users } from '../schema/core';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../../../packages/api-middleware/src/jwt';

async function main() {
  const newEmail = process.argv[2] || 'admin@bmiuniversities.org';
  const newPassword = process.argv[3];
  const pepper = process.env.PASSWORD_PEPPER;

  if (!newPassword) {
    console.error('❌ No password provided. Usage: tsx scripts/reset-admin-password.ts <email> <new-password>');
    process.exit(1);
  }
  if (!pepper) {
    console.error('❌ PASSWORD_PEPPER is not set. Provide it in the environment (e.g. from apps/api/.dev.vars).');
    process.exit(1);
  }

  console.log(`\n🔑 Resetting Admin Account Credentials in Neon DB...`);
  console.log(`  Email:    ${newEmail}`);

  const env = {
    DATABASE_URL_CORE: process.env.DATABASE_URL_CORE,
  };

  if (!env.DATABASE_URL_CORE) {
    console.error('❌ DATABASE_URL_CORE is not set. Provide it in the environment (e.g. from apps/api/.dev.vars).');
    process.exit(1);
  }

  const db = createCoreDb(env as any);

  const passwordHash = await hashPassword(newPassword, pepper);

  await db.update(users)
    .set({
      email: newEmail.toLowerCase(),
      password_hash: passwordHash,
      is_verified: 1,
      role: 'admin',
    })
    .where(eq(users.id, 'admin-001'))
    .execute();

  console.log('✅ Admin Account Credentials Successfully Updated in Neon DB!\n');
}

main().catch(console.error);
