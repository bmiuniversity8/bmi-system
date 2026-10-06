/**
 * Central Fee Assessment & Invoicing Service (Fees System v4)
 *
 * Rules:
 * - Single source of truth for invoice creation.
 * - Guard rule: INSERT INTO invoices_v4 occurs ONLY in this service.
 * - Idempotency guaranteed by charge_key in fee_charges and idempotency_key on invoices.
 * - All money in integer minor units.
 * - Converts each line individually (BigInt half up), sums converted lines for totals.
 * - Handles gateway deferral when gateway status is pending_approval and policy is defer_collection.
 */

import { convertMinor, formatDual } from './money';
import { getFinanceSetting } from './finance-settings';
import { getApprovedExchangeRate } from './fx';

export class FeeLevelNotResolvedError extends Error {
  constructor(reason: string) {
    super(`FEE_LEVEL_NOT_RESOLVED: ${reason}`);
    this.name = 'FeeLevelNotResolvedError';
  }
}

export class FeePlanNotConfiguredError extends Error {
  constructor(levelKey: string) {
    super(`FEE_PLAN_NOT_CONFIGURED: No active fee plan found for level "${levelKey}".`);
    this.name = 'FeePlanNotConfiguredError';
  }
}

export interface AssessLineInput {
  feeItemCode: string;
  description: string;
  quantity?: number;
  courseId?: string;
  overrideAmountMinor?: number; // USD base minor units if customized
}

export interface AssessInvoiceParams {
  userId: string;
  studentId?: string;
  uid?: string;
  applicationId?: string;
  enrollmentKey?: string;
  termId?: string;
  academicYear?: string;
  kind: 'application' | 'enrollment' | 'tuition' | 'statutory' | 'graduation' | 'adjustment';
  sourceEvent: string;
  programId?: string;
  degreeLevel?: string;
  chargeKey: string;
  lines: AssessLineInput[];
  notes?: string;
  paymentPlanOptionCode?: string;
}

export interface AssessedInvoiceResult {
  id: string;
  invoice_number: string;
  total_base_minor: number;
  total_minor: number;
  base_currency: string;
  charge_currency: string;
  formatted_dual: string;
  status: string;
  due_date: string;
  deferred: boolean;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    base_amount_minor: number;
    amount_minor: number;
  }>;
}

/**
 * Resolve canonical fee level from program ID or degree level.
 */
export async function resolveFeeLevel(
  db: any,
  programId?: string | null,
  degreeLevelFallback?: string | null
): Promise<{ levelKey: string; levelId: string; label: string; publicLabel: string }> {
  let resolvedKey = degreeLevelFallback?.toLowerCase().trim();

  if (programId && programId !== 'general') {
    const prog = await (db.prepare(
      `SELECT level FROM programs WHERE id = ? LIMIT 1`
    ).bind(programId).first() as Promise<{ level: string } | null>).catch(() => null);
    if (prog?.level) {
      resolvedKey = prog.level.toLowerCase().trim();
    }
  }

  if (!resolvedKey) {
    throw new FeeLevelNotResolvedError('Neither program_id nor degree_level could be mapped to an academic level.');
  }

  const levelRow = await (db.prepare(
    `SELECT id, level_key, label, public_label FROM fee_levels WHERE level_key = ? LIMIT 1`
  ).bind(resolvedKey).first() as Promise<{ id: string; level_key: string; label: string; public_label: string } | null>).catch(() => null);

  if (!levelRow) {
    throw new FeeLevelNotResolvedError(`Unknown academic level key "${resolvedKey}".`);
  }

  return {
    levelKey: levelRow.level_key,
    levelId: levelRow.id,
    label: levelRow.label,
    publicLabel: levelRow.public_label,
  };
}

/**
 * Generate sequential invoice number from document_sequences table.
 */
async function generateInvoiceNumber(db: any): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();

  await db.prepare(
    `INSERT INTO document_sequences (name, year, next_value)
     VALUES ('invoice', ?, 1)
     ON CONFLICT (name, year) DO UPDATE SET next_value = next_value + 1`
  ).bind(year).run();

  const seqRow = await (db.prepare(
    `SELECT next_value FROM document_sequences WHERE name = 'invoice' AND year = ? LIMIT 1`
  ).bind(year).first() as Promise<{ next_value: number } | null>);

  const seq = seqRow ? seqRow.next_value : 1;
  const padSeq = String(seq).padStart(6, '0');

  let pattern = 'INV-{YEAR}-{SEQ:6}';
  try {
    pattern = await getFinanceSetting<string>(db, 'finance.invoice_number_format');
  } catch {
    // fallback to standard pattern
  }

  return pattern.replace('{YEAR}', String(year)).replace('{SEQ:6}', padSeq);
}

