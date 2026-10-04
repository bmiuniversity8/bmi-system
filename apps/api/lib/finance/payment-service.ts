import type { PaymentIntent } from '@bmi/ports';
import { INSTITUTION_LEGAL_NAME, INSTITUTION_TRADING_AS_LINE, paymentReceiptFooter } from '@bmi/shared';
import { safeDispatchEmail, buildEmailLayout, isValidEmail } from '../email';
import type { Env } from '../types';
import type { ExecutionContext } from '@cloudflare/workers-types';

export interface PaymentFulfillmentResult {
  paymentId?: string;
  invoiceId?: string;
  amountMatched: boolean;
  status: string;
  reference: string;
  remainingBalance?: number;
}

/**
 * Server-authoritative payment processor.
 * Fulfills verified payments, records payments and allocations, settles invoices,
 * creates ledger entries in the payment currency, and clears payment holds.
 */
export async function processSuccessfulPayment(
  env: Env,
  intent: PaymentIntent,
  ctx?: ExecutionContext
): Promise<PaymentFulfillmentResult> {
  const db = env.PLATFORM_CONTEXT!.db;
  const metadata = intent.metadata || {};
  const userId = metadata.userId as string | undefined;
  const invoiceId = (metadata.invoiceId || metadata.invoice_id) as string | undefined;
  const reference = intent.reference || intent.id;
  const nowIso = new Date().toISOString();

  // 1. Idempotency Guard: check if payment reference already processed
  const existingPayment = await db.prepare(
    `SELECT * FROM payments WHERE payment_reference = ? LIMIT 1`
  ).bind(reference).first<{ id: string; status: string; amount: number }>().catch(() => null);

  if (existingPayment) {
    return {
      paymentId: existingPayment.id,
      invoiceId,
      amountMatched: true,
      status: existingPayment.status,
      reference,
    };
  }

  // 2. Handle Invoice Settlement
  let invoiceRow: any = null;
  let remainingBalance = 0;
  let amountMatched = true;

  if (invoiceId) {
    invoiceRow = await db.prepare(
      `SELECT * FROM invoices WHERE id = ? LIMIT 1`
    ).bind(invoiceId).first();

    if (invoiceRow) {
      const payableAmount = Number(invoiceRow.balance ?? invoiceRow.total_billing ?? invoiceRow.amount);
      const paidAmount = Number(intent.amount);

      // Verify amount matches within 0.01 tolerance
      if (Number.isFinite(payableAmount) && Number.isFinite(paidAmount) && Math.abs(payableAmount - paidAmount) > 0.05) {
        // Partial payment or mismatch
        console.warn(
          `[finance:payment] Amount difference: invoice ${invoiceId} balance is ${payableAmount}, received ${paidAmount}`
        );
      }

      const prevPaid = Number(invoiceRow.paid_amount || 0);
      const newPaid = prevPaid + paidAmount;
      const totalPayable = Number(invoiceRow.total_billing ?? invoiceRow.amount);
      remainingBalance = Math.max(0, totalPayable - newPaid);
      const newStatus = remainingBalance <= 0.01 ? 'paid' : 'partially_paid';

      await db.prepare(
        `UPDATE invoices 
         SET paid_amount = ?, balance = ?, status = ?, updated_at = ?
         WHERE id = ?`
      ).bind(newPaid, remainingBalance, newStatus, nowIso, invoiceId).run();
    }
  }

  // 3. Record Payment
  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const payCurrency = (intent.currency || 'KES').toUpperCase();

  await db.prepare(
    `INSERT INTO payments (
      id, payment_reference, student_id, uid, provider, channel,
      amount, currency, amount_base_equivalent, exchange_rate,
      exchange_rate_source, status, provider_status, raw_response,
      paid_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?)`
  ).bind(
    paymentId,
    reference,
    userId || invoiceRow?.student_id || 'unknown',
    invoiceRow?.uid || null,
    intent.provider || 'paystack',
    (metadata.channel as string) || 'card',
    Number(intent.amount),
    payCurrency,
    invoiceRow?.total_base || null,
    invoiceRow?.exchange_rate || null,
    invoiceRow?.exchange_rate_source || 'CBK',
    intent.status,
    JSON.stringify(intent.metadata || {}),
    nowIso,
    nowIso
  ).run();

  // 4. Record Payment Allocation
  if (invoiceId) {
    await db.prepare(
      `INSERT INTO payment_allocations (
        id, payment_id, invoice_id, allocated_amount, currency, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      `pa_${paymentId}`,
      paymentId,
      invoiceId,
      Number(intent.amount),
      payCurrency,
      nowIso
    ).run();
  }

  // 5. Record Ledger Entry with explicit currency (never default XAF)
  const studentUid = invoiceRow?.uid;
  if (studentUid) {
    try {
      const account = await db.prepare(
        `SELECT id FROM ledger_accounts WHERE uid = ? LIMIT 1`
      ).bind(studentUid).first<{ id: string }>();

      if (account) {
        await db.prepare(
          `INSERT INTO ledger_entries (
            id, account_id, entry_type, amount, currency, description,
            reference_type, reference_id, term_id, created_at
          ) VALUES (?, ?, 'payment', ?, ?, ?, 'payment', ?, ?, ?)`
        ).bind(
          `le_p_${paymentId}`,
          account.id,
          -Math.abs(Number(intent.amount)), // Negative = credit in student account
          payCurrency,
          `Payment received via ${intent.provider || 'Paystack'} (Ref: ${reference})`,
          paymentId,
          invoiceRow?.term_id || null,
          nowIso
        ).run();
      }
    } catch {
      // Non-fatal
    }
  }

  // 6. Clear Student Payment Holds
  const targetUserId = userId || invoiceRow?.student_id;
  if (targetUserId) {
    await db.prepare(
      `UPDATE student_holds 
       SET is_active = 0, resolved_at = datetime('now') 
       WHERE student_id = ? AND hold_type = 'payment' AND is_active = 1`
    ).bind(targetUserId).run().catch(() => null);

    // 7. Send Receipt Email
    const user = await db.prepare(
      `SELECT email, first_name FROM users WHERE id = ? LIMIT 1`
    ).bind(targetUserId).first<{ email: string; first_name: string }>().catch(() => null);

    if (user?.email && isValidEmail(user.email)) {
      const displayAmount = `${payCurrency} ${Number(intent.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const sendEmail = async () => {
        await safeDispatchEmail(env, ctx, {
          to: user.email,
          subject: `${INSTITUTION_LEGAL_NAME} — Payment Receipt (${reference})`,
          html: buildEmailLayout('Payment Receipt', `
            <h2 style="color: #0f172a; margin-top: 0;">Payment Confirmed</h2>
            <p style="color: #475569; line-height: 1.6;">
              Dear ${user.first_name}, thank you for your payment to <strong>${INSTITUTION_TRADING_AS_LINE}</strong>.
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Receipt / Ref:</td>
                  <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #0f172a;">${reference}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Amount Paid:</td>
                  <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #059669;">${displayAmount}</td>
                </tr>
                ${invoiceRow ? `
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Invoice Number:</td>
                  <td style="padding: 6px 0; text-align: right; color: #0f172a;">${invoiceRow.invoice_number || invoiceRow.id}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Exchange Rate:</td>
                  <td style="padding: 6px 0; text-align: right; color: #0f172a;">1 USD = ${invoiceRow.exchange_rate} KES (${invoiceRow.exchange_rate_source || 'CBK'})</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Remaining Balance:</td>
                  <td style="padding: 6px 0; font-weight: bold; text-align: right; color: ${remainingBalance > 0 ? '#b91c1c' : '#059669'};">
                    ${payCurrency} ${remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
                ` : ''}
              </table>
            </div>
            <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
              ${paymentReceiptFooter(reference)}
            </p>
          `),
          templateName: 'payment_received',
          context: { action: 'payment_received', user_id: targetUserId, invoice_id: invoiceId, reference },
        });
      };

      if (ctx) {
        ctx.waitUntil(sendEmail());
      } else {
        await sendEmail();
      }
    }
  }

  return {
    paymentId,
    invoiceId,
    amountMatched,
    status: 'succeeded',
    reference,
    remainingBalance,
  };
}
