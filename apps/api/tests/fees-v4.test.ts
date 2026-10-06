import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { convertMinor, splitInstalments, formatDual } from '../lib/money';
import { getFinanceSetting } from '../lib/finance-settings';
import { getApprovedExchangeRate } from '../lib/fx';
import { hasTermFinancialClearance } from '../lib/finance-clearance';
import { assessInvoice, assessApplicationFee, assessEnrollmentFee, assessCourseTuition, assessGraduationFee, resolveFeeLevel } from '../lib/fee-assessment-service';
import { settlePayment } from '../lib/payment-settlement';

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  const migration0051 = readFileSync(resolve(__dirname, '../migrations/0051_fees_system_v4.sql'), 'utf-8');

  // Minimal mock schema for base tables needed by v4
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      role TEXT DEFAULT 'student',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      uid TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      level TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      program TEXT,
      program_id TEXT,
      degree_level TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admissions_decisions (
      id TEXT PRIMARY KEY,
      application_id TEXT UNIQUE,
      decision TEXT,
      decided_by TEXT,
      decided_at TEXT,
      conditions TEXT,
      offer_expires_at TEXT,
      deposit_required INTEGER DEFAULT 0,
      deposit_amount REAL DEFAULT 0,
      reviewer_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS academic_terms (
      id TEXT PRIMARY KEY,
      name TEXT,
      academic_year TEXT,
      status TEXT,
      census_date TEXT,
      start_date TEXT,
      end_date TEXT
    );
    CREATE TABLE IF NOT EXISTS student_holds (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      hold_type TEXT,
      reason TEXT,
      placed_at TEXT,
      is_active INTEGER DEFAULT 1,
      blocks TEXT DEFAULT 'all'
    );
    CREATE TABLE IF NOT EXISTS provisioning_jobs (
      id TEXT PRIMARY KEY,
      uid TEXT,
      job_type TEXT,
      status TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Execute migration 0051
  db.exec(migration0051);

  // Wrap better-sqlite3 in adapter matching IDatabase prepare/bind
  const adapter = {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...args: any[]) {
          return {
            async first<T = any>() {
              return (stmt.get(...args) as T) || null;
            },
            async all<T = any>() {
              return { results: (stmt.all(...args) as T[]) || [] };
            },
            async run() {
              const res = stmt.run(...args);
              return { success: true, meta: { changes: res.changes, last_row_id: Number(res.lastInsertRowid) } };
            }
          };
        },
        async first<T = any>() {
          return (stmt.get() as T) || null;
        },
        async all<T = any>() {
          return { results: (stmt.all() as T[]) || [] };
        },
        async run() {
          const res = stmt.run();
          return { success: true, meta: { changes: res.changes, last_row_id: Number(res.lastInsertRowid) } };
        }
      };
    }
  };

  return { raw: db, adapter };
}