/**
 * Master invoice assessor.
 */
export async function assessInvoice(
  db: any,
  params: AssessInvoiceParams
): Promise<AssessedInvoiceResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Check existing charge via fee_charges
  const existingCharge = await (db.prepare(
    `SELECT fc.invoice_id, i.invoice_number, i.base_total_minor, i.total_minor, i.base_currency, i.charge_currency, i.status, i.due_date
     FROM fee_charges fc
     JOIN invoices_v4 i ON fc.invoice_id = i.id
     WHERE fc.charge_key = ? AND fc.status = 'billed'
     LIMIT 1`
  ).bind(params.chargeKey).first() as Promise<{
    invoice_id: string;
    invoice_number: string;
    base_total_minor: number;
    total_minor: number;
    base_currency: string;
    charge_currency: string;
    status: string;
    due_date: string;
  } | null>).catch(() => null);

  if (existingCharge) {
    const lines = await (db.prepare(
      `SELECT id, description, quantity, base_amount_minor, amount_minor FROM invoice_lines_v4 WHERE invoice_id = ?`
    ).bind(existingCharge.invoice_id).all() as Promise<{ results: Array<{
      id: string;
      description: string;
      quantity: number;
      base_amount_minor: number;
      amount_minor: number;
    }> }>);

    const def = await db.prepare(
      `SELECT id FROM fee_gate_deferrals WHERE invoice_id = ? AND cleared_at IS NULL LIMIT 1`
    ).bind(existingCharge.invoice_id).first().catch(() => null);

    return {
      id: existingCharge.invoice_id,
      invoice_number: existingCharge.invoice_number,
      total_base_minor: existingCharge.base_total_minor,
      total_minor: existingCharge.total_minor,
      base_currency: existingCharge.base_currency,
      charge_currency: existingCharge.charge_currency,
      formatted_dual: formatDual(existingCharge.base_total_minor, existingCharge.total_minor, existingCharge.charge_currency),
      status: existingCharge.status,
      due_date: existingCharge.due_date,
      deferred: !!def,
      lines: lines.results || [],
    };
  }

  // 2. Resolve currency & FX rate
  let baseCurrency = 'USD';
  let defaultChargeCurrency = 'KES';
  let graceDays = 14;
  let gatewayStatus = 'pending_approval';
  let gatewayPolicy = 'defer_collection';

  try {
    baseCurrency = await getFinanceSetting<string>(db, 'finance.base_currency');
    defaultChargeCurrency = await getFinanceSetting<string>(db, 'finance.default_charge_currency');
    graceDays = await getFinanceSetting<number>(db, 'finance.grace_days');
    gatewayStatus = await getFinanceSetting<string>(db, 'finance.gateway_status');
    gatewayPolicy = await getFinanceSetting<string>(db, 'finance.pending_gateway_policy');
  } catch {
    // If settings unseeded, default fallback
  }

  const fxRecord = await getApprovedExchangeRate(db, baseCurrency, defaultChargeCurrency);
  const rateMicros = fxRecord.rate_micros;

  // 3. Resolve academic level & fee items
  const level = await resolveFeeLevel(db, params.programId, params.degreeLevel);
  const invoiceId = `inv4_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const invoiceNumber = await generateInvoiceNumber(db);
  const idempotencyKey = `idemp_${params.chargeKey}`;
  const dueDate = new Date(now.getTime() + graceDays * 86400000).toISOString();

  // 4. Resolve plan & lines
  let baseSubtotalMinor = 0;
  let chargeSubtotalMinor = 0;
  const processedLines: Array<{
    id: string;
    line_no: number;
    fee_item_id: string;
    kind: string;
    description: string;
    quantity: number;
    course_id: string | null;
    base_unit_minor: number;
    base_amount_minor: number;
    unit_minor: number;
    amount_minor: number;
    award_id: string | null;
  }> = [];

  for (let idx = 0; idx < params.lines.length; idx++) {
    const inputLine = params.lines[idx];
    const feeItem = await (db.prepare(
      `SELECT id, code, name, category, published FROM fee_items_v4 WHERE code = ? LIMIT 1`
    ).bind(inputLine.feeItemCode).first() as Promise<{
      id: string;
      code: string;
      name: string;
      category: string;
      published: number;
    } | null>);

    if (!feeItem) {
      throw new Error(`Fee item "${inputLine.feeItemCode}" not found.`);
    }

    if (feeItem.published !== 1) {
      throw new Error(`Fee item "${inputLine.feeItemCode}" is not published and cannot be billed.`);
    }

    // Resolve base unit price from fee_plan_lines_v4 or override
    let unitBaseMinor = inputLine.overrideAmountMinor;
    if (unitBaseMinor === undefined) {
      const planLine = await (db.prepare(
        `SELECT fpl.amount_minor, fpl.charge_basis
         FROM fee_plan_lines_v4 fpl
         JOIN fee_plans_v4 fp ON fpl.fee_plan_id = fp.id
         WHERE fp.fee_level_id = ? AND fpl.fee_item_id = ?
         LIMIT 1`
      ).bind(level.levelId, feeItem.id).first() as Promise<{ amount_minor: number; charge_basis: string } | null>);

      if (!planLine) {
        throw new FeePlanNotConfiguredError(level.levelKey);
      }
      unitBaseMinor = planLine.amount_minor;
    }

    const qty = inputLine.quantity ?? 1;
    const resolvedUnitBase = unitBaseMinor ?? 0;
    const lineBaseTotal = Math.round(resolvedUnitBase * qty);
    const unitCharge = convertMinor(resolvedUnitBase, rateMicros, 1000);
    const lineChargeTotal = Math.round(unitCharge * qty);

    baseSubtotalMinor += lineBaseTotal;
    chargeSubtotalMinor += lineChargeTotal;

    processedLines.push({
      id: `line_${invoiceId}_${idx + 1}`,
      line_no: idx + 1,
      fee_item_id: feeItem.id,
      kind: 'charge',
      description: inputLine.description || feeItem.name,
      quantity: qty,
      course_id: inputLine.courseId || null,
      base_unit_minor: resolvedUnitBase,
      base_amount_minor: lineBaseTotal,
      unit_minor: unitCharge,
      amount_minor: lineChargeTotal,
      award_id: null,
    });
  }

  // 5. Check if student has active fee awards or subsidies
  let baseDiscountMinor = 0;
  let chargeDiscountMinor = 0;

  const activeAward = await (db.prepare(
    `SELECT id, method, percent_bps, fixed_base_minor, rate_card_id, applies_to_json
     FROM fee_awards
     WHERE user_id = ? AND status = 'active'
     LIMIT 1`
  ).bind(params.userId).first() as Promise<{
    id: string;
    method: string;
    percent_bps: number | null;
    fixed_base_minor: number | null;
    rate_card_id: string | null;
    applies_to_json: string;
  } | null>).catch(() => null);

  let neutralInvoiceLabel = 'Institutional Award';
  try {
    neutralInvoiceLabel = await getFinanceSetting<string>(db, 'aid.invoice_label');
  } catch {
    // default label
  }

  if (activeAward && activeAward.percent_bps && activeAward.percent_bps > 0) {
    const bps = BigInt(Math.min(10000, activeAward.percent_bps));
    baseDiscountMinor = Number((BigInt(baseSubtotalMinor) * bps) / 10000n);
    chargeDiscountMinor = Number((BigInt(chargeSubtotalMinor) * bps) / 10000n);

    processedLines.push({
      id: `line_${invoiceId}_award`,
      line_no: processedLines.length + 1,
      fee_item_id: processedLines[0].fee_item_id,
      kind: 'award',
      description: neutralInvoiceLabel,
      quantity: 1,
      course_id: null,
      base_unit_minor: -baseDiscountMinor,
      base_amount_minor: -baseDiscountMinor,
      unit_minor: -chargeDiscountMinor,
      amount_minor: -chargeDiscountMinor,
      award_id: activeAward.id,
    });
  }

  const baseTotalMinor = Math.max(0, baseSubtotalMinor - baseDiscountMinor);
  const totalMinor = Math.max(0, chargeSubtotalMinor - chargeDiscountMinor);

  // 6. User profile snapshot
  const userRow = await (db.prepare(
    `SELECT first_name, last_name, email FROM users WHERE id = ? LIMIT 1`
  ).bind(params.userId).first() as Promise<{ first_name: string; last_name: string; email: string } | null>).catch(() => null);

  const billingName = userRow ? `${userRow.first_name} ${userRow.last_name}`.trim() : 'Enrolled Student';
  const billingEmail = userRow?.email || '';

  // 7. Write to invoices_v4 (sole location)
  await db.prepare(
    `INSERT INTO invoices_v4 (
      id, invoice_number, idempotency_key, kind, source_event, legacy,
      user_id, student_id, uid, application_id, enrollment_key, term_id, academic_year,
      fee_level_id, fee_plan_id, fee_plan_version, instalment_no, instalment_of, plan_group_id,
      base_currency, base_subtotal_minor, base_discount_minor, base_tax_minor, base_total_minor, base_paid_minor,
      charge_currency, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, balance_minor,
      fx_rate_id, fx_rate_micros, fx_rounding_increment_minor, tax_rate_bps,
      status, due_date, issued_at,
      billing_name, billing_email, student_number, level_key, level_label, notes,
      created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, 0,
      ?, ?, ?, ?, ?, ?, ?,
      ?, NULL, 'v1', NULL, NULL, NULL,
      ?, ?, ?, 0, ?, 0,
      ?, ?, ?, 0, ?, 0, ?,
      ?, ?, 1000, NULL,
      'issued', ?, ?,
      ?, ?, ?, ?, ?, ?,
      'fee_assessment_service', ?, ?
    )`
  ).bind(
    invoiceId, invoiceNumber, idempotencyKey, params.kind, params.sourceEvent,
    params.userId, params.studentId || null, params.uid || null, params.applicationId || null, params.enrollmentKey || params.applicationId || null, params.termId || null, params.academicYear || null,
    level.levelId,
    baseCurrency, baseSubtotalMinor, baseDiscountMinor, baseTotalMinor,
    defaultChargeCurrency, chargeSubtotalMinor, chargeDiscountMinor, totalMinor, totalMinor,
    fxRecord.id, rateMicros,
    dueDate, nowIso,
    billingName, billingEmail, params.uid || null, level.levelKey, level.label, params.notes || null,
    nowIso, nowIso
  ).run();

  // Also mirror into legacy invoices table so older readers maintain backward compatibility
  await db.prepare(
    `INSERT OR IGNORE INTO invoices (
      id, invoice_number, student_id, uid, programme_id, degree_level,
      academic_year, term_id, base_currency, billing_currency, exchange_rate,
      subtotal_base, subtotal_billing, discount, total_base, total_billing, amount, balance,
      status, due_date, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      'unpaid', ?, ?, ?
    )`
  ).bind(
    invoiceId, invoiceNumber, params.userId, params.uid || null, params.programId || null, level.levelKey,
    params.academicYear || null, params.termId || null, baseCurrency, defaultChargeCurrency, rateMicros / 1000000,
    baseSubtotalMinor / 100, chargeSubtotalMinor / 100, baseDiscountMinor / 100, baseTotalMinor / 100, totalMinor / 100, totalMinor / 100, totalMinor / 100,
    dueDate, nowIso, nowIso
  ).run().catch(() => null);

  // 8. Write lines
  for (const l of processedLines) {
    await db.prepare(
      `INSERT INTO invoice_lines_v4 (
        id, invoice_id, line_no, fee_item_id, kind, description,
        quantity, course_id, base_unit_minor, base_amount_minor,
        unit_minor, amount_minor, award_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      l.id, invoiceId, l.line_no, l.fee_item_id, l.kind, l.description,
      l.quantity, l.course_id, l.base_unit_minor, l.base_amount_minor,
      l.unit_minor, l.amount_minor, l.award_id, nowIso
    ).run();
  }

  // 9. Write fee_charges row for duplicate prevention
  const chargeId = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  await db.prepare(
    `INSERT INTO fee_charges (id, charge_key, fee_item_id, invoice_id, status, created_at)
     VALUES (?, ?, ?, ?, 'billed', ?)`
  ).bind(chargeId, params.chargeKey, processedLines[0].fee_item_id, invoiceId, nowIso).run();

  // 10. Post Double-Entry Ledger Journal
  const journalId = `jnl_${invoiceId}`;
  await db.prepare(
    `INSERT INTO ledger_entries_v4 (id, journal_id, account_code, debit_minor, credit_minor, currency, invoice_id, description, created_by, created_at)
     VALUES (?, ?, '1000', ?, 0, ?, ?, 'Student Account Receivable Billed', 'fee_assessment_service', ?)`
  ).bind(`le_dr_${invoiceId}`, journalId, totalMinor, defaultChargeCurrency, invoiceId, nowIso).run().catch(() => null);

  const revenueAccount = params.kind === 'tuition' ? '4000'
    : params.kind === 'application' ? '4010'
    : params.kind === 'enrollment' ? '4020'
    : params.kind === 'graduation' ? '4030'
    : '4040';

  await db.prepare(
    `INSERT INTO ledger_entries_v4 (id, journal_id, account_code, debit_minor, credit_minor, currency, invoice_id, description, created_by, created_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, 'Fee Revenue Recognized', 'fee_assessment_service', ?)`
  ).bind(`le_cr_${invoiceId}`, journalId, revenueAccount, chargeSubtotalMinor, defaultChargeCurrency, invoiceId, nowIso).run().catch(() => null);

  if (chargeDiscountMinor > 0) {
    await db.prepare(
      `INSERT INTO ledger_entries_v4 (id, journal_id, account_code, debit_minor, credit_minor, currency, invoice_id, description, created_by, created_at)
       VALUES (?, ?, '4900', ?, 0, ?, ?, 'Institutional Award Subsidy Applied', 'fee_assessment_service', ?)`
    ).bind(`le_awd_${invoiceId}`, journalId, chargeDiscountMinor, defaultChargeCurrency, invoiceId, nowIso).run().catch(() => null);
  }

  // 11. Gateway Deferral handling:
  // If payment gateway status is not live, and policy is defer_collection, write fee_gate_deferrals row
  let isDeferred = false;
  if (gatewayStatus !== 'live' && gatewayPolicy === 'defer_collection') {
    isDeferred = true;
    const defId = `def_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await db.prepare(
      `INSERT INTO fee_gate_deferrals (id, user_id, invoice_id, gate, deferred_at, policy)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(defId, params.userId, invoiceId, params.sourceEvent, nowIso, gatewayPolicy).run().catch(() => null);
  }

  return {
    id: invoiceId,
    invoice_number: invoiceNumber,
    total_base_minor: baseTotalMinor,
    total_minor: totalMinor,
    base_currency: baseCurrency,
    charge_currency: defaultChargeCurrency,
    formatted_dual: formatDual(baseTotalMinor, totalMinor, defaultChargeCurrency),
    status: 'issued',
    due_date: dueDate,
    deferred: isDeferred,
    lines: processedLines.map(l => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      base_amount_minor: l.base_amount_minor,
      amount_minor: l.amount_minor,
    })),
  };
}

