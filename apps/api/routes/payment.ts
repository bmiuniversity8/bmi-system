import { Env, ok, error, typedJson } from '../lib/types';
import { ExecutionContext } from '@cloudflare/workers-types';
import { safeDispatchEmail, buildEmailLayout, isValidEmail } from '../lib/email';
import {
  PORTAL_URL,
  INSTITUTION_LEGAL_NAME,
  INSTITUTION_TRADING_AS_LINE,
  PAYSTACK_DEFAULT_CURRENCY,
  buildPaymentDescription,
  paymentReceiptFooter,
} from '@bmi/shared';
import type { PaymentIntent } from '@bmi/ports';

interface PaymentBody {
  amount?: number;
  reason?: string;
  email?: string;
  currency?: string;
  invoiceId?: string;
  callbackUrl?: string;
  purpose?: string;
  applicationId?: string;
}

/**
 * POST /api/payment/create-intent
 *
 * Paystack best practice: initialize from the BACKEND only. The portal sends
 * amount + invoice context, the server looks up the student email, creates
 * the Paystack transaction (subunit amount + unique BMI- reference), and
 * returns `authorizationUrl` for redirect (or `accessCode` for InlineJS).
 * The secret key never reaches the browser.
 */
export async function handleCreatePaymentIntent(req: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await typedJson<PaymentBody>(req);
    const { reason, invoiceId, purpose, applicationId } = body;
    let { amount } = body;

    // Deposit intent: the server is authoritative for amount, ownership and
    // expiry. Client amount is ignored.
    let depositApplicationId: string | undefined;
    if (purpose === 'deposit') {
      if (!applicationId) return error('applicationId is required for deposit payments', 400);
      const db = env.PLATFORM_CONTEXT!.db;
      const app = await db.prepare(
        `SELECT id, user_id, status FROM applications WHERE id = ? LIMIT 1`
      ).bind(applicationId).first<{ id: string; user_id: string; status: string }>().catch(() => null);
      if (!app || app.user_id !== userId) return error('Application not found', 404);
      const decision = await db.prepare(
        `SELECT deposit_required, deposit_amount, offer_expires_at FROM admissions_decisions WHERE application_id = ? LIMIT 1`
      ).bind(applicationId).first<{ deposit_required: number; deposit_amount: number; offer_expires_at: string | null }>().catch(() => null);
      if (!decision || Number(decision.deposit_required) !== 1) {
        return error('No deposit is required for this application', 400);
      }
      if (decision.offer_expires_at && new Date() > new Date(decision.offer_expires_at)) {
        return error('Offer has expired; deposit cannot be taken', 409);
      }
      amount = Number(decision.deposit_amount);
      if (!amount || amount <= 0) return error('Deposit amount is not configured', 400);
      depositApplicationId = applicationId;
    }

    // Server is authoritative for the amount: when an invoice is referenced,
    // resolve the charge from the invoice row and ignore any client-supplied amount.
    if (invoiceId) {
      const invoice = await env.PLATFORM_CONTEXT!.db
        .prepare('SELECT id, amount, status, student_id FROM invoices WHERE id = ?')
        .bind(invoiceId)
        .first<{ id: string; amount: number; status: string; student_id: string }>()
        .catch(() => null);
      if (!invoice) return error('Invoice not found', 404);
      if (invoice.status === 'paid') return error('Invoice is already paid', 409);
      // Ownership: invoice must belong to the caller (when tracked).
      if (invoice.student_id && invoice.student_id !== userId) {
        return error('Invoice does not belong to this student', 403);
      }
      amount = Number(invoice.amount);
    }

    if (!amount || Number(amount) <= 0) return error('Amount is required', 400);

    // Resolve payer email — required by Paystack. Prefer explicit, fall back to user record.
    let email = (body.email || '').trim();
    if (!email) {
      try {
        const user = await env.PLATFORM_CONTEXT!.db
          .prepare('SELECT email FROM users WHERE id = ?')
          .bind(userId)
          .first<{ email: string }>();
        if (user?.email) email = user.email;
      } catch { /* keep empty -> 400 below */ }
    }
    if (!email || !isValidEmail(email)) {
      return error('A valid payer email is required to initialize payment', 400);
    }

    const currency = (body.currency || PAYSTACK_DEFAULT_CURRENCY).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return error('Invalid currency code', 400);

    const callbackUrl =
      body.callbackUrl || env.PAYSTACK_CALLBACK_URL || `${PORTAL_URL}/student/finances`;

    const intent = await env.PLATFORM_CONTEXT!.payment.createPaymentIntent({
      amount: Number(amount),
      currency,
      email,
      description: buildPaymentDescription(
        reason || (depositApplicationId ? `Enrollment deposit ${depositApplicationId.slice(0, 8)}` : invoiceId ? `Tuition Invoice ${invoiceId.slice(0, 8)}` : 'Tuition payment'),
      ),
      callbackUrl,
      metadata: {
        userId,
        ...(invoiceId ? { invoiceId } : {}),
        ...(depositApplicationId ? { purpose: 'deposit', applicationId: depositApplicationId } : {}),
        merchant: INSTITUTION_LEGAL_NAME,
        trading_as: INSTITUTION_TRADING_AS_LINE,
      },
    });

    return ok({
      intentId: intent.id,
      reference: intent.reference || intent.id,
      authorizationUrl: intent.authorizationUrl,
      accessCode: intent.accessCode,
      clientSecret: intent.clientSecret,
      currency: intent.currency,
      merchant: INSTITUTION_LEGAL_NAME,
      tradingAs: INSTITUTION_TRADING_AS_LINE,
      publishableKey: env.PAYSTACK_PUBLIC_KEY || undefined,
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : 'Failed to create payment intent';
    // Missing gateway configuration surfaces as 501 (matches prior contract).
    if (/not yet available|no real adapter|unimplemented/i.test(msg)) {
      return error('Payment processing is not yet available. Please try again later.', 501);
    }
    return error(msg || 'Failed to create payment intent', 500);
  }
}

/**
 * GET /api/payment/verify/:reference  (also accepts ?reference=)
 *
 * Frontend callback: after Paystack redirects back with ?reference= / ?trxref=,
 * the portal calls here. The server re-verifies via GET /transaction/verify
 * (authoritative — never trusts the query string alone), checks the amount
 * against the invoice, then fulfills idempotently.
 */
export async function handleVerifyPayment(
  req: Request,
  env: Env,
  userId: string,
  referenceParam?: string,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const reference =
      referenceParam ||
      url.searchParams.get('reference') ||
      url.searchParams.get('trxref') ||
      '';
    if (!reference) return error('Payment reference is required', 400);

    const payment = env.PLATFORM_CONTEXT!.payment;
    if (typeof payment.verifyPaymentIntent !== 'function') {
      return error('Payment verification is not available', 501);
    }
    const intent = await payment.verifyPaymentIntent(reference);

    // Ownership guard: metadata userId must match caller (when present).
    const ownerId = intent.metadata?.userId as string | undefined;
    if (ownerId && ownerId !== userId) {
      return error('Payment reference does not belong to this student', 403);
    }

    if (intent.status !== 'succeeded') {
      return ok({ verified: false, status: intent.status, reference: intent.reference || reference });
    }

    const fulfilled = await fulfillSuccessfulPayment(env, intent);
    return ok({
      verified: true,
      status: intent.status,
      reference: intent.reference || reference,
      ...fulfilled,
    });
  } catch (e: any) {
    return error(e instanceof Error ? e.message : 'Payment verification failed', 400);
  }
}

