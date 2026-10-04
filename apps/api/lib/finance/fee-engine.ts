import type { IDatabase } from '@bmi/ports';
import { convertUsdToKes, allocateDescendingWholeUnits } from '@bmi/shared';
import { getActiveExchangeRate } from './fx-service';

export interface FeeItemRecord {
  id: string;
  fee_schedule_id: string;
  fee_group_id: string;
  code: string;
  name: string;
  degree_level: string | null;
  amount_base_minor: number;
  amount_base: number;
  base_currency: string;
  billing_frequency: string;
  billing_periods: number;
  allocation_strategy: string;
  trigger_event: string | null;
  is_optional: number;
  is_configured: number;
  is_billable: number;
  is_active: number;
}

export interface FeeInstallmentRecord {
  id: string;
  fee_schedule_id: string;
  fee_item_id: string;
  degree_level: string;
  period_number: number;
  amount_base_minor: number;
  amount_base: number;
  currency: string;
  allocation_strategy: string;
}

export interface InvoiceLineInput {
  feeItemId?: string;
  feeGroupId?: string;
  description: string;
  quantity?: number;
  amountBaseUsd: number;
  periodNumber?: number;
  termId?: string;
}

export interface CreateInvoiceOptions {
  studentId: string;
  uid?: string;
  programmeId?: string;
  degreeLevel?: string;
  feeScheduleId?: string;
  academicYear?: string;
  termId?: string;
  periodNumber?: number;
  billingMarket?: string;
  dueDate?: string;
  lines: InvoiceLineInput[];
  discountUsd?: number;
  adjustmentUsd?: number;
}

/**
 * Normalize degree level to canonical enum string.
 */
export function normalizeDegreeLevel(level?: string | null): string {
  if (!level) return 'undergraduate';
  const clean = level.toLowerCase().trim();
  if (clean.includes('cert')) return 'certificate';
  if (clean.includes('dip')) return 'diploma';
  if (clean.includes('under') || clean.includes('bachelor') || clean.startsWith('ba') || clean.startsWith('bs')) return 'undergraduate';
  if (clean.includes('grad') || clean.includes('master') || clean.startsWith('ma') || clean.startsWith('ms')) return 'graduate';
  if (clean.includes('doc') || clean.includes('phd') || clean.startsWith('dmin')) return 'doctorate';
  return 'undergraduate';
}

/**
 * Resolve authoritative tuition pricing for a student's academic level from the database.
 * Level-based, NEVER programme-name-based.
 */
export async function resolveTuitionForLevel(
  db: IDatabase,
  degreeLevel: string,
  feeScheduleId = 'fs_2026'
): Promise<{ feeItem: FeeItemRecord; installments: FeeInstallmentRecord[]; totalUsd: number }> {
  const canonicalLevel = normalizeDegreeLevel(degreeLevel);

  let feeItem = await db.prepare(
    `SELECT * FROM fee_items 
     WHERE fee_schedule_id = ? AND degree_level = ? AND code LIKE 'TUITION_%' AND is_active = 1
     LIMIT 1`
  ).bind(feeScheduleId, canonicalLevel).first<FeeItemRecord>();

  if (!feeItem) {
    // Fall back to level without schedule constraint if needed
    feeItem = await db.prepare(
      `SELECT * FROM fee_items 
       WHERE degree_level = ? AND code LIKE 'TUITION_%' AND is_active = 1
       ORDER BY created_at DESC LIMIT 1`
    ).bind(canonicalLevel).first<FeeItemRecord>();
  }

  if (!feeItem) {
    throw new Error(`No authoritative tuition fee item configured for level "${canonicalLevel}"`);
  }

  let installments = await db.prepare(
    `SELECT * FROM fee_schedule_installments 
     WHERE fee_item_id = ? 
     ORDER BY period_number ASC`
  ).bind(feeItem.id).all<FeeInstallmentRecord>().then(r => r.results);

  // If installments are not yet persisted for this item, dynamically generate and persist them
  if (!installments || installments.length === 0) {
    const generated = allocateDescendingWholeUnits(feeItem.amount_base, feeItem.billing_periods);
    const createdInstallments: FeeInstallmentRecord[] = [];

    for (let i = 0; i < generated.length; i++) {
      const periodNum = i + 1;
      const amtUsd = generated[i];
      const instId = `inst-${feeItem.id}-${periodNum}`;

      await db.prepare(
        `INSERT OR IGNORE INTO fee_schedule_installments
         (id, fee_schedule_id, fee_item_id, degree_level, period_number, amount_base_minor, amount_base, currency, allocation_strategy)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?)`
      ).bind(
        instId,
        feeItem.fee_schedule_id,
        feeItem.id,
        canonicalLevel,
        periodNum,
        amtUsd * 100,
        amtUsd,
        feeItem.allocation_strategy
      ).run();

      createdInstallments.push({
        id: instId,
        fee_schedule_id: feeItem.fee_schedule_id,
        fee_item_id: feeItem.id,
        degree_level: canonicalLevel,
        period_number: periodNum,
        amount_base_minor: amtUsd * 100,
        amount_base: amtUsd,
        currency: 'USD',
        allocation_strategy: feeItem.allocation_strategy,
      });
    }

    installments = createdInstallments;
  }

  return {
    feeItem,
    installments,
    totalUsd: feeItem.amount_base,
  };
}