/**
 * Assess Application Fee ($50 USD standard)
 */
export async function assessApplicationFee(
  db: any,
  applicationId: string,
  userId: string
): Promise<AssessedInvoiceResult> {
  const app = await (db.prepare(
    `SELECT id, user_id, program_id, degree_level FROM applications WHERE id = ? LIMIT 1`
  ).bind(applicationId).first() as Promise<{ id: string; user_id: string; program_id: string; degree_level: string } | null>).catch(() => null);

  return assessInvoice(db, {
    userId: app?.user_id || userId,
    applicationId,
    kind: 'application',
    sourceEvent: 'application_submit',
    programId: app?.program_id,
    degreeLevel: app?.degree_level || 'undergraduate',
    chargeKey: `app:${applicationId}:APP-FEE`,
    lines: [
      {
        feeItemCode: 'APP-FEE',
        description: 'Application Processing Fee (Non-refundable)',
      },
    ],
  });
}

/**
 * Assess Enrollment & Registration Fee ($50 USD standard, including Student ID)
 */
export async function assessEnrollmentFee(
  db: any,
  applicationId: string,
  userId: string
): Promise<AssessedInvoiceResult> {
  const app = await (db.prepare(
    `SELECT id, user_id, program_id, degree_level FROM applications WHERE id = ? LIMIT 1`
  ).bind(applicationId).first() as Promise<{ id: string; user_id: string; program_id: string; degree_level: string } | null>).catch(() => null);

  return assessInvoice(db, {
    userId: app?.user_id || userId,
    applicationId,
    enrollmentKey: applicationId,
    kind: 'enrollment',
    sourceEvent: 'offer_acceptance',
    programId: app?.program_id,
    degreeLevel: app?.degree_level || 'undergraduate',
    chargeKey: `enr:${applicationId}:REG-FEE`,
    lines: [
      {
        feeItemCode: 'REG-FEE',
        description: 'Registration & Matriculation Fee (includes Official Student ID Card)',
      },
    ],
  });
}

