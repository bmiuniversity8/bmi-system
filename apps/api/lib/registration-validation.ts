import type { IDatabase } from '@bmi/ports';

export interface ScheduleSlot {
  day: string; // e.g., 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
  start: string; // '09:00'
  end: string;   // '10:30'
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  totalCredits: number;
  unmetPrerequisites: Array<{ courseCode: string; requiredPrereqs: string[] }>;
  conflicts: Array<{ courseA: string; courseB: string; day: string; time: string }>;
  creditLimit: number;
}

function timeToMinutes(t: string): number {
  const parts = String(t || '').split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return NaN;
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function hasOverlap(slotA: ScheduleSlot, slotB: ScheduleSlot): boolean {
  if (!slotA || !slotB || !slotA.day || !slotB.day) return false;
  if (String(slotA.day).toLowerCase() !== String(slotB.day).toLowerCase()) return false;
  const startA = timeToMinutes(slotA.start);
  const endA = timeToMinutes(slotA.end);
  const startB = timeToMinutes(slotB.start);
  const endB = timeToMinutes(slotB.end);
  if (!Number.isFinite(startA) || !Number.isFinite(endA) || !Number.isFinite(startB) || !Number.isFinite(endB)) return false;
  return startA < endB && startB < endA;
}

async function getCreditLimit(db: IDatabase): Promise<number> {
  try {
    const row = await db.prepare(
      `SELECT value FROM app_config WHERE key = 'max_credits_per_term' LIMIT 1`
    ).bind().first<{ value: string }>().catch(() => null);
    const n = Number(row?.value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  } catch {
    // fall through to default
  }
  return 18;
}

/**
 * Source of truth for "passed": `student_course_registrations.status = 'completed'`.
 * (`enrollments.status` is limited to enrolled/dropped/waitlisted and never
 * holds completed/passed, and `grades` has no student/course columns — so both
 * are unsuitable. Completed registrations are the canonical pass record.)
 *
 * Timetable source: `course_sections.schedule` is authoritative for student
 * clash detection. It stores a JSON array like
 *   [{"day":"Mon","start":"09:00","end":"10:00"}].
 * The `timetabling` table tracks room/instructor scheduling and is not
 * consulted here. Schedule JSON is parsed defensively; invalid entries are
 * skipped.
 */
export async function getPassedCourseIds(db: IDatabase, userId: string): Promise<Set<string>> {
  const q = await db.prepare(
    `SELECT course_id FROM student_course_registrations WHERE student_id = ? AND status = 'completed'`
  ).bind(userId).all<{ course_id: string }>().catch(() => null);
  return new Set((q?.results || []).map(r => r.course_id));
}

/**
 * Validates course selections for prerequisites, timetable collisions, credit ceilings,
 * and passed course duplication.
 */
export async function validateCourseRegistration(
  db: IDatabase,
  userId: string,
  courseIds: string[],
  sectionIds: string[] = []
): Promise<ValidationResult> {
  const errors: string[] = [];
  const unmetPrerequisites: Array<{ courseCode: string; requiredPrereqs: string[] }> = [];
  const conflicts: Array<{ courseA: string; courseB: string; day: string; time: string }> = [];
  const creditLimit = await getCreditLimit(db);

  if (!courseIds || courseIds.length === 0) {
    return {
      valid: false,
      errors: ['No courses selected for registration.'],
      totalCredits: 0,
      unmetPrerequisites: [],
      conflicts: [],
      creditLimit,
    };
  }

  // 1. Fetch Selected Course Details & Calculate Credits
  const placeholders = courseIds.map(() => '?').join(',');
  const coursesQuery = await db.prepare(
    `SELECT id, code, title, credits FROM courses WHERE id IN (${placeholders})`
  ).bind(...courseIds).all<{ id: string; code: string; title: string; credits: number }>();

  const courses = coursesQuery?.results || [];
  const courseMap = new Map(courses.map(c => [c.id, c]));
  const totalCredits = courses.reduce((sum, c) => sum + (c.credits || 0), 0);

  if (totalCredits > creditLimit) {
    errors.push(
      `Credit overload: Selected load of ${totalCredits} credits exceeds the maximum limit of ${creditLimit} credits per term.`
    );
  }

  // 2. Check if already passed (canonical: completed registrations).
  const studentPassedSet = await getPassedCourseIds(db, userId);

  for (const cid of courseIds) {
    if (studentPassedSet.has(cid)) {
      const c = courseMap.get(cid);
      errors.push(`Course ${c?.code || cid} has already been completed and passed.`);
    }
  }

  // 3. Prerequisite Check
  const programCoursesQuery = await db.prepare(
    `SELECT pc.course_id, pc.prerequisite_ids, c.code
     FROM program_courses pc
     JOIN courses c ON c.id = pc.course_id
     WHERE pc.course_id IN (${placeholders})`
  ).bind(...courseIds).all<{ course_id: string; prerequisite_ids: string | null; code: string }>();

  for (const pc of programCoursesQuery?.results || []) {
    if (pc.prerequisite_ids) {
      let reqIds: string[] = [];
      try {
        const parsed: unknown = JSON.parse(pc.prerequisite_ids);
        if (Array.isArray(parsed)) reqIds = parsed.map(String);
        else if (typeof parsed === 'string' && parsed) reqIds = [parsed];
        else reqIds = pc.prerequisite_ids.split(',').map(s => s.trim()).filter(Boolean);
      } catch {
        reqIds = pc.prerequisite_ids.split(',').map(s => s.trim()).filter(Boolean);
      }

      const unmet = reqIds.filter(id => !studentPassedSet.has(id));
      if (unmet.length > 0) {
        unmetPrerequisites.push({ courseCode: pc.code, requiredPrereqs: unmet });
        errors.push(
          `Prerequisite requirement not satisfied for ${pc.code}. Required prerequisite(s): ${unmet.join(', ')}.`
        );
      }
    }
  }

  // 4. Timetable / Schedule Clash Check (authoritative: course_sections.schedule).
  const sectionPlaceholders = sectionIds.length > 0 ? sectionIds.map(() => '?').join(',') : null;
  let sections: Array<{ id: string; course_id: string; section_code: string; schedule: string | null }> = [];

  if (sectionPlaceholders) {
    const sQuery = await db.prepare(
      `SELECT cs.id, cs.course_id, cs.section_code, cs.schedule
       FROM course_sections cs
       WHERE cs.id IN (${sectionPlaceholders})`
    ).bind(...sectionIds).all<{ id: string; course_id: string; section_code: string; schedule: string | null }>();
    sections = sQuery?.results || [];
  } else {
    const sQuery = await db.prepare(
      `SELECT cs.id, cs.course_id, cs.section_code, cs.schedule
       FROM course_sections cs
       WHERE cs.course_id IN (${placeholders}) AND cs.is_active = 1`
    ).bind(...courseIds).all<{ id: string; course_id: string; section_code: string; schedule: string | null }>();
    sections = sQuery?.results || [];
  }

  const parsedSchedules: Array<{ courseCode: string; sectionCode: string; slots: ScheduleSlot[] }> = [];

  for (const s of sections) {
    if (!s.schedule) continue;
    try {
      const slots: unknown = JSON.parse(s.schedule);
      if (Array.isArray(slots)) {
        const valid = (slots as any[]).filter(
          (sl) => sl && typeof sl.day === 'string' && typeof sl.start === 'string' && typeof sl.end === 'string'
        ) as ScheduleSlot[];
        if (valid.length > 0) {
          const c = courseMap.get(s.course_id);
          parsedSchedules.push({
            courseCode: c?.code || s.course_id,
            sectionCode: s.section_code,
            slots: valid,
          });
        }
      }
    } catch {
      // Ignore invalid JSON in schedule
    }
  }

  for (let i = 0; i < parsedSchedules.length; i++) {
    for (let j = i + 1; j < parsedSchedules.length; j++) {
      const a = parsedSchedules[i];
      const b = parsedSchedules[j];
      if (a.courseCode === b.courseCode) continue;

      for (const slotA of a.slots) {
        for (const slotB of b.slots) {
          if (hasOverlap(slotA, slotB)) {
            conflicts.push({
              courseA: `${a.courseCode} (${a.sectionCode})`,
              courseB: `${b.courseCode} (${b.sectionCode})`,
              day: slotA.day,
              time: `${slotA.start}-${slotA.end}`,
            });
            errors.push(
              `Timetable conflict: ${a.courseCode} (${a.sectionCode}) and ${b.courseCode} (${b.sectionCode}) overlap on ${slotA.day} at ${slotA.start}-${slotA.end}.`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    totalCredits,
    unmetPrerequisites,
    conflicts,
    creditLimit,
  };
}
