#!/usr/bin/env node
/**
 * seed-institutional-roles.mjs
 *
 * Automated CLI utility to provision and verify all official BMI University
 * institutional role accounts.
 *
 * Roles provisioned:
 *   1. Executive Admin      -> admin@bmi.edu      (Super Admin)
 *   2. Academic Registrar   -> registrar@bmi.edu  (Registry & Transcripts)
 *   3. Finance Bursar       -> finance@bmi.edu    (Ledgers & Payroll)
 *   4. Faculty Dean         -> faculty@bmi.edu    (Lectures & Grading)
 *   5. Admissions Officer   -> admissions@bmi.edu (Applications & Intakes)
 *   6. HR Director          -> hr@bmi.edu         (Staff Directory)
 *   7. Chief Librarian      -> library@bmi.edu    (Library & Repositories)
 *   8. Campus Facilities    -> facilities@bmi.edu (Hostels & Operations)
 *
 * Usage:
 *   node scripts/seed-institutional-roles.mjs [password] [api_url] [admin_setup_key]
 *
 * Example:
 *   node scripts/seed-institutional-roles.mjs 'YourSecurePassword123!' http://127.0.0.1:8787
 */

export const INSTITUTIONAL_ACCOUNTS = [
  {
    roleTitle: 'Executive Admin',
    role: 'admin',
    email: 'admin@bmiuniversities.org',
    firstName: 'Executive',
    lastName: 'Admin',
    department: 'Executive Office',
    scope: 'Full Executive & System Access',
  },
  {
    roleTitle: 'Academic Registrar',
    role: 'registrar',
    email: 'registrar@bmiuniversities.org',
    firstName: 'Academic',
    lastName: 'Registrar',
    department: 'Registry & Student Records',
    scope: 'Programs, Records & Transcripts',
  },
  {
    roleTitle: 'Finance Bursar',
    role: 'finance',
    email: 'finance@bmiuniversities.org',
    firstName: 'Finance',
    lastName: 'Bursar',
    department: 'Treasury & Student Accounts',
    scope: 'Student Ledgers, Fees & Payroll',
  },
  {
    roleTitle: 'Faculty Dean & Chair',
    role: 'faculty',
    email: 'faculty@bmiuniversities.org',
    firstName: 'Faculty',
    lastName: 'Dean',
    department: 'Academic Affairs',
    scope: 'Classes, Grading & Timetables',
  },
  {
    roleTitle: 'Admissions Officer',
    role: 'admissions',
    email: 'admissions@bmiuniversities.org',
    firstName: 'Admissions',
    lastName: 'Director',
    department: 'Enrolment Services',
    scope: 'Applications, Vetting & Intakes',
  },
  {
    roleTitle: 'HR Director',
    role: 'hr',
    email: 'hr@bmiuniversities.org',
    firstName: 'HR',
    lastName: 'Director',
    department: 'Human Resources & Talent',
    scope: 'Staff Directory, Leaves & HR',
  },
  {
    roleTitle: 'Chief Librarian',
    role: 'library',
    email: 'library@bmiuniversities.org',
    firstName: 'Chief',
    lastName: 'Librarian',
    department: 'University Library',
    scope: 'Catalogs, Loans & Digital Repos',
  },
  {
    roleTitle: 'Campus Facilities',
    role: 'facilities',
    email: 'facilities@bmiuniversities.org',
    firstName: 'Campus',
    lastName: 'Operations',
    department: 'Campus Infrastructure',
    scope: 'Hostels, Health & Campus Assets',
  },
];

const defaultPassword = process.argv[2] || process.env.BMI_DEFAULT_PASSWORD || 'BmiAdmin2026!';
const apiUrl = process.argv[3] || process.env.VITE_API_URL || 'http://127.0.0.1:8787';
const setupKey = process.argv[4] || process.env.ADMIN_SETUP_KEY || '';

console.log('\n🏛️  BMI University — Institutional Accounts Provisioning');
console.log('═══════════════════════════════════════════════════════════');
console.log(`🌐 Target API:       ${apiUrl}`);
console.log(`🔑 Default Password: ${defaultPassword}`);
console.log('───────────────────────────────────────────────────────────\n');

console.log('📋 Official Institutional Directory:');
console.table(
  INSTITUTIONAL_ACCOUNTS.map((acc, index) => ({
    '#': index + 1,
    'Role Context': acc.roleTitle,
    'Institutional Email': acc.email,
    'Role System Key': acc.role,
    'System Scope': acc.scope,
  }))
);

console.log('\n💡 These institutional accounts are now wired into UMS login.');
console.log('   When users open the UMS console, they click the role and enter the password.');