/**
 * Assess Course Tuition (per credit hour for undergraduate/graduate/doctorate/certificate; flat for Diploma)
 */
export async function assessCourseTuition(
  db: any,
  params: {
    userId: string;
    studentId?: string;
    termId: string;
    academicYear?: string;
    programId?: string;
    degreeLevel?: string;
    courses: Array<{ courseId: string; code: string; title: string; credits: number; isAudit?: boolean }>;
    paymentPlanOptionCode?: string;
  }
): Promise<AssessedInvoiceResult> {
  const level = await resolveFeeLevel(db, params.programId, params.degreeLevel || 'undergraduate');
  const chargeLines: AssessLineInput[] = [];

  if (level.levelKey === 'diploma') {
    // Diploma is flat programme total ($10,000 across 4 terms = $2,500/term)
    chargeLines.push({
      feeItemCode: 'TUI-DIPLOMA',
      description: `Diploma Programme Tuition Instalment (${params.termId})`,
      overrideAmountMinor: 250000, // $2,500.00
      quantity: 1,
    });
  } else {
    // Per credit hour tuition per registered course
    for (const c of params.courses) {
      if (c.isAudit) {
        chargeLines.push({
          feeItemCode: 'AUDIT-FEE',
          description: `Course Audit Fee — ${c.code}: ${c.title}`,
          quantity: 1,
          courseId: c.courseId,
        });
      } else {
        chargeLines.push({
          feeItemCode: 'TUI-CREDIT',
          description: `${c.code}: ${c.title} (${c.credits} credit hours)`,
          quantity: c.credits,
          courseId: c.courseId,
        });
      }
    }
  }

  const courseIdsSorted = params.courses.map(c => c.courseId).sort().join('-');
  const chargeKey = `tui:${params.userId}:${params.termId}:${courseIdsSorted || 'term'}`;

  return assessInvoice(db, {
    userId: params.userId,
    studentId: params.studentId,
    termId: params.termId,
    academicYear: params.academicYear,
    kind: 'tuition',
    sourceEvent: 'course_registration',
    programId: params.programId,
    degreeLevel: params.degreeLevel || 'undergraduate',
    chargeKey,
    lines: chargeLines,
    paymentPlanOptionCode: params.paymentPlanOptionCode,
  });
}

