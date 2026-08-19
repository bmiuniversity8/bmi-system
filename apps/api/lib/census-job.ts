import type { IDatabase } from '@bmi/ports';
import { setEnrollmentStatus, ENROLLMENT_STATUS } from './state-machine';
import { appendLifecycleEvent, STAGES } from './lifecycle';

export interface CensusRunResult {
  termId: string;
  processedCount: number;
  enrolledCount: number;
  skippedCount: number;
  enrolledStudentIds: string[];
}

/**
 * Runs the term census job to officially enroll students who completed course registration
 * without active blocking holds.
 */
export async function runTermCensusJob(
  db: IDatabase,
  termId?: string,
  actorId = 'census_job'
): Promise<CensusRunResult> {
  // Find target term
  let targetTerm: { id: string; name: string } | null = null;
  if (termId) {
    targetTerm = await db.prepare(
      `SELECT id, name FROM academic_terms WHERE id = ? LIMIT 1`
    ).bind(termId).first<{ id: string; name: string }>();
  } else {
    targetTerm = await db.prepare(
      `SELECT id, name FROM academic_terms WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`
    ).first<{ id: string; name: string }>();
  }

  if (!targetTerm) {
    throw new Error('No active term found for census run');
  }

  // Find all students with registered enrollments in this term
  const registeredStudents = await db.prepare(
    `SELECT DISTINCT s.user_id, s.uid, s.reg_no
     FROM students s
     JOIN enrollments e ON e.student_id = s.user_id
     WHERE e.status = 'enrolled' AND (e.term_id = ? OR e.term_id IS NULL)`
  ).bind(targetTerm.id).all<{ user_id: string; uid: string; reg_no: string }>();

  const studentsList = registeredStudents?.results || [];
  let enrolledCount = 0;
  let skippedCount = 0;
  const enrolledStudentIds: string[] = [];

  for (const student of studentsList) {
    // Check for blocking holds
    const blockingHold = await db.prepare(
      `SELECT id FROM student_holds
       WHERE student_id = ? AND is_active = 1 AND (blocks LIKE '%registration%' OR blocks LIKE '%all%')
       LIMIT 1`
    ).bind(student.user_id).first();

    if (blockingHold) {
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
