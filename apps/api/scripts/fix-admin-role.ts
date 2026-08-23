import { neon } from '@neondatabase/serverless';

const NEON_URL = process.env.DATABASE_URL_CORE;
if (!NEON_URL) {
  console.error("DATABASE_URL_CORE required");
  process.exit(1);
}

const sql = neon(NEON_URL);

async function main() {
  console.log('🔍 Checking current admin role...');
  
  // Check current state
  const before = await sql`
    SELECT id, email, role, is_verified FROM users 
    WHERE email = 'admin@bmiuniversities.org'
  `;
  console.log('Before:', before);

  if (before.length === 0) {
    console.log('❌ Admin account not found. Creating it...');
    // Will be handled below
  } else {
    console.log(`Current role: "${before[0].role}" — correcting to "superadmin"`);
  }

  // Fix 1: Update admin@bmiuniversities.org role to admin / superadmin
  await sql`
    UPDATE users 
    SET role = 'admin', 
        is_verified = 1,
        updated_at = NOW()
    WHERE email = 'admin@bmiuniversities.org'
  `;
  console.log('✅ Role updated to admin');

  // Fix 2: Check the role constraint and add superadmin if needed
  console.log('\n🔍 Checking role constraint...');
  try {
    const constraints = await sql`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'users'::regclass 
        AND contype = 'c'
    `;
    console.log('Role constraints:', constraints);
  } catch (e) {
    console.log('No check constraints found or error:', e);
  }

  // Fix 3: Drop the old constraint and add a proper one covering all UMS roles
  console.log('\n🔧 Dropping old role constraint and adding comprehensive UMS roles...');
  try {
    // Find the constraint name dynamically
    const constraintRows = await sql`
      SELECT con.conname
      FROM pg_catalog.pg_constraint con
      INNER JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
      INNER JOIN pg_catalog.pg_namespace nsp ON nsp.oid = connamespace
      WHERE rel.relname = 'users'
        AND con.contype = 'c'
        AND con.conname LIKE '%role%'
    `;
    
    for (const row of constraintRows) {
      console.log(`  Dropping constraint: ${row.conname}`);
      await sql(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "${row.conname}"`);
    }
    
    // Add new comprehensive constraint
    await sql`
      ALTER TABLE users 
      ADD CONSTRAINT users_role_check 
      CHECK (role IN (
        'applicant', 'alumni', 'verifier',
        'superadmin', 'admin', 
        'registrar', 'admissions', 'finance', 'bursar',
        'faculty', 'staff', 'hr',
        'library', 'facilities', 'medical', 'security'
      ))
    `;
    console.log('✅ Role constraint updated with all UMS institutional roles');
  } catch (err) {
    console.warn('⚠️  Could not update constraint (may not exist or already correct):', err);
  }

  // Verify
  const after = await sql`
    SELECT id, email, role, is_verified FROM users 
    WHERE email = 'admin@bmiuniversities.org'
  `;
  console.log('\n✅ Final state:', after);

  // Show all staff/admin accounts
  const allStaff = await sql`
    SELECT email, role, is_verified FROM users 
    WHERE role NOT IN ('applicant')
    ORDER BY role
  `;
  console.log('\n👥 All non-applicant accounts:', allStaff);
}

main().catch(console.error);
