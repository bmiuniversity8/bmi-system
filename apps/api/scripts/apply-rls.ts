import { Client } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const connectionString = process.env.DATABASE_URL_CORE;
  if (!connectionString) {
    console.error('❌ DATABASE_URL_CORE is not set. Provide it in the environment (e.g. from apps/api/.dev.vars).');
    process.exit(1);
  }
  console.log('🔗 Connecting to Neon Database via Client...');
  const client = new Client(connectionString);
  await client.connect();

  const sqlFilePath = path.join(__dirname, '..', 'drizzle', 'rls_policies.sql');
  console.log(`📄 Reading RLS policies from ${sqlFilePath}...`);
  const rlsSql = fs.readFileSync(sqlFilePath, 'utf8');

  console.log('⚡ Applying policies...');
  await client.query(rlsSql);

  await client.end();
  console.log('✅ Row-Level Security policies applied successfully!');
}

main().catch((err) => {
  console.error('❌ Failed to apply RLS policies:', err);
  process.exit(1);
});