/**
 * Resolve an onboarding fee component from the database.
 */
export async function resolveOnboardingFee(
  db: IDatabase,
  code: 'APPLICATION_FEE' | 'REGISTRATION_FEE' | 'STUDENT_ID_FEE'
): Promise<FeeItemRecord> {
  const item = await db.prepare(
    `SELECT * FROM fee_items WHERE code = ? AND is_active = 1 LIMIT 1`
  ).bind(code).first<FeeItemRecord>();

  if (!item) {
    throw new Error(`Onboarding fee item "${code}" not found in database`);
  }

  return item;
}

/**
 * Create a new immutable invoice with an FX rate snapshot and invoice lines.
 */
export async function createInvoice(
  db: IDatabase,
  opts: CreateInvoiceOptions
): Promise<any> {
  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date();
  const year = now.getFullYear();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  const invoiceNumber = `INV-${year}-${randomSuffix}`;

  const isKenyanMarket = opts.billingMarket !== 'INTL';
  const baseCurrency = 'USD';
  const billingCurrency = isKenyanMarket ? 'KES' : 'USD';

  // Retrieve active FX snapshot
  let fxRate = 1.0;
  let fxRecord: any = null;
  if (isKenyanMarket) {
    fxRecord = await getActiveExchangeRate(db, 'USD', 'KES');
    fxRate = fxRecord.rate;
  }

  const dueDate = opts.dueDate || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Process Lines
  let subtotalBase = 0;
  let subtotalBilling = 0;
  const processedLines: any[] = [];

  for (const line of opts.lines) {
    const qty = line.quantity || 1;
    const unitBase = line.amountBaseUsd;
    const unitBilling = isKenyanMarket ? convertUsdToKes(unitBase, fxRate) : unitBase;
    const lineTotalBase = unitBase * qty;
    const lineTotalBilling = unitBilling * qty;

    subtotalBase += lineTotalBase;
    subtotalBilling += lineTotalBilling;

    processedLines.push({
      id: `line_${invoiceId}_${processedLines.length + 1}`,
      invoice_id: invoiceId,
      fee_item_id: line.feeItemId || null,
      fee_group_id: line.feeGroupId || null,
      description: line.description,
      quantity: qty,
      unit_amount_base: unitBase,
      base_currency: baseCurrency,
      unit_amount_billing: unitBilling,
      billing_currency: billingCurrency,
      exchange_rate: fxRate,
      period_number: line.periodNumber || opts.periodNumber || null,
      term_id: line.termId || opts.termId || null,
      line_total_base: lineTotalBase,
      line_total_billing: lineTotalBilling,
    });
  }

  const discountUsd = opts.discountUsd || 0;
  const adjustmentUsd = opts.adjustmentUsd || 0;
  const discountBilling = isKenyanMarket ? convertUsdToKes(discountUsd, fxRate) : discountUsd;
  const adjustmentBilling = isKenyanMarket ? convertUsdToKes(adjustmentUsd, fxRate) : adjustmentUsd;

  const totalBase = Math.max(0, subtotalBase - discountUsd + adjustmentUsd);
  const totalBilling = Math.max(0, subtotalBilling - discountBilling + adjustmentBilling);

  // Insert invoice
  await db.prepare(
    `INSERT INTO invoices (
      id, invoice_number, student_id, uid, programme_id, degree_level, fee_schedule_id,
      academic_year, term_id, period_number, base_currency, billing_currency, exchange_rate,
      exchange_rate_id, exchange_rate_source, exchange_rate_effective_at, subtotal_base,
      subtotal_billing, discount, adjustment, total_base, total_billing, amount, paid_amount,
      balance, status, issue_date, due_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?, ?)`
  ).bind(
    invoiceId,
    invoiceNumber,
    opts.studentId,
    opts.uid || null,
    opts.programmeId || null,
    opts.degreeLevel || null,
    opts.feeScheduleId || 'fs_2026',
    opts.academicYear || `${year}-${year + 1}`,
    opts.termId || null,
    opts.periodNumber || null,
    baseCurrency,
    billingCurrency,
    fxRate,
    fxRecord?.id || null,
    fxRecord?.source || 'CBK',
    fxRecord?.effective_at || now.toISOString(),
    subtotalBase,
    subtotalBilling,
    discountBilling,
    adjustmentBilling,
    totalBase,
    totalBilling,
    totalBilling, // amount = total_billing for backwards compatibility
    totalBilling, // balance
    now.toISOString(),
    dueDate,
    now.toISOString(),
    now.toISOString()
  ).run();

  // Insert invoice lines
  for (const line of processedLines) {
    await db.prepare(
      `INSERT INTO invoice_lines (
        id, invoice_id, fee_item_id, fee_group_id, description, quantity,
        unit_amount_base, base_currency, unit_amount_billing, billing_currency,
        exchange_rate, period_number, term_id, line_total_base, line_total_billing, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      line.id,
      line.invoice_id,
      line.fee_item_id,
      line.fee_group_id,
      line.description,
      line.quantity,
      line.unit_amount_base,
      line.base_currency,
      line.unit_amount_billing,
      line.billing_currency,
      line.exchange_rate,
      line.period_number,
      line.term_id,
      line.line_total_base,
      line.line_total_billing,
      now.toISOString()
    ).run();
  }

  // Insert ledger entry for student's ledger account
  if (opts.uid) {
    try {
      let account = await db.prepare(
        `SELECT id FROM ledger_accounts WHERE uid = ? LIMIT 1`
      ).bind(opts.uid).first<{ id: string }>();

      if (!account) {
        const accountId = `acct_${opts.uid}`;
        await db.prepare(
          `INSERT OR IGNORE INTO ledger_accounts (id, uid, status, created_at, updated_at)
           VALUES (?, ?, 'active', ?, ?)`
        ).bind(accountId, opts.uid, now.toISOString(), now.toISOString()).run();
        account = { id: accountId };
      }

      await db.prepare(
        `INSERT INTO ledger_entries (
          id, account_id, entry_type, amount, currency, description,
          reference_type, reference_id, term_id, created_at
        ) VALUES (?, ?, 'charge', ?, ?, ?, 'invoice', ?, ?, ?)`
      ).bind(
        `le_${invoiceId}`,
        account.id,
        totalBilling,
        billingCurrency,
        `${invoiceNumber} - ${processedLines[0]?.description || 'Tuition/Fee Invoice'} (USD $${totalBase.toFixed(2)} @ ${fxRate})`,
        invoiceId,
        opts.termId || null,
        now.toISOString()
      ).run();
    } catch {
      // Non-fatal if ledger tables are missing or in migration transition
    }
  }

  return {
    id: invoiceId,
    invoice_number: invoiceNumber,
    student_id: opts.studentId,
    uid: opts.uid,
    base_currency: baseCurrency,
    billing_currency: billingCurrency,
    exchange_rate: fxRate,
    exchange_rate_source: fxRecord?.source || 'CBK',
    exchange_rate_effective_at: fxRecord?.effective_at || now.toISOString(),
    total_base: totalBase,
    total_billing: totalBilling,
    amount: totalBilling,
    balance: totalBilling,
    status: 'unpaid',
    lines: processedLines,
  };
}

/**
 * Idempotent workflow: Create or reuse Application Fee invoice ($4 USD / KES equivalent).
 */
export async function createApplicationFeeInvoice(
  db: IDatabase,
  userId: string,
  uid?: string,
  billingMarket = 'KE'
): Promise<any> {
  // Check if an application fee invoice already exists for this student
  const existing = await db.prepare(
    `SELECT i.* FROM invoices i
     JOIN invoice_lines il ON il.invoice_id = i.id
     JOIN fee_items fi ON il.fee_item_id = fi.id
     WHERE i.student_id = ? AND fi.code = 'APPLICATION_FEE'
     LIMIT 1`
  ).bind(userId).first();

  if (existing) {
    return existing;
  }

  const feeItem = await resolveOnboardingFee(db, 'APPLICATION_FEE');

  return await createInvoice(db, {
    studentId: userId,
    uid,
    billingMarket,
    lines: [
      {
        feeItemId: feeItem.id,
        feeGroupId: feeItem.fee_group_id,
        description: 'Application Fee (Student Onboarding & Registration Package)',
        amountBaseUsd: feeItem.amount_base,
      },
    ],
  });
}

/**
 * Idempotent workflow: Create or reuse Registration Fee invoice ($16 USD / KES equivalent).
 */
export async function createRegistrationFeeInvoice(
  db: IDatabase,
  userId: string,
  uid?: string,
  billingMarket = 'KE'
): Promise<any> {
  const existing = await db.prepare(
    `SELECT i.* FROM invoices i
     JOIN invoice_lines il ON il.invoice_id = i.id
     JOIN fee_items fi ON il.fee_item_id = fi.id
     WHERE i.student_id = ? AND fi.code = 'REGISTRATION_FEE'
     LIMIT 1`
  ).bind(userId).first();

  if (existing) {
    return existing;
  }

  const feeItem = await resolveOnboardingFee(db, 'REGISTRATION_FEE');

  return await createInvoice(db, {
    studentId: userId,
    uid,
    billingMarket,
    lines: [
      {
        feeItemId: feeItem.id,
        feeGroupId: feeItem.fee_group_id,
        description: 'Registration Fee (Student Onboarding & Registration Package)',
        amountBaseUsd: feeItem.amount_base,
      },
    ],
  });
}

/**
 * Idempotent workflow: Create or reuse Student ID Fee invoice ($4 USD / KES equivalent).
 */
export async function createStudentIdFeeInvoice(
  db: IDatabase,
  userId: string,
  uid?: string,
  billingMarket = 'KE'
): Promise<any> {
  const existing = await db.prepare(
    `SELECT i.* FROM invoices i
     JOIN invoice_lines il ON il.invoice_id = i.id
     JOIN fee_items fi ON il.fee_item_id = fi.id
     WHERE i.student_id = ? AND fi.code = 'STUDENT_ID_FEE'
     LIMIT 1`
  ).bind(userId).first();

  if (existing) {
    return existing;
  }

  const feeItem = await resolveOnboardingFee(db, 'STUDENT_ID_FEE');

  return await createInvoice(db, {
    studentId: userId,
    uid,
    billingMarket,
    lines: [
      {
        feeItemId: feeItem.id,
        feeGroupId: feeItem.fee_group_id,
        description: 'Student ID Card Fee (Student Onboarding & Registration Package)',
        amountBaseUsd: feeItem.amount_base,
      },
    ],
  });
}