/**
 * Assess Graduation Fee ($150 USD standard)
 */
export async function assessGraduationFee(
  db: any,
  userId: string,
  enrollmentKey?: string,
  degreeLevel?: string,
  programId?: string
): Promise<AssessedInvoiceResult> {
  let resolvedLevel = degreeLevel;
  let resolvedProg = programId;
  if (!resolvedLevel && !resolvedProg) {
    const student = await (db.prepare(
      `SELECT program_id, degree_level FROM students WHERE user_id = ? LIMIT 1`
    ).bind(userId).first() as Promise<{ program_id?: string; degree_level?: string } | null>).catch(() => null);
    resolvedLevel = student?.degree_level;
    resolvedProg = student?.program_id;
  }
  if (!resolvedLevel && !resolvedProg) {
    resolvedLevel = 'undergraduate';
  }

  return assessInvoice(db, {
    userId,
    enrollmentKey: enrollmentKey || userId,
    kind: 'graduation',
    sourceEvent: 'graduation_clearance',
    programId: resolvedProg,
    degreeLevel: resolvedLevel,
    chargeKey: `grad:${enrollmentKey || userId}`,
    lines: [
      {
        feeItemCode: 'GRAD-FEE',
        description: 'Degree Conferral & Graduation Clearance Fee',
      },
    ],
  });
}
