import { ok, error, typedJson } from '../lib/types';
import type { Env } from '../lib/types';
import type { ExecutionContext } from '@cloudflare/workers-types';
import {
  recordAdmissionsDecision,
  acceptOfferAndProvision,
  recordEnrollmentDeposit,
} from '../lib/admissions-decision-service';
import {
  setEnrollmentStatus,
  getEnrollmentStatus,
  ENROLLMENT_STATUS,
  ALLOWED_TRANSITIONS,
} from '../lib/state-machine';

export async function handleRecordDecision(
  req: Request,
  env: Env,
  adminId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const body = await typedJson<{
      application_id: string;
      decision: 'admit' | 'conditional' | 'waitlist' | 'deny';
      conditions?: string[];
      offer_expires_in_days?: number;
      deposit_required?: boolean;
      deposit_amount?: number;
      reviewer_notes?: string;
    }>(req);

    if (!body.application_id || !body.decision) {
      return error('application_id and decision are required', 400);
    }

    const result = await recordAdmissionsDecision(env.PLATFORM_CONTEXT!.db, {
      applicationId: body.application_id,
      decision: body.decision,
      decidedBy: adminId,
      conditions: body.conditions,
      offerExpiresInDays: body.offer_expires_in_days,
      depositRequired: body.deposit_required,
      depositAmount: body.deposit_amount,
      reviewerNotes: body.reviewer_notes,
    });

    return ok(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to record admissions decision';
    if (/Invalid enrollment transition/i.test(message)) return error(message, 409);
    return error(message, 400);
  }
}

export async function handleGetDecision(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const appId = url.pathname.split('/').pop();

    const db = env.PLATFORM_CONTEXT!.db;
    let query = `SELECT d.*, a.program, a.degree_level, a.status as application_status
                 FROM admissions_decisions d
                 JOIN applications a ON a.id = d.application_id
                 WHERE a.user_id = ?`;
    const bindings: unknown[] = [userId];

    if (appId && appId !== 'decision') {
      query += ' AND d.application_id = ?';
      bindings.push(appId);
    }

    query += ' ORDER BY d.decided_at DESC LIMIT 1';

    const decision = await db.prepare(query).bind(...bindings).first();

    if (!decision) {
      // Return empty/pending if no explicit decision row exists yet
      return ok({ decision: null, status: 'pending' });
    }

    return ok(decision);
  } catch (err: unknown) {
    return error('Failed to retrieve admissions decision', 500);
  }
}

export async function handleAcceptOffer(
  req: Request,
  env: Env,
  userId: string,
  _ctx?: ExecutionContext
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const body = await typedJson<{ application_id: string }>(req);

    if (!body.application_id) {
      return error('application_id is required', 400);
    }

    const result = await acceptOfferAndProvision(
      env.PLATFORM_CONTEXT!.db,
      {
        applicationId: body.application_id,
        userId,
      },
      env.PLATFORM_CONTEXT?.document
    );

    return ok(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to accept offer';
    return error(message, 400);
  }
}

export async function handlePayDeposit(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const body = await typedJson<{
      application_id: string;
      payment_reference: string;
      amount?: number;
    }>(req);

    // Self-confirmation removed: only a gateway reference is accepted and it
    // is re-verified server-side. Client amount is never trusted.
    if (!body.application_id || !body.payment_reference) {
      return error('application_id and payment_reference are required', 400);
    }

    const db = env.PLATFORM_CONTEXT!.db;

    const app = await db.prepare(
      `SELECT id, user_id, status FROM applications WHERE id = ? LIMIT 1`
    ).bind(body.application_id).first<{ id: string; user_id: string; status: string }>().catch(() => null);
    if (!app || app.user_id !== userId) {
      return error('Application not found', 404);
    }

    const decision = await db.prepare(
      `SELECT deposit_required, deposit_amount, offer_expires_at FROM admissions_decisions WHERE application_id = ? LIMIT 1`
    ).bind(body.application_id).first<{ deposit_required: number; deposit_amount: number; offer_expires_at: string | null }>().catch(() => null);
    if (!decision || Number(decision.deposit_required) !== 1) {
      return error('No deposit is required for this application', 400);
    }
    if (decision.offer_expires_at && new Date() > new Date(decision.offer_expires_at)) {
      return error('Offer has expired; deposit cannot be accepted', 409);
    }

    const payment = env.PLATFORM_CONTEXT!.payment;
    if (typeof payment?.verifyPaymentIntent !== 'function') {
      return error('Payment verification is not available', 501);
    }
    let intent: any;
    try {
      intent = await payment.verifyPaymentIntent(body.payment_reference);
    } catch (e: unknown) {
      return error(e instanceof Error ? e.message : 'Payment verification failed', 402);
    }
    if (!intent || intent.status !== 'succeeded') {
      return error('Payment has not succeeded according to the gateway', 402);
    }
    const ownerId = intent.metadata?.userId as string | undefined;
    // Fail closed: all three bindings must be present and equal. A gateway
    // success with missing metadata must never confirm a deposit.
    if (!ownerId || ownerId !== userId) {
      return error('Payment reference does not belong to this student', 403);
    }
    if (intent.metadata?.purpose !== 'deposit') {
      return error('Payment reference is not a deposit payment', 400);
    }
    const intentAppId = (intent.metadata?.applicationId || intent.metadata?.application_id) as string | undefined;
    if (!intentAppId || intentAppId !== body.application_id) {
      return error('Payment reference does not match this application', 400);
    }

    // Amount guard: all adapters normalize to MAJOR units before returning
    // (Paystack/Stripe divide subunits by 100; memory echoes major). Compare
    // in that single unit — never accept raw-or-/100, which would let a
    // subunit amount match a 100x smaller deposit.
    const expected = Number(decision.deposit_amount || 0);
    const receivedRaw = Number(intent.amount);
    const matched =
      Number.isFinite(receivedRaw) &&
      Number.isFinite(expected) &&
      Math.abs(receivedRaw - expected) < 0.01;
    if (!matched) {
      return error(`Deposit amount mismatch: expected ${expected}, gateway verified ${receivedRaw}`, 402);
    }
    if (body.amount !== undefined && Math.abs(Number(body.amount) - expected) >= 0.01) {
      return error('Deposit amount does not match the required amount', 402);
    }

    const result = await recordEnrollmentDeposit(db, {
      applicationId: body.application_id,
      userId,
      amount: expected,
      paymentReference: intent.reference || intent.id || body.payment_reference,
    });

    return ok(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to record deposit';
    return error(message, 400);
  }
}

