/**
 * Payment Settlement Engine (Fees System v4)
 *
 * Single source of truth for payment fulfillment, idempotency, ledger posting,
 * receipt generation, hold release, and stage gate triggers.
 */

import { fromGatewaySubunit } from './money';

export interface SettlementResult {
  settled: boolean;
  paymentId: string;
  invoiceId: string;
  receiptNumber: string;
  amountMinor: number;
  currency: string;
  status: string;
}

export async function settlePayment(
  env: any,
  gatewayReference: string
): Promise<SettlementResult> {
  const db = env.PLATFORM_CONTEXT!.db;
  const paymentService = env.PLATFORM_CONTEXT!.payment;
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Check idempotency: if payment already settled, return existing receipt
  const existingPayment = await (db.prepare(
    `SELECT p.id, p.status, p.amount_minor, p.charge_currency, r.receipt_number, pa.invoice_id
     FROM payments_v4 p
     LEFT JOIN receipts_v4 r ON r.payment_id = p.id
     LEFT JOIN payment_allocations_v4 pa ON pa.payment_id = p.id
     WHERE p.gateway_reference = ?
     LIMIT 1`
  ).bind(gatewayReference).first() as Promise<{
    id: string;
    status: string;
    amount_minor: number;
    charge_currency: string;
    receipt_number: string | null;
    invoice_id: string | null;
  } | null>).catch(() => null);

  if (existingPayment && existingPayment.status === 'succeeded') {
    return {
      settled: true,
      paymentId: existingPayment.id,
      invoiceId: existingPayment.invoice_id || '',
      receiptNumber: existingPayment.receipt_number || '',
      amountMinor: existingPayment.amount_minor,
      currency: existingPayment.charge_currency,
      status: existingPayment.status,
    };
  }

  // 2. Authoritative verification with Paystack
  let intent: any;
  if (typeof paymentService?.verifyPaymentIntent === 'function') {
    intent = await paymentService.verifyPaymentIntent(gatewayReference);
  } else {
    throw new Error('Payment gateway verification service unavailable.');
  }

  if (!intent || intent.status !== 'succeeded') {
    throw new Error(`Payment verification failed: gateway status is "${intent?.status || 'unknown'}"`);
  }

  const metadata = intent.metadata || {};
  const invoiceId = metadata.invoiceId || metadata.invoice_id;

  if (!invoiceId) {
    throw new Error('Payment reference has no target invoiceId in metadata.');
  }

  // 3. Load invoice from invoices_v4
  const invoice = await (db.prepare(
    `SELECT * FROM invoices_v4 WHERE id = ? LIMIT 1`
  ).bind(invoiceId).first() as Promise<any>);

  if (!invoice) {
    throw new Error(`Invoice "${invoiceId}" not found for payment.`);
  }

  const receivedMinor = fromGatewaySubunit(Number(intent.amount), intent.currency || invoice.charge_currency);
  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const chargeCurrency = (intent.currency || invoice.charge_currency).toUpperCase();

  // 4. Record payment
  await db.prepare(
    `INSERT INTO payments_v4 (
      id, user_id, gateway, gateway_reference, charge_currency,
      amount_minor, channel, status, paid_at, raw_payload_hash, created_at
    ) VALUES (?, ?, 'paystack', ?, ?, ?, ?, 'succeeded', ?, ?, ?)`
  ).bind(
    paymentId,
    invoice.user_id,
    gatewayReference,
    chargeCurrency,
    receivedMinor,
    metadata.channel || intent.channel || 'card',
    nowIso,
    JSON.stringify(intent),
    nowIso
  ).run();

  // 5. Update invoice balance and status
  const currentPaid = Number(invoice.paid_minor || 0);
  const newPaid = currentPaid + receivedMinor;
  const newBalance = Math.max(0, invoice.total_minor - newPaid);
  const newStatus = newBalance <= 0 ? 'paid' : 'partially_paid';

  // Calculate base paid proportional allocation
  const baseProportional = Math.round((receivedMinor * invoice.base_total_minor) / invoice.total_minor);
  const newBasePaid = Math.min(invoice.base_total_minor, Number(invoice.base_paid_minor || 0) + baseProportional);

  await db.prepare(
    `UPDATE invoices_v4
     SET paid_minor = ?, balance_minor = ?, base_paid_minor = ?, status = ?, paid_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(newPaid, newBalance, newBasePaid, newStatus, nowIso, nowIso, invoiceId).run();

  // Also update legacy invoices table for backward compatibility
  await db.prepare(
    `UPDATE invoices
     SET paid_amount = paid_amount + ?, balance = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).bind(receivedMinor / 100, newBalance / 100, newStatus, nowIso, invoiceId).run().catch(() => null);

  // 6. Record payment allocation
  const allocId = `pa_${paymentId}`;
  await db.prepare(
    `INSERT INTO payment_allocations_v4 (id, payment_id, invoice_id, amount_minor, base_amount_minor, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(allocId, paymentId, invoiceId, receivedMinor, baseProportional, nowIso).run();

  // 7. Generate Receipt Number and insert receipt
  const year = now.getFullYear();
  await db.prepare(
    `INSERT INTO document_sequences (name, year, next_value)
     VALUES ('receipt', ?, 1)
     ON CONFLICT (name, year) DO UPDATE SET next_value = next_value + 1`
  ).bind(year).run();

  const seqRow = await (db.prepare(
    `SELECT next_value FROM document_sequences WHERE name = 'receipt' AND year = ? LIMIT 1`
  ).bind(year).first() as Promise<{ next_value: number } | null>);

  const receiptSeq = seqRow ? seqRow.next_value : 1;
  const receiptNumber = `REC-${year}-${String(receiptSeq).padStart(6, '0')}`;
  const receiptId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  await db.prepare(
    `INSERT INTO receipts_v4 (id, receipt_number, payment_id, issued_at)
     VALUES (?, ?, ?, ?)`
  ).bind(receiptId, receiptNumber, paymentId, nowIso).run();

  // 8. Post Double-Entry Ledger Entry
  const journalId = `jnl_${paymentId}`;
  // Debit 1010 (Gateway Clearing)
  await db.prepare(
    `INSERT INTO ledger_entries_v4 (id, journal_id, account_code, debit_minor, credit_minor, currency, invoice_id, payment_id, description, created_by, created_at)
     VALUES (?, ?, '1010', ?, 0, ?, ?, ?, 'Gateway Settlement Received', 'payment_settlement', ?)`
  ).bind(`le_dr_${paymentId}`, journalId, receivedMinor, chargeCurrency, invoiceId, paymentId, nowIso).run().catch(() => null);

  // Credit 1000 (Receivables)
  await db.prepare(
    `INSERT INTO ledger_entries_v4 (id, journal_id, account_code, debit_minor, credit_minor, currency, invoice_id, payment_id, description, created_by, created_at)
     VALUES (?, ?, '1000', 0, ?, ?, ?, ?, 'Receivables Settled', 'payment_settlement', ?)`
  ).bind(`le_cr_${paymentId}`, journalId, receivedMinor, chargeCurrency, invoiceId, paymentId, nowIso).run().catch(() => null);

  // 9. Clear any active fee gate deferral for this invoice
  await db.prepare(
    `UPDATE fee_gate_deferrals SET cleared_at = ? WHERE invoice_id = ? AND cleared_at IS NULL`
  ).bind(nowIso, invoiceId).run().catch(() => null);

  // 10. Check if student has payment holds that can now be released
  if (newBalance <= 0) {
    await db.prepare(
      `DELETE FROM student_holds WHERE user_id = ? AND hold_type = 'payment'`
    ).bind(invoice.user_id).run().catch(() => null);
  }

  // 11. Trigger stage gate transitions:
  // (a) Application fee settled -> advance application from draft to submitted
  if ((invoice.source_event === 'application_submit' || invoice.kind === 'application') && invoice.application_id) {
    await db.prepare(
      `UPDATE applications SET status = 'submitted', updated_at = ? WHERE id = ? AND status = 'draft'`
    ).bind(nowIso, invoice.application_id).run().catch(() => null);
  }

  // (b) Registration / Enrollment fee settled -> check expiry and complete offer acceptance + provisioning
  if (invoice.kind === 'enrollment' || invoice.source_event === 'offer_acceptance') {
    const appId = invoice.application_id || invoice.enrollment_key;
    const decision = await (db.prepare(
      `SELECT offer_expires_at FROM admissions_decisions WHERE application_id = ?`
    ).bind(appId).first() as Promise<{ offer_expires_at: string | null } | null>).catch(() => null);

    const isExpired = decision?.offer_expires_at && (new Date() > new Date(decision.offer_expires_at));
    if (isExpired) {
      // Payment arrived after offer expired: record as account credit and alert staff
      const creditId = `cred_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await db.prepare(
        `INSERT INTO account_credits_v4 (id, user_id, amount_minor, currency, reason, created_at)
         VALUES (?, ?, ?, ?, 'Payment settled after admission offer expired', ?)`
      ).bind(creditId, invoice.user_id, receivedMinor, chargeCurrency, nowIso).run().catch(() => null);
      console.warn(`[settlePayment] Offer expired for app ${appId}; payment converted to account credit.`);
    } else {
      try {
        const { setEnrollmentStatus, ENROLLMENT_STATUS } = await import('./state-machine');
        await setEnrollmentStatus(db, {
          userId: invoice.user_id,
          status: ENROLLMENT_STATUS.OFFER_ACCEPTED,
          changedBy: 'payment_settlement',
          reason: 'Registration fee settled via gateway',
        });

        const appRow = await (db.prepare(
          `SELECT program, program_id FROM applications WHERE id = ?`
        ).bind(appId).first() as Promise<{ program: string; program_id: string } | null>).catch(() => null);

        const { runProvisioningOrchestration } = await import('./provisioning-orchestrator');
        await runProvisioningOrchestration(db, {
          userId: invoice.user_id,
          applicationId: appId || '',
          actorId: 'payment_settlement',
          programName: appRow?.program || 'Academic Program',
          programId: appRow?.program_id,
        });
      } catch (provErr) {
        console.error('[settlePayment] Error triggering provisioning on registration fee settlement:', provErr);
      }
    }

    // (c) Resume any blocked id_card provisioning jobs for this student/user
    await db.prepare(
      `UPDATE provisioning_jobs SET status = 'pending', updated_at = datetime('now')
       WHERE status = 'blocked' AND job_type = 'id_card'
         AND uid IN (SELECT p.uid FROM persons p JOIN users u ON u.person_id = p.id WHERE u.id = ?)`
    ).bind(invoice.user_id).run().catch(() => null);
  }

  return {
    settled: true,
    paymentId,
    invoiceId,
    receiptNumber,
    amountMinor: receivedMinor,
    currency: chargeCurrency,
    status: 'succeeded',
  };
}