export async function handlePaymentWebhook(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    // Paystack sends `x-paystack-signature`; keep `stripe-signature` for the
    // legacy fallback during migration.
    const signature =
      req.headers.get('x-paystack-signature') || req.headers.get('stripe-signature') || '';
    const payload = await req.text();
    const intent = await env.PLATFORM_CONTEXT!.payment.handleWebhook(payload, signature);

    if (intent && (intent.status === 'succeeded' || (intent.status as string) === 'paid')) {
      const fulfilled = await fulfillSuccessfulPayment(env, intent, ctx);
      return ok({ received: true, intentId: intent.id, status: intent.status, ...fulfilled });
    }

    return ok({ received: true, intentId: intent.id, status: intent.status });
  } catch {
    return error('Webhook processing failed', 400);
  }
}

// ─── Shared fulfillment (webhook + verify + invoice-pay callback) ───────────

/**
 * Mark invoice paid, clear payment holds, and send the BEMI-branded receipt.
 * Idempotent: if the invoice is already paid, no duplicate writes occur.
 * Amount guard: the verified gateway amount must match the invoice amount —
 * otherwise value is NOT delivered (returns mismatch flag for ops review).
 */
export async function fulfillSuccessfulPayment(
  env: Env,
  intent: PaymentIntent,
  ctx?: ExecutionContext,
): Promise<{ invoiceId?: string; amountMatched?: boolean; depositId?: string }> {
  const metadata = intent.metadata || {};
  const userId = metadata.userId as string | undefined;
  const invoiceId = (metadata.invoiceId || metadata.invoice_id) as string | undefined;
  const depositPurpose = metadata.purpose === 'deposit';
  const depositApplicationId = (metadata.applicationId || metadata.application_id) as string | undefined;
  const db = env.PLATFORM_CONTEXT!.db;

  // Deposit fulfillment: verified gateway amount → confirmed enrollment_deposits row.
  // Idempotent via UNIQUE(payment_reference) + ON CONFLICT DO NOTHING.
  if (depositPurpose && depositApplicationId && userId) {
    const { recordEnrollmentDeposit } = await import('../lib/admissions-decision-service');
    const decision = await db.prepare(
      `SELECT deposit_amount, offer_expires_at FROM admissions_decisions WHERE application_id = ? LIMIT 1`
    ).bind(depositApplicationId).first<{ deposit_amount: number; offer_expires_at: string | null }>().catch(() => null);
    if (decision) {
      if (!decision.offer_expires_at || new Date() <= new Date(decision.offer_expires_at)) {
        const expected = Number(decision.deposit_amount || 0);
        const receivedRaw = Number(intent.amount);
        // Single-unit comparison: adapters already normalize to major units.
        const matched =
          Number.isFinite(receivedRaw) &&
          Number.isFinite(expected) &&
          Math.abs(receivedRaw - expected) < 0.01;
        if (matched) {
          const settledAmount = expected;
          const res = await recordEnrollmentDeposit(db, {
            applicationId: depositApplicationId,
            userId,
            amount: settledAmount,
            paymentReference: intent.reference || intent.id,
          });
          return { amountMatched: true, depositId: res.depositId };
        }
        console.warn(
          `[payment] deposit amount mismatch: application ${depositApplicationId} expects ${expected}, gateway verified ${receivedRaw} (${intent.reference || intent.id}) — holding for review`
        );
        return { amountMatched: false };
      }
    }
  }

  if (invoiceId) {
    const invoice = await db
      .prepare('SELECT id, amount, status FROM invoices WHERE id = ?')
      .bind(invoiceId)
      .first<{ id: string; amount: number; status: string }>()
      .catch(() => null);

    if (invoice) {
      if (invoice.status === 'paid') {
        return { invoiceId, amountMatched: true }; // already fulfilled — idempotent no-op
      }
      const expected = Number(invoice.amount);
      const received = Number(intent.amount);
      if (Number.isFinite(expected) && Number.isFinite(received) && Math.abs(expected - received) > 0.01) {
        console.warn(
          `[payment] amount mismatch: invoice ${invoiceId} expects ${expected}, gateway verified ${received} (${intent.reference || intent.id}) — holding for review`,
        );
        return { invoiceId, amountMatched: false };
      }
      await db.prepare('UPDATE invoices SET status = ? WHERE id = ?').bind('paid', invoiceId).run();
    }
  }

  if (userId) {
    await db.prepare(
      `UPDATE student_holds SET is_active = 0, resolved_at = datetime('now') WHERE student_id = ? AND hold_type = 'payment' AND is_active = 1`
    ).bind(userId).run();

    const user = await db.prepare('SELECT email, first_name FROM users WHERE id = ?').bind(userId).first<{ email: string; first_name: string }>().catch(() => null);
    if (user?.email && isValidEmail(user.email)) {
      const reference = intent.reference || intent.id;
      // Normalize subunit amounts (Paystack kobo/cents) for display.
      const displayAmount = Number(intent.amount) >= 1000 ? (Number(intent.amount) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }) : Number(intent.amount).toLocaleString(undefined, { minimumFractionDigits: 2 });
      const runNotify = async () => {
        await safeDispatchEmail(env, ctx, {
          to: user.email,
          subject: `${INSTITUTION_LEGAL_NAME} — Payment Received`,
          html: buildEmailLayout('Payment Confirmation', `
            <h2 style="color: #0f172a;">Thank you, ${user.first_name}!</h2>
            <p style="color: #475569; line-height: 1.6;">
              We have successfully processed your tuition/fee payment of
              <strong>${intent.currency.toUpperCase()} ${displayAmount}</strong>.
              Your payment hold has been cleared and your student account is in good standing.
            </p>
            <div style="background: #f8fafc; border-left: 4px solid #d4af37; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0 0 6px; color: #0f172a;"><strong>Payee:</strong> ${INSTITUTION_TRADING_AS_LINE}</p>
              <p style="margin: 0; color: #475569; font-size: 13px;">${paymentReceiptFooter(reference)}</p>
            </div>
          `),
          templateName: 'payment_received',
          context: { action: 'payment_received', user_id: userId, invoice_id: invoiceId, reference },
        });
      };
      if (ctx) {
        ctx.waitUntil(runNotify());
      } else {
        await runNotify();
      }
    }
  }

  return { invoiceId, amountMatched: true };
}