export async function handleDeclineOffer(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const body = await typedJson<{ application_id: string; reason?: string }>(req);

    if (!body.application_id) {
      return error('application_id is required', 400);
    }

    const db = env.PLATFORM_CONTEXT!.db;
    const app = await db.prepare(
      `SELECT id, user_id, status FROM applications WHERE id = ? AND user_id = ? LIMIT 1`
    ).bind(body.application_id, userId).first<{ id: string; user_id: string; status: string }>().catch(() => null);
    if (!app) {
      return error('Application not found', 404);
    }
    if (app.status !== 'accepted') {
      return error(`Cannot decline offer for application in status "${app.status}"`, 409);
    }

    // Declining is only allowed while the offer is still pending. Once the
    // applicant accepted and provisioning started, withdrawal needs staff help.
    const current = await getEnrollmentStatus(db, userId).catch(() => null);
    const currentStatus = current?.status as string | undefined;
    const DECLINABLE = new Set([
      ENROLLMENT_STATUS.OFFER_EXTENDED,
      ENROLLMENT_STATUS.CONDITIONAL,
      ENROLLMENT_STATUS.ADMITTED,
    ]);
    if (!currentStatus || !DECLINABLE.has(currentStatus as any)) {
      return error(
        currentStatus === ENROLLMENT_STATUS.OFFER_ACCEPTED ||
        currentStatus === ENROLLMENT_STATUS.PROVISIONING_IN_PROGRESS ||
        currentStatus === ENROLLMENT_STATUS.PROVISIONED ||
        currentStatus === ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE ||
        currentStatus === ENROLLMENT_STATUS.REGISTRATION_IN_PROGRESS ||
        currentStatus === ENROLLMENT_STATUS.REGISTERED ||
        currentStatus === ENROLLMENT_STATUS.OFFICIALLY_ENROLLED
          ? 'Offer has already been accepted and provisioning has started; contact admissions to withdraw.'
          : `Cannot decline offer from enrollment status ${currentStatus || 'unknown'}`,
        409
      );
    }

    // Validate the transition BEFORE committing so we never split-brain.
    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(ENROLLMENT_STATUS.APPLICANT_WITHDRAWN)) {
      return error(
        `Invalid enrollment transition: ${currentStatus} → ${ENROLLMENT_STATUS.APPLICANT_WITHDRAWN}.`,
        409
      );
    }

    const nowIso = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.prepare(
        `UPDATE applications SET status = 'withdrawn', updated_at = ? WHERE id = ? AND user_id = ?`
      ).bind(nowIso, body.application_id, userId).run();

      await tx.prepare(
        `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        body.application_id,
        userId,
        app.status,
        'withdrawn',
        body.reason || 'Applicant declined admission offer',
        nowIso
      ).run();
    });

    try {
      await setEnrollmentStatus(db, {
        userId,
        status: ENROLLMENT_STATUS.APPLICANT_WITHDRAWN,
        changedBy: userId,
        reason: body.reason || 'Applicant declined admission offer',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Validated above — a failure here is a lifecycle conflict, never a 500.
      return error(msg, 409);
    }

    return ok({ message: 'Offer declined successfully.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to decline offer';
    if (/Invalid enrollment transition/i.test(message)) return error(message, 409);
    return error(message, 500);
  }
}
