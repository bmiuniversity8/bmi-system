import { Env, ok, error, typedJson } from '../lib/types';
import { ExecutionContext } from '@cloudflare/workers-types';
import { isValidEmail } from '../lib/email';
import {
  PORTAL_URL,
  INSTITUTION_LEGAL_NAME,
  INSTITUTION_TRADING_AS_LINE,
  PAYSTACK_DEFAULT_CURRENCY,
  buildPaymentDescription,
} from '@bmi/shared';
import type { PaymentIntent } from '@bmi/ports';
import { processSuccessfulPayment } from '../lib/finance/payment-service';

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

    let targetInvoiceId = invoiceId;
    if (purpose === 'deposit' || (applicationId && !invoiceId)) {
      if (!applicationId) return error('applicationId is required for enrollment payments', 400);
      const db = env.PLATFORM_CONTEXT!.db;
      const app = await db.prepare(
        `SELECT id, user_id, status FROM applications WHERE id = ? LIMIT 1`
      ).bind(applicationId).first<{ id: string; user_id: string; status: string }>().catch(() => null);
      if (!app || app.user_id !== userId) return error('Application not found', 404);

      const decision = await db.prepare(
        `SELECT offer_expires_at FROM admissions_decisions WHERE application_id = ? LIMIT 1`
      ).bind(applicationId).first<{ offer_expires_at: string | null }>().catch(() => null);
      if (decision?.offer_expires_at && new Date() > new Date(decision.offer_expires_at)) {
        return error('Offer has expired; payment cannot be taken', 409);
      }

      const { assessEnrollmentFee } = await import('../lib/fee-assessment-service');
      const assessed = await assessEnrollmentFee(db, applicationId, userId);
      targetInvoiceId = assessed.id;
    }

    // Check gateway status
    const db = env.PLATFORM_CONTEXT!.db;
    const gwStatus = await db.prepare("SELECT value_json FROM finance_settings WHERE key = 'finance.gateway_status'").first<{ value_json: string }>().catch(() => null);
    if (gwStatus) {
      try {
        const parsed = JSON.parse(gwStatus.value_json);
        if (parsed === 'pending_approval' && env.ENVIRONMENT === 'production') {
          return error('Payment gateway is currently under review by provider. Collections are operating in deferred mode.', 503);
        }
      } catch { /* proceed */ }
    }

    let currency = (body.currency || PAYSTACK_DEFAULT_CURRENCY).toUpperCase();

    // Server is authoritative for the amount: when an invoice is referenced,
    // resolve the charge from the invoice row and ignore any client-supplied amount.
    if (targetInvoiceId) {
      const invoiceV4 = await db
        .prepare('SELECT id, total_minor, balance_minor, charge_currency, status, user_id FROM invoices_v4 WHERE id = ?')
        .bind(targetInvoiceId)
        .first<{ id: string; total_minor: number; balance_minor: number; charge_currency: string; status: string; user_id: string }>()
        .catch(() => null);

      if (invoiceV4) {
        if (invoiceV4.status === 'paid' || invoiceV4.balance_minor <= 0) return error('Invoice is already paid', 409);
        if (invoiceV4.user_id && invoiceV4.user_id !== userId) return error('Invoice does not belong to this student', 403);
        amount = invoiceV4.balance_minor / 100;
        currency = invoiceV4.charge_currency.toUpperCase();
      } else {
        const invoice = await db
          .prepare('SELECT id, amount, total_billing, billing_currency, status, student_id FROM invoices WHERE id = ?')
          .bind(invoiceId)
          .first<{ id: string; amount: number; total_billing: number | null; billing_currency: string | null; status: string; student_id: string }>()
          .catch(() => null);
        if (!invoice) return error('Invoice not found', 404);
        if (invoice.status === 'paid') return error('Invoice is already paid', 409);
        if (invoice.student_id && invoice.student_id !== userId) {
          return error('Invoice does not belong to this student', 403);
        }
        amount = Number(invoice.total_billing ?? invoice.amount);
        if (invoice.billing_currency) {
          currency = invoice.billing_currency.toUpperCase();
        }
      }
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

    if (!/^[A-Z]{3}$/.test(currency)) return error('Invalid currency code', 400);

    const callbackUrl =
      body.callbackUrl || env.PAYSTACK_CALLBACK_URL || `${PORTAL_URL}/student/finances`;

    const intent = await env.PLATFORM_CONTEXT!.payment.createPaymentIntent({
      amount: Number(amount),
      currency,
      email,
      description: buildPaymentDescription(
        reason || (targetInvoiceId ? `Fee Invoice ${targetInvoiceId.slice(0, 8)}` : 'Tuition payment'),
      ),
      callbackUrl,
      metadata: {
        userId,
        ...(targetInvoiceId ? { invoiceId: targetInvoiceId } : {}),
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
): Promise<{ invoiceId?: string; amountMatched?: boolean; settled?: boolean }> {
  const reference = intent.reference || intent.id;
  const db = env.PLATFORM_CONTEXT!.db;

  try {
    const { settlePayment } = await import('../lib/payment-settlement');
    const res = await settlePayment(db, reference);
    return { invoiceId: res.invoiceId, amountMatched: true, settled: res.settled };
  } catch (err) {
    // If not a v4 invoice or already settled, fall back to legacy handler
    const res = await processSuccessfulPayment(env, intent, ctx);
    return { invoiceId: res.invoiceId, amountMatched: res.amountMatched };
  }
}
