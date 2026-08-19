import { ok, error, typedJson } from '../lib/types';
import type { Env } from '../lib/types';
import type { ExecutionContext } from '@cloudflare/workers-types';
import {
  recordAdmissionsDecision,
  acceptOfferAndProvision,
  recordEnrollmentDeposit,
} from '../lib/admissions-decision-service';
import { setEnrollmentStatus, ENROLLMENT_STATUS } from '../lib/state-machine';

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
      amount: number;
      payment_reference: string;
    }>(req);

    if (!body.application_id || !body.amount || !body.payment_reference) {
      return error('application_id, amount, and payment_reference are required', 400);
    }

    const result = await recordEnrollmentDeposit(env.PLATFORM_CONTEXT!.db, {
      applicationId: body.application_id,
      userId,
      amount: body.amount,
      paymentReference: body.payment_reference,
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

    await setEnrollmentStatus(env.PLATFORM_CONTEXT!.db, {
      userId,
      status: ENROLLMENT_STATUS.APPLICANT_WITHDRAWN,
      changedBy: userId,
      reason: body.reason || 'Applicant declined admission offer',
    });

    if (body.application_id) {
      await env.PLATFORM_CONTEXT!.db.prepare(
        `UPDATE applications SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ? AND user_id = ?`
      ).bind(body.application_id, userId).run();
    }

    return ok({ message: 'Offer declined successfully.' });
  } catch (err: unknown) {
    return error('Failed to decline offer', 500);
  }
}
