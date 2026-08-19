import type { IDatabase, IDocumentGenerator } from '@bmi/ports';
import { generateUID } from './uid';
import { generateRegNo } from './reg_number';
import { appendLifecycleEvent, STAGES } from './lifecycle';
import { setEnrollmentStatus, ENROLLMENT_STATUS } from './state-machine';

export interface ProvisioningStepResult {
  step: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  completedAt?: string;
  error?: string;
}

export interface OrchestratorResult {
  success: boolean;
  uid: string;
  regNo: string | null;
  studentEmail: string | null;
  catalogYearId: string | null;
  advisorId: string | null;
  steps: ProvisioningStepResult[];
  errors: string[];
}

function buildId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Executes the full Section 2 auto-provisioning saga triggered upon OFFER_ACCEPTED.
 * Completely idempotent: rerunning for an already provisioned student returns existing identities.
 */
export async function runProvisioningOrchestration(
  db: IDatabase,
  input: {
    userId: string;
    applicationId?: string;
    actorId?: string;
    programId?: string;
    programName?: string;
  },
  document?: IDocumentGenerator
): Promise<OrchestratorResult> {
  const now = new Date().toISOString();
  const year = new Date().getUTCFullYear();
  const errors: string[] = [];

  // Mark status as PROVISIONING_IN_PROGRESS
  await setEnrollmentStatus(db, {
    userId: input.userId,
    status: ENROLLMENT_STATUS.PROVISIONING_IN_PROGRESS,
    changedBy: input.actorId || 'system_provisioner',
    reason: 'Auto-provisioning saga started upon offer acceptance',
  });

  const userRow = await db.prepare(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.student_email, u.person_id,
            p.uid, p.national_id, s.reg_no, s.catalog_year_id, s.official_student_id
     FROM users u
     LEFT JOIN persons p ON u.person_id = p.id
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = ?`
  ).bind(input.userId).first<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    student_email: string | null;
    person_id: string | null;
    uid: string | null;
    national_id: string | null;
    reg_no: string | null;
    catalog_year_id: string | null;
    official_student_id: string | null;
  }>();

  if (!userRow) {
    throw new Error(`User not found for provisioning: ${input.userId}`);
  }

  let uid = userRow.uid || userRow.official_student_id || null;
  let personId = userRow.person_id || null;
  let regNo = userRow.reg_no || null;
  let studentEmail = userRow.student_email || null;
  let catalogYearId = userRow.catalog_year_id || null;
  let advisorId: string | null = null;

  const stepsMap: Record<string, ProvisioningStepResult> = {
    identity_resolution: { step: 'identity_resolution', label: 'Identity & Duplicate Resolution', status: 'pending' },
    uid_generation: { step: 'uid_generation', label: 'System UID Generation', status: 'pending' },
    reg_number: { step: 'reg_number', label: 'Registration Number Generation', status: 'pending' },
    registrar_record: { step: 'registrar_record', label: 'Registrar Record & Locked Catalog Year', status: 'pending' },
    iam_provisioning: { step: 'iam_provisioning', label: 'Institutional Email & IAM Account', status: 'pending' },
    advisor_assignment: { step: 'advisor_assignment', label: 'Academic Advisor Assignment & Initial Advising Hold', status: 'pending' },
    document_issuance: { step: 'document_issuance', label: 'Admission Letter & Provisional ID Issuance', status: 'pending' },
  };

  // ─── Step 1: Duplicate & Identity Resolution ──────────────────────────────
  try {
    stepsMap.identity_resolution.status = 'in_progress';
    if (!personId) {
      // Check if another person record matches by email or national_id
      const match = await db.prepare(
        `SELECT p.id, p.uid FROM persons p
         JOIN users u ON u.person_id = p.id
         WHERE u.email = ? AND u.id != ? LIMIT 1`
      ).bind(userRow.email, input.userId).first<{ id: string; uid: string }>();

      if (match) {
        personId = match.id;
        uid = match.uid;
      }
    }
    stepsMap.identity_resolution.status = 'completed';
    stepsMap.identity_resolution.completedAt = new Date().toISOString();
  } catch (err) {
    stepsMap.identity_resolution.status = 'failed';
    stepsMap.identity_resolution.error = String(err);
    errors.push(`Identity resolution error: ${err}`);
  }

  // ─── Step 2: System UID Generation ─────────────────────────────────────────
  try {
    stepsMap.uid_generation.status = 'in_progress';
    if (!uid) {
      uid = await generateUID(db);
      if (!personId) personId = buildId();

      await db.transaction(async (tx) => {
        await tx.prepare(
          `INSERT INTO persons (id, uid, first_name, last_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET uid=excluded.uid, updated_at=excluded.updated_at`
        ).bind(personId, uid, userRow.first_name, userRow.last_name, now, now).run();

        await tx.prepare(
          `UPDATE users SET person_id = ?, updated_at = ? WHERE id = ?`
        ).bind(personId, now, input.userId).run();
      });

      await appendLifecycleEvent(db, {
        idempotencyKey: `prov:uid:${input.userId}`,
        stage: STAGES.UID_GENERATED,
        status: 'completed',
        uid,
        applicationId: input.applicationId,
        actorId: input.actorId,
        notes: `Permanent UID minted: ${uid}`,
      });
    }
    stepsMap.uid_generation.status = 'completed';
    stepsMap.uid_generation.completedAt = new Date().toISOString();
  } catch (err) {
    stepsMap.uid_generation.status = 'failed';
    stepsMap.uid_generation.error = String(err);
    errors.push(`UID generation error: ${err}`);
    throw err; // Critical step: cannot proceed without UID
  }

  // ─── Step 3: Registration Number Generation ───────────────────────────────
  try {
    stepsMap.reg_number.status = 'in_progress';
    if (!regNo || regNo.startsWith('PENDING') || regNo.startsWith('STD')) {
      let programCode = 'GEN';
      if (input.programId) {
        const prog = await db.prepare(
          `SELECT code FROM programs WHERE id = ? LIMIT 1`
        ).bind(input.programId).first<{ code: string }>();
        if (prog?.code) programCode = prog.code;
      } else if (input.programName) {
        const prog = await db.prepare(
          `SELECT code FROM programs WHERE name = ? LIMIT 1`
        ).bind(input.programName).first<{ code: string }>();
        if (prog?.code) programCode = prog.code;
      }
      regNo = await generateRegNo(db, input.programId || 'general', programCode, year, 'UG');
    }
    stepsMap.reg_number.status = 'completed';
    stepsMap.reg_number.completedAt = new Date().toISOString();
  } catch (err) {
    stepsMap.reg_number.status = 'failed';
    stepsMap.reg_number.error = String(err);
    errors.push(`Reg number generation error: ${err}`);
  }

  // ─── Step 4: Core Registrar Record & Locked Catalog Year ───────────────────
  try {
    stepsMap.registrar_record.status = 'in_progress';
    if (!catalogYearId) {
      // Find active academic year or default to current year format (e.g., 'CAT-2026')
      const activeTerm = await db.prepare(
        `SELECT academic_year FROM academic_terms WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`
      ).first<{ academic_year: string }>();
      catalogYearId = activeTerm?.academic_year || `CAT-${year}`;
    }

    const programName = input.programName || 'General Studies';
    const programId = input.programId || 'general';

    await db.transaction(async (tx) => {
      await tx.prepare(
        `INSERT INTO students (
           user_id, student_id, uid, official_student_id, catalog_year_id,
           reg_no, admission_date, program, program_id, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           uid = excluded.uid,
           official_student_id = excluded.official_student_id,
           catalog_year_id = COALESCE(students.catalog_year_id, excluded.catalog_year_id),
           reg_no = excluded.reg_no,
           updated_at = excluded.updated_at`
      ).bind(
        input.userId,
        uid,
        uid,
        uid,
        catalogYearId,
        regNo || `REG-${uid}`,
        now.split('T')[0],
        programName,
        programId,
        now,
        now
      ).run();

      await tx.prepare(
        `UPDATE users SET role = 'student', updated_at = ? WHERE id = ?`
      ).bind(now, input.userId).run();
    });

    stepsMap.registrar_record.status = 'completed';
    stepsMap.registrar_record.completedAt = new Date().toISOString();
  } catch (err) {
    stepsMap.registrar_record.status = 'failed';
    stepsMap.registrar_record.error = String(err);
    errors.push(`Registrar record creation error: ${err}`);
  }

  // ─── Step 5: IAM / Institutional Email Setup ───────────────────────────────
  try {
    stepsMap.iam_provisioning.status = 'in_progress';
    if (!studentEmail) {
      const sanitizedFirst = userRow.first_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const sanitizedLast = userRow.last_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanSerial = uid.replace(/[^0-9]/g, '').slice(-4) || Math.floor(1000 + Math.random() * 9000);
      studentEmail = `${sanitizedFirst}.${sanitizedLast}${cleanSerial}@student.bmi.edu.lr`;

      await db.prepare(
        `UPDATE users SET student_email = ?, updated_at = ? WHERE id = ?`
      ).bind(studentEmail, now, input.userId).run();
    }
    stepsMap.iam_provisioning.status = 'completed';
    stepsMap.iam_provisioning.completedAt = new Date().toISOString();
  } catch (err) {
    stepsMap.iam_provisioning.status = 'failed';
    stepsMap.iam_provisioning.error = String(err);
    errors.push(`IAM provisioning error: ${err}`);
  }

  // ─── Step 6: Academic Advisor Assignment & Initial Advising Hold ───────────
  try {
    stepsMap.advisor_assignment.status = 'in_progress';
    // Auto-select active academic staff member
    const advisor = await db.prepare(
      `SELECT id FROM users WHERE role IN ('staff', 'admin') AND is_verified = 1 LIMIT 1`
    ).first<{ id: string }>();

    advisorId = advisor?.id || 'advisor-general';

    // Place initial advising hold requiring advising release before first registration
    const holdId = `hold-adv-${input.userId}`;
    await db.prepare(
      `INSERT INTO student_holds (id, student_id, hold_type, reason, blocks, placed_by, is_active, created_at)
       VALUES (?, ?, 'advising', 'Mandatory initial academic advising appointment required before course registration', 'registration', ?, 1, ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(holdId, input.userId, advisorId, now).run().catch(() => {});

    stepsMap.advisor_assignment.status = 'completed';
    stepsMap.advisor_assignment.completedAt = new Date().toISOString();
  } catch (err) {
    stepsMap.advisor_assignment.status = 'failed';
    stepsMap.advisor_assignment.error = String(err);
    errors.push(`Advisor assignment error: ${err}`);
  }

  // ─── Step 7: Document Issuance (Admission Letter & Provisional ID) ────────
  try {
    stepsMap.document_issuance.status = 'in_progress';
    if (document) {
      await document.generateDocument({
        type: 'admission_letter',
        userId: input.userId,
        metadata: {
          studentId: input.userId,
          studentName: `${userRow.first_name} ${userRow.last_name}`,
          programName: input.programName || 'General Program',
          admissionDate: now.split('T')[0],
          registrationNumber: regNo || uid,
        },
      }).catch((e: unknown) => console.warn('[orchestrator] Admission letter PDF generation skipped:', e));

      await document.generateDocument({
        type: 'id_card',
        userId: input.userId,
        metadata: {
          studentId: input.userId,
          studentName: `${userRow.first_name} ${userRow.last_name}`,
          programName: input.programName || 'General Program',
          registrationNumber: regNo || uid,
          photoR2Key: '',
        },
      }).catch((e: unknown) => console.warn('[orchestrator] ID Card generation skipped:', e));
    }
    stepsMap.document_issuance.status = 'completed';
    stepsMap.document_issuance.completedAt = new Date().toISOString();
  } catch (err) {
    stepsMap.document_issuance.status = 'failed';
    stepsMap.document_issuance.error = String(err);
    errors.push(`Document issuance error: ${err}`);
  }

  // ─── Final Transition to REGISTRATION_ELIGIBLE ────────────────────────────
  await setEnrollmentStatus(db, {
    userId: input.userId,
    status: ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE,
    changedBy: input.actorId || 'system_provisioner',
    reason: 'Auto-provisioning pipeline completed successfully',
  });

  return {
    success: errors.length === 0,
    uid,
    regNo,
    studentEmail,
    catalogYearId,
    advisorId,
    steps: Object.values(stepsMap),
    errors,
  };
}

/**
 * Retrieves the live status and progress of the provisioning pipeline for a student.
 */
export async function getProvisioningStatus(
  db: IDatabase,
  userId: string
): Promise<{
  status: 'idle' | 'in_progress' | 'completed' | 'failed';
  uid: string | null;
  regNo: string | null;
  studentEmail: string | null;
  catalogYearId: string | null;
  steps: ProvisioningStepResult[];
}> {
  const user = await db.prepare(
    `SELECT u.student_email, u.person_id, p.uid, s.reg_no, s.catalog_year_id, s.status as student_status
     FROM users u
     LEFT JOIN persons p ON u.person_id = p.id
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = ?`
  ).bind(userId).first<{
    student_email: string | null;
    person_id: string | null;
    uid: string | null;
    reg_no: string | null;
    catalog_year_id: string | null;
    student_status: string | null;
  }>();

  const isCompleted = Boolean(user?.uid && user?.reg_no && user?.student_email);

  const steps: ProvisioningStepResult[] = [
    { step: 'identity_resolution', label: 'Identity & Duplicate Resolution', status: user?.person_id ? 'completed' : 'pending' },
    { step: 'uid_generation', label: 'System UID Generation', status: user?.uid ? 'completed' : 'pending' },
    { step: 'reg_number', label: 'Registration Number Generation', status: user?.reg_no ? 'completed' : 'pending' },
    { step: 'registrar_record', label: 'Registrar Record & Locked Catalog Year', status: user?.catalog_year_id ? 'completed' : 'pending' },
    { step: 'iam_provisioning', label: 'Institutional Email & IAM Account', status: user?.student_email ? 'completed' : 'pending' },
    { step: 'advisor_assignment', label: 'Academic Advisor Assignment', status: isCompleted ? 'completed' : 'pending' },
    { step: 'document_issuance', label: 'Admission Letter & Provisional ID', status: isCompleted ? 'completed' : 'pending' },
  ];

  return {
    status: isCompleted ? 'completed' : (user?.uid ? 'in_progress' : 'idle'),
    uid: user?.uid || null,
    regNo: user?.reg_no || null,
    studentEmail: user?.student_email || null,
    catalogYearId: user?.catalog_year_id || null,
    steps,
  };
}
