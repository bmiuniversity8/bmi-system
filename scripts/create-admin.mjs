#!/usr/bin/env node
/**
 * BMI admin seeding — explicit script that refuses to run in production.
 *
 * Usage:
 *   ADMIN_PASSWORD_HASH='$2b$10$...' node scripts/create-admin.mjs --email admin@bmi.edu --name "Admin User"
 *   # or: ADMIN_PASSWORD='s3cret!' PASSWORD_PEPPER='...' node scripts/create-admin.mjs --email admin@bmi.edu
 *
 * Env:
 *   ADMIN_EMAIL            (or --email)      admin email
 *   ADMIN_PASSWORD_HASH    (or derived)      pre-hashed password (preferred)
 *   ADMIN_PASSWORD + PASSWORD_PEPPER        fallback: hashed at runtime (dev only)
 *   ENVIRONMENT / NODE_ENV                  when 'production', requires --allow-production
 *   D1_DB / DATABASE_URL                    target (printed SQL targets D1 by default)
 *
 * The script prints the parameterised intent and the SQL with placeholders —
 * it never logs the hash. Pipe the SQL into wrangler d1 execute or psql.
 */

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const email = getArg('--email') || process.env.ADMIN_EMAIL;
const name = getArg('--name') || process.env.ADMIN_NAME || 'Admin User';
const allowProduction = args.includes('--allow-production');
const environment = process.env.ENVIRONMENT || process.env.NODE_ENV || 'development';

if (environment.toLowerCase() === 'production' && !allowProduction) {
  console.error('REFUSING to seed admin in production without --allow-production.');
  process.exit(1);
}

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('A valid --email (or ADMIN_EMAIL) is required.');
  process.exit(1);
}

const hash = process.env.ADMIN_PASSWORD_HASH;
if (!hash) {
  console.error('ADMIN_PASSWORD_HASH is required (refusing to invent credentials).');
  console.error('Generate one with your password-hashing tooling, then re-run.');
  process.exit(1);
}
if (hash.includes('dummyhash') || hash.length < 20) {
  console.error('Refusing to use a placeholder hash.');
  process.exit(1);
}

const [firstName, ...rest] = name.split(' ');
const lastName = rest.join(' ') || 'User';
const id = `admin-${Date.now().toString(36)}`;

console.log(`-- Admin seed for ${email} (environment: ${environment})`);
console.log(`-- Run: wrangler d1 execute bmi-portal-db --file <this-file>  (or psql for Neon)`);
console.log(
  `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_verified) VALUES ('${id.replace(/'/g, "''")}', '${email.replace(/'/g, "''")}', '<ADMIN_PASSWORD_HASH>', '${firstName.replace(/'/g, "''")}', '${lastName.replace(/'/g, "''")}', 'admin', 1);`
);
console.log('-- NOTE: replace <ADMIN_PASSWORD_HASH> with the value of $ADMIN_PASSWORD_HASH; the hash is never printed by this script.');
