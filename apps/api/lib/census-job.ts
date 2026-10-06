import type { IDatabase } from '@bmi/ports';
import { setEnrollmentStatus, getEnrollmentStatus, ENROLLMENT_STATUS } from './state-machine';
import { appendLifecycleEvent, STAGES } from './lifecycle';
import { hasTermFinancialClearance } from './finance-clearance';

async function getEnrollmentStatusCompat(db: IDatabase, userId: string): Promise<string> {
  try {
    const s = await getEnrollmentStatus(db, userId);
    return s.status;
  } catch {
    return 'UNKNOWN';
  }
}

export interface CensusRunResult {
  termId: string;
  processedCount: number;
  enrolledCount: number;
  skippedCount: number;
  enrolledStudentIds: string[];
  skippedReason?: string;
}

/**
 * Runs the term census job to officially enroll students who completed course registration
 * with financial clearance and no blocking holds. term_id is mandatory for new
 * records; legacy NULL-term enrollments are ignored (never auto-enrolled).
 *
 * Census gating (Task 08): does nothing until `now >= academic_terms.census_date`.
 * If `census_date` is NULL (or the column is missing pre-migration), skips with a
 * clear reason and never enrolls. Pass `force=true` (admin-only, audited by the
 * caller) to override the date gate.
 */
export async function runTermCensusJob(
  db: IDatabase,
  termId?: string,
  actorId = 'census_job',
  options?: { force?: boolean }
): Promise<CensusRunResult> {
  // Find target term: prefer registration/active status.
  let targetTerm: { id: string; name: string; census_date?: string | null } | null = null;
  if (termId) {
    try {
      targetTerm = await db.prepare(
        `SELECT id, name, census_date FROM academic_terms WHERE id = ? LIMIT 1`
      ).bind(termId).first<{ id: string; name: string; census_date?: string | null }>();
    } catch {
      targetTerm = await db.prepare(
        `SELECT id, name FROM academic_terms WHERE id = ? LIMIT 1`
      ).bind(termId).first<{ id: string; name: string }>();
    }
  } else {
    try {
      targetTerm = await db.prepare(
        `SELECT id, name, census_date FROM academic_terms WHERE status IN ('registration', 'active') ORDER BY start_date DESC LIMIT 1`
      ).first<{ id: string; name: string; census_date?: string | null }>().catch(async () => {
        return await db.prepare(
          `SELECT id, name FROM academic_terms WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`
        ).first<{ id: string; name: string }>();
      });
    } catch {
      targetTerm = await db.prepare(
        `SELECT id, name FROM academic_terms WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`
      ).first<{ id: string; name: string }>();
    }
  }

  if (!targetTerm) {
    throw new Error('No active term found for census run');
  }

  // Date gate (unless forced by an audited admin run).
  if (!options?.force) {
    const censusDate = (targetTerm as any)?.census_date ?? null;
    if (!censusDate) {
      return {
        termId: targetTerm.id,
        processedCount: 0,
        enrolledCount: 0,
        skippedCount: 0,
        enrolledStudentIds: [],
        skippedReason: 'census_date_not_set',
      };
    }
    if (new Date() < new Date(censusDate)) {
      return {
        termId: targetTerm.id,
        processedCount: 0,
        enrolledCount: 0,
        skippedCount: 0,
        enrolledStudentIds: [],
        skippedReason: 'before_census_date',
      };
    }
  }

  // Only enrollments explicitly tied to this term. Legacy rows with NULL term_id
  // are excluded — they must be backfilled before they can confer enrollment.
  const registeredStudents = await db.prepare(
    `SELECT DISTINCT s.user_id, s.uid, s.reg_no
     FROM students s
     JOIN enrollments e ON e.student_id = s.user_id
     WHERE e.status = 'enrolled' AND e.term_id = ?`
  ).bind(targetTerm.id).all<{ user_id: string; uid: string; reg_no: string }>();

  const studentsList = registeredStudents?.results || [];
  let enrolledCount = 0;
  let skippedCount = 0;
  const enrolledStudentIds: string[] = [];

  for (const student of studentsList) {
    // 1. Must be in REGISTERED state (finalize transaction completed).
    const enrollment = await getEnrollmentStatusCompat(db, student.user_id);
    if (enrollment !== ENROLLMENT_STATUS.REGISTERED && enrollment !== ENROLLMENT_STATUS.OFFICIALLY_ENROLLED) {
      skippedCount++;
      continue;
    }
    if (enrollment === ENROLLMENT_STATUS.OFFICIALLY_ENROLLED) {
      skippedCount++; // already enrolled — idempotent rerun guard
      continue;
    }

    // 2. Check for blocking holds
    const blockingHold = await db.prepare(
      `SELECT id FROM student_holds
       WHERE student_id = ? AND is_active = 1 AND (blocks LIKE '%registration%' OR blocks LIKE '%all%')
       LIMIT 1`
    ).bind(student.user_id).first();

    if (blockingHold) {
      skippedCount++;
      continue;
    }

    // 3. Financial clearance (same clearance as registration finalize)
    const clearance = await hasTermFinancialClearance(db, student.user_id, targetTerm.id);
    if (!clearance.cleared) {
      skippedCount++;
      continue;
    }

    // Transition to OFFICIALLY_ENROLLED
    await setEnrollmentStatus(db, {
      userId: student.user_id,
      status: ENROLLMENT_STATUS.OFFICIALLY_ENROLLED,
      changedBy: actorId,
      termId: targetTerm.id,
      reason: `Census date reached for term ${targetTerm.name}. Student added to official Registry.`,
    });

    await appendLifecycleEvent(db, {
      idempotencyKey: `census:${targetTerm.id}:${student.user_id}`,
      stage: STAGES.STUDENT_ACTIVE,
      status: 'completed',
      uid: student.uid,
      actorId,
      notes: `Officially enrolled in term ${targetTerm.name}`,
    });

    enrolledStudentIds.push(student.user_id);
    enrolledCount++;
  }

  return {
    termId: targetTerm.id,
    processedCount: studentsList.length,
    enrolledCount,
    skippedCount,
    enrolledStudentIds,
  };
}
