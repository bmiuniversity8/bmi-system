import type { IDatabase, IDocumentGenerator } from '@bmi/ports';
import {
  setEnrollmentStatus,
  getEnrollmentStatus,
  ENROLLMENT_STATUS,
  ALLOWED_TRANSITIONS,
} from './state-machine';
import { runProvisioningOrchestration, OrchestratorResult } from './provisioning-orchestrator';

export interface AdmissionDecisionInput {
  applicationId: string;
  decision: 'admit' | 'conditional' | 'waitlist' | 'deny';
  decidedBy: string;
  conditions?: string[];
  offerExpiresInDays?: number;
  depositRequired?: boolean;
  depositAmount?: number;
  reviewerNotes?: string;
}

export interface DecisionRecord {
  id: string;
  application_id: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  conditions: string | null;
  offer_expires_at: string | null;
  deposit_required: number;
  deposit_amount: number;
}

/**
 * Records an admissions committee decision for an application.
 */
export async function recordAdmissionsDecision(
  db: IDatabase,
  input: AdmissionDecisionInput
): Promise<{ success: boolean; decisionId: string; status: string }> {
  const now = new Date().toISOString();
  const decisionId = crypto.randomUUID();

  const app = await db.prepare(
    `SELECT a.id, a.user_id, a.program, a.status FROM applications a WHERE a.id = ?`
  ).bind(input.applicationId).first<{ id: string; user_id: string; program: string; status: string }>();

  if (!app) {
    throw new Error('Application not found');
  }

  const expiresAt = input.offerExpiresInDays
    ? new Date(Date.now() + input.offerExpiresInDays * 86400000).toISOString()
    : new Date(Date.now() + 30 * 86400000).toISOString();

  let targetStatus: string;
  let targetEnrollmentStatus: string;

  switch (input.decision) {
    case 'admit':
      targetStatus = 'accepted';
      targetEnrollmentStatus = ENROLLMENT_STATUS.OFFER_EXTENDED;
      break;
    case 'conditional':
      targetStatus = 'accepted';
      targetEnrollmentStatus = ENROLLMENT_STATUS.CONDITIONAL;
      break;
    case 'waitlist':
      targetStatus = 'waitlisted';
      targetEnrollmentStatus = ENROLLMENT_STATUS.WAITLISTED;
      break;
    case 'deny':
      targetStatus = 'rejected';
      targetEnrollmentStatus = ENROLLMENT_STATUS.DENIED;
      break;
    default:
      throw new Error(`Invalid decision type: ${input.decision}`);
  }

  // Idempotency + re-decision guard: a prior decision row distinguishes a
  // first decision (always allowed into the offer pipeline) from a re-decision
  // (allowed only along ALLOWED_TRANSITIONS).
  let priorDecision: { id: string; decision: string } | null = null;
  try {
    priorDecision = await db.prepare(
      `SELECT id, decision FROM admissions_decisions WHERE application_id = ? LIMIT 1`
    ).bind(input.applicationId).first<{ id: string; decision: string }>().catch(() => null);
    if (priorDecision && priorDecision.decision === input.decision) {
      const currentApp = await db.prepare(
        `SELECT status FROM applications WHERE id = ? LIMIT 1`
      ).bind(input.applicationId).first<{ status: string }>().catch(() => null);
      if (currentApp?.status === targetStatus) {
        return { success: true, decisionId: priorDecision.id, status: targetStatus };
      }
    }
  } catch {
    // Best-effort idempotency check — fall through to the authoritative path.
  }

  // Validate the enrollment transition BEFORE any write so an invalid
  // re-decision (e.g. admit then waitlist) never leaves partial state.
  // First decisions (no prior row) enter the offer pipeline freely; re-decisions
  // must follow ALLOWED_TRANSITIONS. Fail closed with a clear 409-mappable error.
  if (priorDecision && priorDecision.decision !== input.decision) {
    let currentEnrollment: string | null = null;
    try {
      const s = await getEnrollmentStatus(db, app.user_id);
      currentEnrollment = s.status;
    } catch {
      currentEnrollment = null;
    }
    if (currentEnrollment && currentEnrollment !== targetEnrollmentStatus) {
      const allowed = ALLOWED_TRANSITIONS[currentEnrollment] ?? [];
      if (!allowed.includes(targetEnrollmentStatus)) {
        throw new Error(
          `Invalid enrollment transition: ${currentEnrollment} → ${targetEnrollmentStatus}. Allowed: ${allowed.join(', ') || '(terminal)'}.`
        );
      }
    }
  }

  await db.transaction(async (tx) => {
    // 1. Insert or replace decision record (fail closed — no swallowed errors).
    await tx.prepare(
      `INSERT INTO admissions_decisions (
         id, application_id, decision, decided_by, decided_at,
         conditions, offer_expires_at, deposit_required, deposit_amount, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(application_id) DO UPDATE SET
         decision = excluded.decision,
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at,
         conditions = excluded.conditions,
         offer_expires_at = excluded.offer_expires_at,
         deposit_required = excluded.deposit_required,
         deposit_amount = excluded.deposit_amount,
         updated_at = excluded.updated_at`
    ).bind(
      decisionId,
      input.applicationId,
      input.decision,
      input.decidedBy,
      now,
      input.conditions ? JSON.stringify(input.conditions) : null,
      expiresAt,
      input.depositRequired ? 1 : 0,
      input.depositAmount || 0,
      now,
      now
    ).run();

    // 2. Update application status
    await tx.prepare(
      `UPDATE applications SET
         status = ?,
         reviewer_id = ?,
         reviewer_notes = ?,
         reviewed_at = ?,
         updated_at = ?
       WHERE id = ?`
    ).bind(
      targetStatus,
      input.decidedBy,
      input.reviewerNotes || null,
      now,
      now,
      input.applicationId
    ).run();

    // 3. Log status change
    await tx.prepare(
      `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      input.applicationId,
      input.decidedBy,
      app.status,
      targetStatus,
      input.reviewerNotes || `Decision: ${input.decision}`,
      now
    ).run();
  });

  // 4. Update canonical state machine (validated above; rethrow on failure so
  //    callers surface 409 instead of a silent split-brain).
  await setEnrollmentStatus(db, {
    userId: app.user_id,
    status: targetEnrollmentStatus as any,
    changedBy: input.decidedBy,
    reason: `Admissions decision: ${input.decision}`,
  });

  return {
    success: true,
    decisionId,
    status: targetStatus,
  };
}

/**
 * Handles applicant offer acceptance and fires the Section 2 auto-provisioning saga.
 */
export async function acceptOfferAndProvision(
  db: IDatabase,
  params: {
    applicationId: string;
    userId: string;
  },
  document?: IDocumentGenerator
): Promise<{ success: boolean; provisioningResult: OrchestratorResult }> {
  const app = await db.prepare(
    `SELECT a.id, a.user_id, a.program, a.program_id, a.degree_level, a.status
     FROM applications a WHERE a.id = ? AND a.user_id = ?`
  ).bind(params.applicationId, params.userId).first<{
    id: string;
    user_id: string;
    program: string;
    program_id?: string | null;
    degree_level: string;
    status: string;
  }>();

  if (!app) {
    throw new Error('Application not found');
  }

  if (app.status !== 'accepted') {
    throw new Error(`Cannot accept offer for application in status "${app.status}". Offer must be accepted by admissions first.`);
  }

  // Check decision details
  const decision = await db.prepare(
    `SELECT * FROM admissions_decisions WHERE application_id = ?`
  ).bind(params.applicationId).first<DecisionRecord>();

  if (decision?.offer_expires_at) {
    const expiryDate = new Date(decision.offer_expires_at);
    if (new Date() > expiryDate) {
      throw new Error('This admission offer has expired. Please contact the admissions office.');
    }
  }

  // Fees System v4: Resolve Fee Level and Pin Fee Plan
  let enrollmentInvoice: any = null;
  try {
    const { resolveFeeLevel, assessEnrollmentFee } = await import('./fee-assessment-service');
    const level = await resolveFeeLevel(db, app.program_id, app.degree_level);

    const activePlan = await db.prepare(
      `SELECT id FROM fee_plans_v4 WHERE fee_level_id = ? AND status = 'active' ORDER BY effective_start DESC LIMIT 1`
    ).bind(level.levelId).first<{ id: string }>().catch(() => null);

    if (activePlan) {
      const pinId = `pin_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.prepare(
        `INSERT INTO fee_pins (id, user_id, student_id, uid, program_id, fee_level_id, fee_plan_id, pinned_at, notes)
         VALUES (?, ?, NULL, NULL, ?, ?, ?, datetime('now'), 'Pinned at offer acceptance')
         ON CONFLICT (id) DO NOTHING`
      ).bind(pinId, params.userId, app.program_id || 'general', level.levelId, activePlan.id).run().catch(() => null);
    }

    // Assess Registration Fee (USD 50 standard, includes official Student ID)
    enrollmentInvoice = await assessEnrollmentFee(db, params.applicationId, params.userId);
  } catch {
    // If v4 assessment fails (e.g. unconfigured mock in tests), fallback to legacy deposit check
    if (decision && Number(decision.deposit_required) === 1 && Number(decision.deposit_amount) > 0) {
      const deposit = await db.prepare(
        `SELECT status FROM enrollment_deposits WHERE application_id = ? AND status = 'confirmed' LIMIT 1`
      ).bind(params.applicationId).first<{ status: string }>().catch(() => null);

      if (!deposit) {
        throw new Error('Enrollment deposit payment is required before accepting this offer.');
      }
    }
  }

  // If fee is waived (0 total), deferred under gateway deferral policy, waived by admissions decision (deposit_required === 0 / false),
  // or v4 assessment wasn't available, proceed immediately
  const isDepositWaived = decision && (Number(decision.deposit_required) === 0 || (decision as any).deposit_required === false);
  if (!enrollmentInvoice || enrollmentInvoice.deferred || enrollmentInvoice.total_minor === 0 || isDepositWaived) {
    await setEnrollmentStatus(db, {
      userId: params.userId,
      status: ENROLLMENT_STATUS.OFFER_ACCEPTED,
      changedBy: params.userId,
      reason: isDepositWaived
        ? 'Applicant accepted admission offer (deposit waived by admissions decision)'
        : 'Applicant accepted admission offer (registration fee waived/deferred)',
    });

    const result = await runProvisioningOrchestration(
      db,
      {
        userId: params.userId,
        applicationId: params.applicationId,
        actorId: params.userId,
        programName: app.program,
        programId: app.program_id || undefined,
      },
      document
    );

    return {
      success: true,
      provisioningResult: result,
    };
  }

  // Check if invoice was already paid
  let paidCheck: { status: string; balance_minor: number } | null = null;
  if (enrollmentInvoice?.id) {
    paidCheck = await db.prepare(
      `SELECT status, balance_minor FROM invoices_v4 WHERE id = ? LIMIT 1`
    ).bind(enrollmentInvoice.id).first<{ status: string; balance_minor: number }>().catch(() => null);
  }

  if (paidCheck && (paidCheck.status === 'paid' || paidCheck.balance_minor <= 0)) {
    await setEnrollmentStatus(db, {
      userId: params.userId,
      status: ENROLLMENT_STATUS.OFFER_ACCEPTED,
      changedBy: params.userId,
      reason: 'Applicant accepted admission offer (registration fee paid)',
    });

    const result = await runProvisioningOrchestration(
      db,
      {
        userId: params.userId,
        applicationId: params.applicationId,
        actorId: params.userId,
        programName: app.program,
        programId: app.program_id || undefined,
      },
      document
    );

    return {
      success: true,
      provisioningResult: result,
    };
  }

  // Not yet paid and not deferred: record acceptance intent and return payment requirement
  await db.prepare(
    `UPDATE admissions_decisions SET reviewer_notes = 'Acceptance intent recorded; pending registration fee settlement' WHERE application_id = ?`
  ).bind(params.applicationId).run().catch(() => null);

  return {
    success: false,
    paymentRequired: true,
    message: 'Registration fee payment required to complete offer acceptance and provisioning.',
    invoice: enrollmentInvoice,
  } as any;
}

/**
 * Records an enrollment deposit payment.
 */
export async function recordEnrollmentDeposit(
  db: IDatabase,
  params: {
    applicationId: string;
    userId: string;
    amount: number;
    paymentReference: string;
  }
): Promise<{ success: boolean; depositId: string }> {
  const now = new Date().toISOString();

  // Idempotent: a gateway reference fulfills at most one deposit.
  const existing = await db.prepare(
    `SELECT id FROM enrollment_deposits WHERE payment_reference = ? LIMIT 1`
  ).bind(params.paymentReference).first<{ id: string }>().catch(() => null);
  if (existing) {
    return { success: true, depositId: existing.id };
  }

  const depositId = crypto.randomUUID();

  await db.prepare(
    `INSERT INTO enrollment_deposits (
       id, application_id, user_id, amount, paid_at, payment_reference, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)
     ON CONFLICT(payment_reference) DO NOTHING`
  ).bind(
    depositId,
    params.applicationId,
    params.userId,
    params.amount,
    now,
    params.paymentReference,
    now
  ).run();

  const row = await db.prepare(
    `SELECT id FROM enrollment_deposits WHERE payment_reference = ? LIMIT 1`
  ).bind(params.paymentReference).first<{ id: string }>().catch(() => null);

  return {
    success: true,
    depositId: row?.id ?? depositId,
  };
}
