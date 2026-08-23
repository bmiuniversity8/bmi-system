#!/usr/bin/env node
/**
 * seed-first-admin.mjs
 *
 * Provision or update the 1st Super Admin account with admin@bmiuniversities.org
 * into the primary database (Neon PostgreSQL).
 *
 * Usage:
 *   node scripts/seed-first-admin.mjs [password] [email] [firstName] [lastName]
 *
 * Example:
 *   node scripts/seed-first-admin.mjs BmiAdmin2026! admin@bmiuniversities.org System Administrator
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import crypto from 'crypto';

// Load @neondatabase/serverless dynamically
let neon;
try {
  const mod = await import('@neondatabase/serverless');
  neon = mod.neon;
} catch {
  try {
    const mod = await import('../apps/api/node_modules/@neondatabase/serverless/index.mjs');
    neon = mod.neon;
  } catch {
    const mod = await import(resolve('apps/api/node_modules/@neondatabase/serverless/index.mjs'));
    neon = mod.neon;
  }
}

// Load .dev.vars if present
function loadDevVars() {
  const varsPath = resolve('apps/api/.dev.vars');
  const envObj = {};
  if (existsSync(varsPath)) {
    const lines = readFileSync(varsPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        envObj[key] = val;
      }
    }
  }
  return envObj;
}

const devVars = loadDevVars();
const dbUrl = process.env.DATABASE_URL_CORE || process.env.DATABASE_URL || devVars.DATABASE_URL_CORE || devVars.DATABASE_URL;
const pepper = process.env.PASSWORD_PEPPER || devVars.PASSWORD_PEPPER || 'bmi-default-pepper-2026';

const password = process.argv[2] || process.env.ADMIN_PASSWORD || 'BmiAdmin2026!';
const email = (process.argv[3] || process.env.ADMIN_EMAIL || 'admin@bmiuniversities.org').toLowerCase().trim();
const firstName = process.argv[4] || 'Executive';
const lastName = process.argv[5] || 'Admin';

if (!dbUrl) {
  console.error('❌ Error: No DATABASE_URL_CORE or DATABASE_URL found in environment or apps/api/.dev.vars');
  process.exit(1);
}

// Compute standard PBKDF2 hash compatible with @bmi/api-middleware
function computePbkdf2Hash(rawPassword, pepperString, iterations = 40000) {
  const salt = crypto.randomBytes(16);
  const pepperKey = crypto.createHmac('sha256', pepperString).update(rawPassword).digest();
  const derivedKey = crypto.pbkdf2Sync(pepperKey, salt, iterations, 32, 'sha256');
  const saltHex = salt.toString('hex');
  const hashHex = derivedKey.toString('hex');
  return `pbkdf2:${iterations}:${saltHex}:${hashHex}`;
}

async function runSeed() {
  console.log('\n👑 BMI University — 1st Super Admin Provisioning');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📧 Admin Email:  ${email}`);
  console.log(`👤 Name:         ${firstName} ${lastName}`);
  console.log(`🔑 Password:     ${password}`);
  console.log(`🛡️  Role:         admin (Executive Super Admin)`);
  console.log('───────────────────────────────────────────────────────────\n');

  try {
    const sql = neon(dbUrl);
    const passwordHash = computePbkdf2Hash(password, pepper);
    const userId = 'user_super_admin_001';

    // Upsert into users table
    const result = await sql`
      INSERT INTO users (
        id, email, password_hash, first_name, last_name, role, is_verified, created_at, updated_at
      ) VALUES (
        ${userId}, ${email}, ${passwordHash}, ${firstName}, ${lastName}, 'admin', 1, NOW(), NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        role = 'admin',
        is_verified = 1,
        updated_at = NOW()
      RETURNING id, email, role, first_name, last_name, is_verified;
    `;

    console.log('✅ Super Admin Account Successfully Provisioned in Database!');
    console.log('───────────────────────────────────────────────────────────');
    console.table(result);
    console.log('💡 You can now log in at the UMS console directly with:');
    console.log(`   Email:    ${email}`);
    console.log(`   Password: ${password}\n`);
  } catch (err) {
    console.error('❌ Database provisioning error:', err.message);
    process.exit(1);
  }
}

runSeed();
