import type { IDatabase } from '@bmi/ports';
import { getEnrollmentStatus, ENROLLMENT_STATUS } from './state-machine';

export interface BlockingHold {
  id: string;
  hold_type: string;
  reason: string;
  blocks: string;
  placed_by?: string | null;
  created_at: string;
}

export interface RegistrationEligibilityResult {
  eligible: boolean;
  status: string;
  reasons: string[];
  activeHolds: BlockingHold[];
  advisingReleased: boolean;
  catalogYearId: string | null;
  term: {
    id: string;
    name: string;
    academic_year: string;
    status: string;
  } | null;
}

/**
 * Evaluates whether a student is eligible to register for courses.
 * Enforces holds, advising releases, enrollment state machine, and term registration windows.
 */
export async function checkRegistrationEligibility(
  db: IDatabase,
  userId: string,
  targetTermId?: string
): Promise<RegistrationEligibilityResult> {
  const reasons: string[] = [];

  // 1. Check Canonical State Machine Status
  const enrollment = await getEnrollmentStatus(db, userId);
  const eligibleStatuses = [
    ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE,
    ENROLLMENT_STATUS.REGISTRATION_IN_PROGRESS,
    ENROLLMENT_STATUS.REGISTERED,
    ENROLLMENT_STATUS.OFFICIALLY_ENROLLED,
  ];

  if (!eligibleStatuses.includes(enrollment.status as any)) {
    reasons.push(`Current enrollment status is ${enrollment.status}. Registration requires REGISTRATION_ELIGIBLE status.`);
  }

  // 2. Query Student Profile & Locked Catalog Year
  const student = await db.prepare(
    `SELECT s.user_id, s.catalog_year_id, s.official_student_id, s.status
     FROM students s WHERE s.user_id = ?`
  ).bind(userId).first<{
    user_id: string;
    catalog_year_id: string | null;
    official_student_id: string | null;
    status: string;
  }>();

  if (!student) {
    reasons.push('Student record has not yet been provisioned. Please complete offer acceptance.');
  }

  // 3. Query Active Blocking Holds
  let activeHolds: BlockingHold[] = [];
  try {
    const holdsQuery = await db.prepare(
      `SELECT id, hold_type, reason, blocks, placed_by, created_at
       FROM student_holds
       WHERE student_id = ? AND is_active = 1`
    ).bind(userId).all<BlockingHold>();

    activeHolds = (holdsQuery?.results || []).filter(h => {
      const blocks = (h.blocks || 'registration').toLowerCase();
      return blocks.includes('registration') || blocks.includes('all');
    });

    if (activeHolds.length > 0) {
      activeHolds.forEach(h => {
        reasons.push(`Active Hold: ${h.hold_type.toUpperCase()} — ${h.reason}`);
      });
    }
  } catch (e) {
    console.warn('[eligibility] Error querying holds:', e);
  }

  // 4. Determine Active Term
  let term: { id: string; name: string; academic_year: string; status: string } | null = null;
  try {
    if (targetTermId) {
      term = await db.prepare(
        `SELECT id, name, academic_year, status FROM academic_terms WHERE id = ? LIMIT 1`
      ).bind(targetTermId).first<{ id: string; name: string; academic_year: string; status: string }>();
    } else {
      term = await db.prepare(
        `SELECT id, name, academic_year, status FROM academic_terms WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`
      ).first<{ id: string; name: string; academic_year: string; status: string }>();
    }
  } catch (e) {
    console.warn('[eligibility] Error querying term:', e);
  }

  // 5. Query Advising Release
  let advisingReleased = true;
  if (term?.id) {
    try {
      const release = await db.prepare(
        `SELECT 1 FROM advising_releases WHERE student_id = ? AND term_id = ? LIMIT 1`
      ).bind(userId, term.id).first();

      const hasAdvisingHold = activeHolds.some(h => h.hold_type === 'advising');
      if (hasAdvisingHold && !release) {
        advisingReleased = false;
        reasons.push('Academic advising release required for this term. Please meet with your advisor.');
      }
    } catch (e) {
      console.warn('[eligibility] Error querying advising releases:', e);
    }
  }

  return {
    eligible: reasons.length === 0,
    status: enrollment.status,
    reasons,
    activeHolds,
    advisingReleased,
    catalogYearId: student?.catalog_year_id || null,
    term,
  };
}
