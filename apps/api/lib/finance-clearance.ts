/**
 * Unified Financial Clearance Engine (Fees System v4)
 *
 * Single source of truth for student course registration and census clearance.
 * Shared by routes/registration.ts and lib/census-job.ts.
 */

export interface ClearanceResult {
  cleared: boolean;
  reason: string;
}

export async function hasTermFinancialClearance(
  db: any,
  studentIdOrUserId: string,
  termId: string
): Promise<ClearanceResult> {
  try {
    // 1. Check for active fee gate deferral (e.g. while payment gateway is pending approval)
    const deferral = await (db.prepare(
      `SELECT d.id, d.policy, d.cleared_at
       FROM fee_gate_deferrals d
       JOIN invoices_v4 i ON d.invoice_id = i.id
       WHERE d.user_id = ? AND (i.term_id = ? OR i.kind = 'enrollment') AND d.cleared_at IS NULL
       LIMIT 1`
    ).bind(studentIdOrUserId, termId).first() as Promise<{ id: string; policy: string; cleared_at: string | null } | null>).catch(() => null);

    if (deferral) {
      return { cleared: true, reason: 'Registration permitted under active gateway deferral policy' };
    }

    // 2. Check for fully or partially paid term invoice satisfying clearance in invoices_v4
    const paidV4 = await (db.prepare(
      `SELECT id, status, balance_minor FROM invoices_v4
       WHERE user_id = ? AND term_id = ? AND status IN ('paid', 'partially_paid')
       LIMIT 1`
    ).bind(studentIdOrUserId, termId).first() as Promise<{ id: string; status: string; balance_minor: number } | null>).catch(() => null);

    if (paidV4 && (paidV4.status === 'paid' || paidV4.balance_minor <= 0)) {
      return { cleared: true, reason: 'paid term invoice (v4)' };
    }

    // 3. Fallback: check legacy invoices table.
    // Individual try-catch: better-sqlite3 throws synchronously at prepare() when the
    // table doesn't exist, before any async .catch() can intercept.
    let legacyPaid: { id: string } | null = null;
    try {
      legacyPaid = await (db.prepare(
        `SELECT id FROM invoices WHERE student_id = ? AND term_id = ? AND status = 'paid' LIMIT 1`
      ).bind(studentIdOrUserId, termId).first() as Promise<{ id: string } | null>).catch(() => null);
    } catch { /* legacy table absent */ }

    if (legacyPaid) {
      return { cleared: true, reason: 'paid term invoice' };
    }

    // 4. Approved financial aid award / payment plan covering the term
    let aid: { id: string } | null = null;
    try {
      aid = await (db.prepare(
        `SELECT id FROM financial_aid_awards WHERE student_id = ? AND term_id = ? AND status IN ('approved', 'awarded', 'disbursed') LIMIT 1`
      ).bind(studentIdOrUserId, termId).first() as Promise<{ id: string } | null>).catch(() => null);
    } catch { /* legacy table absent */ }

    if (aid) {
      return { cleared: true, reason: 'approved aid/payment plan covers term' };
    }

    // 5. Active fee award covering this student and term in v4
    let awardV4: { id: string } | null = null;
    try {
      awardV4 = await (db.prepare(
        `SELECT id FROM fee_awards
         WHERE user_id = ? AND status = 'active'
         AND (valid_from_term IS NULL OR valid_from_term = ? OR valid_to_term >= ?)
         LIMIT 1`
      ).bind(studentIdOrUserId, termId, termId).first() as Promise<{ id: string } | null>).catch(() => null);
    } catch { /* table absent */ }

    if (awardV4) {
      return { cleared: true, reason: 'approved institutional fee award covers term' };
    }

    // 6. Check for unlinked / legacy invoice with NULL term_id
    let legacyNullTerm: { id: string } | null = null;
    try {
      legacyNullTerm = await (db.prepare(
        `SELECT id FROM invoices WHERE student_id = ? AND status = 'paid' AND term_id IS NULL LIMIT 1`
      ).bind(studentIdOrUserId).first() as Promise<{ id: string } | null>).catch(() => null);
    } catch { /* legacy table absent */ }

    if (legacyNullTerm) {
      return {
        cleared: false,
        reason: 'Financial clearance required: paid invoice has NULL term_id and does not satisfy current-term clearance; backfill term_id or pay the current-term invoice.',
      };
    }
  } catch (e: unknown) {
    return {
      cleared: false,
      reason: `Financial clearance check failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return {
    cleared: false,
    reason: 'Financial clearance required: no paid tuition invoice or approved financial aid for the current term.',
  };
}
