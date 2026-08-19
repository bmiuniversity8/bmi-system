import type { IDatabase } from '@bmi/ports';

export interface SeatReservationResult {
  status: 'reserved' | 'waitlisted' | 'already_enrolled' | 'failed';
  sectionId: string;
  courseId: string;
  waitlistPosition?: number;
  message: string;
}

/**
 * Atomically reserves a seat in a course section or falls back to waitlist.
 * Uses atomic DB updates (`UPDATE ... WHERE seats_taken < capacity`) to avoid race conditions.
 */
export async function reserveSectionSeat(
  db: IDatabase,
  params: {
    sectionId: string;
    studentId: string;
    termId?: string;
  }
): Promise<SeatReservationResult> {
  const now = new Date().toISOString();

  // 1. Fetch section details
  const section = await db.prepare(
    `SELECT cs.id, cs.course_id, cs.term_id, cs.capacity, cs.seats_taken, cs.is_active,
            c.code, c.title
     FROM course_sections cs
     JOIN courses c ON c.id = cs.course_id
     WHERE cs.id = ?`
  ).bind(params.sectionId).first<{
    id: string;
    course_id: string;
    term_id: string;
    capacity: number;
    seats_taken: number;
    is_active: number;
    code: string;
    title: string;
  }>();

  if (!section || section.is_active === 0) {
    return {
      status: 'failed',
      sectionId: params.sectionId,
      courseId: '',
      message: 'Course section is inactive or does not exist.',
    };
  }

  // 2. Check if student is already enrolled in this course for this term
  const existingReg = await db.prepare(
    `SELECT id FROM student_course_registrations
     WHERE student_id = ? AND course_id = ? AND term_id = ? AND status = 'registered' LIMIT 1`
  ).bind(params.studentId, section.course_id, section.term_id).first();

  if (existingReg) {
    return {
      status: 'already_enrolled',
      sectionId: params.sectionId,
      courseId: section.course_id,
      message: `You are already registered for ${section.code} - ${section.title}.`,
    };
  }

  // 3. Attempt Atomic Seat Reservation
  // Capacity check and increment within a single UPDATE query
  let seatClaimed = false;

  try {
    const updateResult = await db.prepare(
      `UPDATE course_sections
       SET seats_taken = seats_taken + 1, updated_at = ?
       WHERE id = ? AND seats_taken < capacity`
    ).bind(now, params.sectionId).run();

    // On D1 / SQLite, if changes > 0 then the seat was atomically acquired
    const changes = (updateResult as any)?.meta?.changes ?? (updateResult as any)?.changes ?? 1;
    seatClaimed = changes > 0;
  } catch {
    // If update failed due to capacity condition or concurrent lock
    seatClaimed = false;
  }

  if (seatClaimed) {
    // Successfully claimed seat: Record enrollment & registration
    const regId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.prepare(
        `INSERT INTO student_course_registrations (
           id, student_id, course_id, term_id, registration_type, status, section_id, registered_at
         ) VALUES (?, ?, ?, ?, 'standard', 'registered', ?, ?)
         ON CONFLICT(student_id, course_id, term_id) DO UPDATE SET
           status = 'registered', section_id = excluded.section_id, registered_at = excluded.registered_at`
      ).bind(regId, params.studentId, section.course_id, section.term_id, params.sectionId, now).run();

      await tx.prepare(
        `INSERT INTO enrollments (
           id, student_id, course_id, status, term_id, section_id, registration_date, enrolled_at
         ) VALUES (?, ?, ?, 'enrolled', ?, ?, ?, ?)
         ON CONFLICT(student_id, course_id) DO UPDATE SET
           status = 'enrolled', term_id = excluded.term_id, section_id = excluded.section_id`
      ).bind(enrollmentId, params.studentId, section.course_id, section.term_id, params.sectionId, now, now).run();

      // Remove from waitlist if previously waitlisted
      await tx.prepare(
        `DELETE FROM course_section_waitlists WHERE section_id = ? AND student_id = ?`
      ).bind(params.sectionId, params.studentId).run().catch(() => {});
    });

    return {
      status: 'reserved',
      sectionId: params.sectionId,
      courseId: section.course_id,
      message: `Seat successfully reserved in ${section.code} - ${section.title}.`,
    };
  }

  // 4. Section is Full — Fallback to Waitlist
  const waitlistCount = await db.prepare(
    `SELECT COUNT(*) as count FROM course_section_waitlists WHERE section_id = ?`
  ).bind(params.sectionId).first<{ count: number }>();

  const nextPosition = (waitlistCount?.count || 0) + 1;
  const waitlistId = crypto.randomUUID();

  await db.prepare(
    `INSERT INTO course_section_waitlists (id, section_id, student_id, position, added_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(section_id, student_id) DO UPDATE SET position = excluded.position`
  ).bind(waitlistId, params.sectionId, params.studentId, nextPosition, now).run().catch(() => {});

  return {
    status: 'waitlisted',
    sectionId: params.sectionId,
    courseId: section.course_id,
    waitlistPosition: nextPosition,
    message: `Section is full. You have been added to the waitlist at position #${nextPosition}.`,
  };
}

/**
 * Drops a student from a course section and automatically promotes the top waitlisted student if one exists.
 */
export async function dropSectionSeat(
  db: IDatabase,
  params: {
    sectionId?: string;
    courseId: string;
    studentId: string;
  }
): Promise<{ success: boolean; promotedStudentId: string | null; message: string }> {
  const now = new Date().toISOString();

  // 1. Mark registration and enrollment as dropped
  await db.transaction(async (tx) => {
    await tx.prepare(
      `UPDATE student_course_registrations SET status = 'dropped'
       WHERE student_id = ? AND course_id = ?`
    ).bind(params.studentId, params.courseId).run();

    await tx.prepare(
      `UPDATE enrollments SET status = 'dropped'
       WHERE student_id = ? AND course_id = ?`
    ).bind(params.studentId, params.courseId).run();

    if (params.sectionId) {
      await tx.prepare(
        `UPDATE course_sections SET seats_taken = MAX(0, seats_taken - 1), updated_at = ?
         WHERE id = ?`
      ).bind(now, params.sectionId).run();
    }
  });

  // 2. Check for waitlist promotion if sectionId is known
  let promotedStudentId: string | null = null;
  if (params.sectionId) {
    try {
      const topWaitlist = await db.prepare(
        `SELECT id, student_id FROM course_section_waitlists
         WHERE section_id = ? ORDER BY position ASC LIMIT 1`
      ).bind(params.sectionId).first<{ id: string; student_id: string }>();

      if (topWaitlist) {
        promotedStudentId = topWaitlist.student_id;
        // Promote waitlisted student to reserved seat
        await reserveSectionSeat(db, {
          sectionId: params.sectionId,
          studentId: topWaitlist.student_id,
        });
      }
    } catch (e) {
      console.warn('[seat-allocation] Error during waitlist promotion:', e);
    }
  }

  return {
    success: true,
    promotedStudentId,
    message: 'Course dropped successfully.',
  };
}
