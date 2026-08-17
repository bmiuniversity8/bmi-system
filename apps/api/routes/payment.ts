import { Env, ok, error, typedJson } from '../lib/types';

interface PaymentBody {
  amount?: number;
  reason?: string;
}

export async function handleCreatePaymentIntent(req: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await typedJson<PaymentBody>(req);
    const { amount, reason } = body;
    
    if (!amount) return error('Amount is required', 400);

    const intent = await env.PLATFORM_CONTEXT!.payment.createPaymentIntent({
      amount,
      currency: 'USD',
      description: reason,
      metadata: { userId }
    });
    return ok({ clientSecret: intent.clientSecret, intentId: intent.id });
  } catch {
    return error('Failed to create payment intent', 500);
  }
}

import { ExecutionContext } from '@cloudflare/workers-types';
import { safeDispatchEmail, buildEmailLayout, isValidEmail } from '../lib/email';

export async function handlePaymentWebhook(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    const signature = req.headers.get('stripe-signature') || '';
    const payload = await req.text();
    const intent = await env.PLATFORM_CONTEXT!.payment.handleWebhook(payload, signature);

    if (intent && (intent.status === 'succeeded' || (intent.status as string) === 'paid')) {
      const metadata = intent.metadata || {};
      const userId = metadata.userId as string | undefined;
      const invoiceId = metadata.invoiceId as string | undefined;

      const db = env.PLATFORM_CONTEXT!.db;

      if (invoiceId) {
        await db.prepare('UPDATE invoices SET status = "paid" WHERE id = ?').bind(invoiceId).run().catch(() => {});
      }

      if (userId) {
        await db.prepare(
          `UPDATE student_holds SET is_active = 0, resolved_at = datetime('now') WHERE student_id = ? AND hold_type = 'payment' AND is_active = 1`
        ).bind(userId).run().catch(() => {});

        const user = await db.prepare('SELECT email, first_name FROM users WHERE id = ?').bind(userId).first<{ email: string; first_name: string }>();
        if (user?.email && isValidEmail(user.email)) {
          const runNotify = async () => {
            await safeDispatchEmail(env, ctx, {
              to: user.email,
              subject: 'BMI University — Payment Received',
              html: buildEmailLayout('Payment Confirmation', `
                <h2 style="color: #0f172a;">Thank you, ${user.first_name}!</h2>
                <p style="color: #475569; line-height: 1.6;">
                  We have successfully processed your tuition/fee payment. Your payment hold has been cleared and your student account is in good standing.
                </p>
              `),
              templateName: 'payment_received',
              context: { action: 'payment_received', user_id: userId, invoice_id: invoiceId },
            });
          };
          if (ctx) {
            ctx.waitUntil(runNotify());
          } else {
            await runNotify();
          }
        }
      }
    }

    return ok({ received: true, intentId: intent.id, status: intent.status });
  } catch {
    return error('Webhook processing failed', 400);
  }
}