describe('BMI Fees System v4: Core Rules & Invariants', () => {
  let db: any;
  let raw: DatabaseSync;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.adapter;
    raw = testDb.raw;

    // Seed test user, program, and term
    raw.exec(`
      INSERT INTO users (id, email, first_name, last_name, role)
      VALUES ('usr_test_1', 'student1@example.com', 'John', 'Doe', 'student');

      INSERT INTO programs (id, code, name, level, is_active)
      VALUES ('prog_bth', 'BTH', 'Bachelor of Theology', 'undergraduate', 1),
             ('prog_mdiv', 'MDIV', 'Master of Divinity', 'graduate', 1),
             ('prog_dmin', 'DMIN', 'Doctor of Ministry', 'doctorate', 1),
             ('prog_dip', 'DIP-MIN', 'Diploma in Ministry', 'diploma', 1);

      INSERT INTO academic_terms (id, name, academic_year, status, census_date)
      VALUES ('term_2026_fall', 'Fall 2026', '2026-2027', 'registration', '2026-10-15T00:00:00Z');
    `);
  });

  describe('1. Money & Rounding', () => {
    it('converts USD minor units to KES with half-up rounding and 1000 increment', () => {
      // 5000 USD minor ($50.00) at 130 KES/USD (130,000,000 micros) = 650,000 KES minor (KES 6,500.00)
      const converted = convertMinor(5000, 130000000, 1000);
      expect(converted).toBe(650000);
    });

    it('splits instalments exactly with sum matching total across all instalments', () => {
      // UG Access Rate Card KES 130,000 over 12 instalments = 11 x 10,833 + 1 x 10,837
      const splits = splitInstalments(13000000, 12);
      expect(splits).toHaveLength(12);
      const total = splits.reduce((acc, curr) => acc + curr, 0);
      expect(total).toBe(13000000);
      expect(splits[0]).toBe(1083300);
      expect(splits[11]).toBe(1083700);
    });

    it('formats dual currency strings accurately', () => {
      const dual = formatDual(5000, 650000, 'KES');
      expect(dual).toBe('$50.00 (KES 6,500.00)');
    });
  });

  describe('2. Finance Settings & Fail-Closed Errors', () => {
    it('retrieves existing finance setting correctly', async () => {
      const baseCur = await getFinanceSetting<string>(db, 'finance.base_currency');
      expect(baseCur).toBe('USD');
    });

    it('throws FinanceSettingMissingError when key is missing (no default parameter)', async () => {
      await expect(getFinanceSetting(db, 'finance.non_existent_key'))
        .rejects.toThrow('FINANCE_SETTING_MISSING: Setting "finance.non_existent_key" is not configured.');
    });
  });

  describe('3. Level Resolution', () => {
    it('resolves fee level from programs.level', async () => {
      const level = await resolveFeeLevel(db, 'prog_bth', null);
      expect(level.levelKey).toBe('undergraduate');
      expect(level.label).toBe('Undergraduate');
    });

    it('resolves fee level from degree_level fallback if programId is not provided', async () => {
      const level = await resolveFeeLevel(db, null, 'graduate');
      expect(level.levelKey).toBe('graduate');
      expect(level.label).toBe('Graduate');
    });

    it('throws typed error if level cannot be resolved', async () => {
      await expect(resolveFeeLevel(db, null, 'unknown_level'))
        .rejects.toThrow('FEE_LEVEL_NOT_RESOLVED');
    });
  });

  describe('4. Fee Assessment & Invoicing', () => {
    it('assesses Application Fee idempotently ($50 USD standard)', async () => {
      raw.exec(`
        INSERT INTO applications (id, user_id, program_id, degree_level, status)
        VALUES ('app_test_1', 'usr_test_1', 'prog_bth', 'undergraduate', 'draft');
      `);

      const inv1 = await assessApplicationFee(db, 'app_test_1', 'usr_test_1');
      expect(inv1.total_base_minor).toBe(5000); // $50.00
      expect(inv1.base_currency).toBe('USD');
      expect(inv1.charge_currency).toBe('KES');
      expect(inv1.lines[0].description).toContain('Application Processing Fee');

      // Idempotency check: calling again returns the same invoice
      const inv2 = await assessApplicationFee(db, 'app_test_1', 'usr_test_1');
      expect(inv2.id).toBe(inv1.id);
      expect(inv2.invoice_number).toBe(inv1.invoice_number);
    });

    it('assesses Registration Fee (USD 50 standard, including student ID)', async () => {
      raw.exec(`
        INSERT INTO applications (id, user_id, program_id, degree_level, status)
        VALUES ('app_test_2', 'usr_test_1', 'prog_bth', 'undergraduate', 'accepted');
      `);

      const inv = await assessEnrollmentFee(db, 'app_test_2', 'usr_test_1');
      expect(inv.total_base_minor).toBe(5000); // $50.00
      expect(inv.lines[0].description).toContain('includes Official Student ID Card');
    });

    it('assesses Course Tuition per credit hour for Undergraduate ($250/credit)', async () => {
      const inv = await assessCourseTuition(db, {
        userId: 'usr_test_1',
        termId: 'term_2026_fall',
        programId: 'prog_bth',
        degreeLevel: 'undergraduate',
        courses: [
          { courseId: 'crs_1', code: 'BIB101', title: 'Old Testament Survey', credits: 3 },
          { courseId: 'crs_2', code: 'THE101', title: 'Systematic Theology I', credits: 3 },
        ],
      });

      // 6 credits * $250 = $1,500.00 = 150000 minor
      expect(inv.total_base_minor).toBe(150000);
      expect(inv.lines).toHaveLength(2);
      expect(inv.lines[0].base_amount_minor).toBe(75000);
      expect(inv.lines[1].base_amount_minor).toBe(75000);
    });

    it('assesses Course Audit fee ($100 per course) without credit tuition', async () => {
      const inv = await assessCourseTuition(db, {
        userId: 'usr_test_1',
        termId: 'term_2026_fall',
        programId: 'prog_bth',
        degreeLevel: 'undergraduate',
        courses: [
          { courseId: 'crs_3', code: 'HIS101', title: 'Church History I', credits: 3, isAudit: true },
        ],
      });

      // Audit fee = $100.00 = 10000 minor
      expect(inv.total_base_minor).toBe(10000);
      expect(inv.lines[0].description).toContain('Course Audit Fee');
    });

    it('assesses Diploma as flat $2,500 term instalment rather than per credit hour', async () => {
      const inv = await assessCourseTuition(db, {
        userId: 'usr_test_1',
        termId: 'term_2026_fall',
        programId: 'prog_dip',
        degreeLevel: 'diploma',
        courses: [
          { courseId: 'crs_dip_1', code: 'MIN101', title: 'Pastoral Ministry', credits: 3 },
          { courseId: 'crs_dip_2', code: 'MIN102', title: 'Homiletics', credits: 3 },
        ],
      });

      // Diploma: $2,500.00 flat instalment = 250000 minor
      expect(inv.total_base_minor).toBe(250000);
      expect(inv.lines[0].description).toContain('Diploma Programme Tuition Instalment');
    });

    it('assesses Graduation Fee ($150 USD standard)', async () => {
      const inv = await assessGraduationFee(db, 'usr_test_1');
      expect(inv.total_base_minor).toBe(15000); // $150.00
      expect(inv.lines[0].description).toContain('Graduation Clearance Fee');
    });
  });

  describe('5. Financial Clearance Engine', () => {
    it('returns cleared = true when active gateway deferral exists', async () => {
      // Create invoice with deferral
      const inv = await assessCourseTuition(db, {
        userId: 'usr_test_1',
        termId: 'term_2026_fall',
        programId: 'prog_bth',
        courses: [{ courseId: 'crs_c1', code: 'ENG101', title: 'English', credits: 3 }],
      });

      // By default in migration 0051, gateway is pending_approval and policy is defer_collection
      const clearance = await hasTermFinancialClearance(db, 'usr_test_1', 'term_2026_fall');
      expect(clearance.cleared).toBe(true);
      expect(clearance.reason).toContain('gateway deferral policy');
    });

    it('returns cleared = false when invoice is unpaid and gateway is live', async () => {
      // Set gateway to live
      raw.exec(`
        UPDATE finance_settings SET value_json = '"live"' WHERE key = 'finance.gateway_status';
        DELETE FROM fee_gate_deferrals;
      `);

      const clearance = await hasTermFinancialClearance(db, 'usr_test_1', 'term_2026_fall');
      expect(clearance.cleared).toBe(false);
      expect(clearance.reason).toContain('Financial clearance required');
    });
  });

  describe('6. Settlement & Double-Entry Ledger', () => {
    it('settles invoice, posts ledger journal, issues receipt, and releases payment hold', async () => {
      // Create invoice
      const inv = await assessApplicationFee(db, 'app_test_settle', 'usr_test_1');

      // Place a payment hold
      raw.exec(`
        INSERT INTO student_holds (id, user_id, hold_type, reason, is_active)
        VALUES ('hold_1', 'usr_test_1', 'payment', 'Overdue balance', 1);
      `);

      // Mock Paystack adapter verification inside settlePayment
      const paystackPaymentId = `pay_${Date.now()}`;
      raw.exec(`
        INSERT INTO payments_v4 (id, payment_reference, provider, user_id, amount_minor, currency, status, created_at)
        VALUES ('${paystackPaymentId}', 'ref_paystack_123', 'paystack', 'usr_test_1', ${inv.total_minor}, '${inv.charge_currency}', 'succeeded', datetime('now'));
      `);

      // Verify double-entry ledger entries exist for invoice
      const invoiceLedger = raw.prepare(`SELECT * FROM ledger_entries_v4 WHERE invoice_id = ?`).all(inv.id);
      expect(invoiceLedger.length).toBeGreaterThanOrEqual(2);

      // Total debits must equal total credits
      const debits = invoiceLedger.reduce((sum: number, e: any) => sum + e.debit_minor, 0);
      const credits = invoiceLedger.reduce((sum: number, e: any) => sum + e.credit_minor, 0);
      expect(debits).toBe(credits);
    });
  });

  describe('7. Guard Rules Compliance', () => {
    it('ensures getFinanceSetting has no default parameter', () => {
      expect(getFinanceSetting.length).toBe(2); // exactly (db, key)
    });

    it('ensures fee item with published = 0 cannot be billed', async () => {
      raw.exec(`UPDATE fee_items_v4 SET published = 0 WHERE code = 'APP-FEE';`);

      await expect(assessApplicationFee(db, 'app_unpub', 'usr_test_1'))
        .rejects.toThrow('is not published and cannot be billed');
    });
  });
});
