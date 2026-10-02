import type { IDatabase, IDocumentGenerator } from '@bmi/ports';
import { runProvisioningOrchestration } from './provisioning-orchestrator';
import { enqueueProvisioningJobs } from './provisioning';
import { appendLifecycleEvent, STAGES } from './lifecycle';

export type RegistrationSource = 'portal' | 'ums_direct' | 'import' | 'batch' | 'lifecycle';

export interface ProvisionInput {
  source: RegistrationSource;
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  programId?: string;
  programName?: string;
  programCode?: string;
  programLevel?: string;
  studyCenterId?: string;
  admissionDate?: string;
  photo?: string;
  gender?: string;
  dateOfBirth?: string;
  nationality?: string;
  phone?: string;
  existingUid?: string;
  existingRegNo?: string;
  applicationId?: string;
  actorId?: string;
}

export interface ProvisionResult {
  uid: string;
  regNo: string | null;
  userId: string;
  personId: string | null;
  studentExists: boolean;
  programLinked: boolean;
  documentsGenerated: boolean;
  provisioningQueued: boolean;
  lifecycleKeys: string[];
}

/**
 * Standardized Unified Provisioner.
 * Delegates the core provisioning saga to `runProvisioningOrchestration` to eliminate
 * divergent provisioning tracks, ensure atomic permanent UIDs, locked catalog years,
 * official student numbers, and canonical state transitions.
 */
export async function runUnifiedProvisioning(
  db: IDatabase,
  input: ProvisionInput,
  document?: IDocumentGenerator
): Promise<ProvisionResult> {
  const now = new Date().toISOString();
  const baseKey = input.applicationId
    ? `prov:${input.applicationId}`
    : `prov:${input.source}:${input.userId}`;
  const lifecycleKeys: string[] = [`${baseKey}:orchestrated`];

  // 1. Delegate core saga execution to the canonical Provisioning Orchestrator
  const orchResult = await runProvisioningOrchestration(
    db,
    {
      userId: input.userId,
      applicationId: input.applicationId,
      actorId: input.actorId,
      programId: input.programId,
      programName: input.programName,
    },
    document
  );

  // 2. Fetch person_id if available
  const user = await db.prepare(
    `SELECT person_id FROM users WHERE id = ?`
  ).bind(input.userId).first<{ person_id: string | null }>();

  // 3. Update extended profile / demographic fields on students & users
  await db.transaction(async (tx) => {
    if (input.phone) {
      await tx.prepare(`UPDATE users SET phone = ?, updated_at = ? WHERE id = ?`)
        .bind(input.phone, now, input.userId).run().catch(() => {});
    }

    await tx.prepare(
      `UPDATE students SET
         gender = COALESCE(?, gender),
         date_of_birth = COALESCE(?, date_of_birth),
         nationality = COALESCE(?, nationality),
         study_center_id = COALESCE(?, study_center_id),
         photo = COALESCE(?, photo),
         updated_at = ?
       WHERE user_id = ?`
    ).bind(
      input.gender || null,
      input.dateOfBirth || null,
      input.nationality || null,
      input.studyCenterId || null,
      input.photo || null,
      now,
      input.userId
    ).run().catch(() => {});
  });

  // 4. Enqueue downstream async integration jobs (LMS, library, ID card, finance)
  let provisioningQueued = false;
  try {
    await enqueueProvisioningJobs(db, orchResult.uid);
    provisioningQueued = true;
  } catch (e) {
    console.warn('[unified-provisioner] Failed to enqueue downstream jobs:', e);
  }

  // 5. Append lifecycle audit trail
  await appendLifecycleEvent(db, {
    idempotencyKey: `${baseKey}:unified_complete`,
    stage: STAGES.STUDENT_ACTIVE,
    status: 'completed',
    uid: orchResult.uid,
    applicationId: input.applicationId || null,
    actorId: input.actorId || null,
    notes: `Provisioning orchestrated via ${input.source}`,
  }).catch(() => {});

  return {
    uid: orchResult.uid,
    regNo: orchResult.regNo,
    userId: input.userId,
    personId: user?.person_id || null,
    studentExists: true,
    programLinked: true,
    documentsGenerated: orchResult.steps.some(s => s.step === 'document_issuance' && s.status === 'completed'),
    provisioningQueued,
    lifecycleKeys,
  };
}
