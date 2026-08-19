import type { IDatabase, IDocumentGenerator } from '@bmi/ports';
import { setEnrollmentStatus, ENROLLMENT_STATUS } from './state-machine';
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

  await db.transaction(async (tx) => {
    // 1. Insert or replace decision record
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
    ).run().catch(() => {});

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

  // 4. Update canonical state machine
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
    `SELECT a.id, a.user_id, a.program, a.degree_level, a.status
     FROM applications a WHERE a.id = ? AND a.user_id = ?`
  ).bind(params.applicationId, params.userId).first<{
    id: string;
    user_id: string;
    program: string;
    degree_level: string;
    status: string;
  }>();

  if (!app) {
    throw new Error('Application not found');
  }

  if (app.status !== 'accepted') {
    throw new Error(`Cannot accept offer for application in status "${app.status}". Offer must be accepted by admissions first.`);
  }

  // Check decision details and deposit requirements if any
  const decision = await db.prepare(
    `SELECT * FROM admissions_decisions WHERE application_id = ?`
  ).bind(params.applicationId).first<DecisionRecord>();

  if (decision?.offer_expires_at) {
    const expiryDate = new Date(decision.offer_expires_at);
    if (new Date() > expiryDate) {
      throw new Error('This admission offer has expired. Please contact the admissions office.');
    }
  }

  if (decision && decision.deposit_required === 1 && decision.deposit_amount > 0) {
    const deposit = await db.prepare(
      `SELECT status FROM enrollment_deposits WHERE application_id = ? AND status = 'confirmed' LIMIT 1`
    ).bind(params.applicationId).first<{ status: string }>();

    if (!deposit) {
      throw new Error('Enrollment deposit payment is required before accepting this offer.');
    }
  }

  // Transition state machine to OFFER_ACCEPTED
  await setEnrollmentStatus(db, {
    userId: params.userId,
    status: ENROLLMENT_STATUS.OFFER_ACCEPTED,
    changedBy: params.userId,
    reason: 'Applicant accepted admission offer',
  });

  // Fire Section 2 saga
  const result = await runProvisioningOrchestration(
    db,
    {
      userId: params.userId,
      applicationId: params.applicationId,
      actorId: params.userId,
      programName: app.program,
    },
    document
  );

  return {
    success: true,
    provisioningResult: result,
  };
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
  const depositId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO enrollment_deposits (
       id, application_id, user_id, amount, paid_at, payment_reference, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`
  ).bind(
    depositId,
    params.applicationId,
    params.userId,
    params.amount,
    now,
    params.paymentReference,
    now
  ).run();

  return {
    success: true,
    depositId,
  };
}
