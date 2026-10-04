import type { IDatabase } from '@bmi/ports';

/**
 * Canonical writer for `student_course_registrations.status = 'completed'`.
 *
 * Gap 1 fix: the prerequisite validator (`registration-validation.ts`) and
 * `routes/enrollment.ts` both read `status = 'completed'` as the record of a
 * passed course, but nothing ever wrote it — so every course with a
 * prerequisite was blocked (HTTP 422) for every student.
 *
 * Passing rule: percentage >= 40 (letter D or better; F < 40 fails).
 * Mirrors `packages/shared/src/grading.ts` thresholds.
 */
export const PASS_THRESHOLD_PERCENT = 40;

export function gradeToPassed(score: number | null, maxScore: number | null): boolean | null {
  if (score == null || maxScore == null || !(maxScore > 0)) return null;
  return (score / maxScore) * 100 >= PASS_THRESHOLD_PERCENT;
}

export interface CompletionResult {
  studentId: string;
  courseId: string;
  termId: string;
  status: 'completed' | 'failed';
}

/**
 * Mark a single registration as completed/failed. Only transitions from
 * `registered` (or re-marks an existing terminal state idempotently).
 * Throws if the row does not exist or is in a non-finalizable state
 * (e.g. dropped/waitlisted).
 */
export async function markCourseCompletion(
  db: IDatabase,
  params: {
    studentId: string;
    courseId: string;
    termId: string;
    passed: boolean;
    actorId?: string;
  }
): Promise<CompletionResult> {
  const row = await db
    .prepare(
      `SELECT id, status FROM student_course_registrations
       WHERE student_id = ? AND course_id = ? AND term_id = ? LIMIT 1`
    )
    .bind(params.studentId, params.courseId, params.termId)
    .first<{ id: string; status: string }>()
    .catch(() => null);
  if (!row) throw new Error('Registration not found for student/course/term');
  if (row.status === 'dropped' || row.status === 'waitlisted') {
    throw new Error(`Cannot complete registration in status "${row.status}"`);
  }
  const target = params.passed ? 'completed' : 'failed';
  if (row.status === target) {
    return { studentId: params.studentId, courseId: params.courseId, termId: params.termId, status: target };
  }
  const now = new Date().toISOString();
  // completed_at column exists post-0049; fall back gracefully pre-migration.
  try {
    await db
      .prepare(
        `UPDATE student_course_registrations SET status = ?, completed_at = ? WHERE id = ?`
      )
      .bind(target, now, row.id)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such column|undefined column/i.test(msg)) {
      await db
        .prepare(`UPDATE student_course_registrations SET status = ? WHERE id = ?`)
        .bind(target, row.id)
        .run();
    } else {
      throw e;
    }
  }
  return { studentId: params.studentId, courseId: params.courseId, termId: params.termId, status: target };
}

export interface TermFinalizeResult {
  termId: string;
  processed: number;
  completed: number;
  failed: number;
  skippedNoGrades: number;
}

/**
 * Bulk finalize a term: every `registered` row is evaluated against the
 * average of its linked `grades` (via `enrollments` → `grades.enrollment_id`).
 * - avg >= 40 → `completed`
 * - avg < 40  → `failed`
 * - no grades → left as `registered` (counted as skippedNoGrades)
 *
 * Dropped/waitlisted/completed/failed rows are untouched (idempotent reruns).
 */
export async function finalizeTermCompletions(
  db: IDatabase,
  termId: string,
  _actorId = 'system_term_close'
): Promise<TermFinalizeResult> {
  const regs = await db
    .prepare(
      `SELECT student_id, course_id FROM student_course_registrations
       WHERE term_id = ? AND status = 'registered'`
    )
    .bind(termId)
    .all<{ student_id: string; course_id: string }>()
    .catch(() => null);
  const rows = regs?.results || [];
  let completed = 0;
  let failed = 0;
  let skippedNoGrades = 0;

  for (const r of rows) {
    // grades → enrollments → student+course. Average across all assessments.
    const avg = await db
      .prepare(
        `SELECT AVG(CASE WHEN g.max_score > 0 THEN (g.score * 100.0 / g.max_score) ELSE NULL END) AS avg_pct
         FROM grades g
         JOIN enrollments e ON e.id = g.enrollment_id
         WHERE e.student_id = ? AND e.course_id = ?`
      )
      .bind(r.student_id, r.course_id)
      .first<{ avg_pct: number | null }>()
      .catch(() => null);
    const pct = avg?.avg_pct == null ? null : Number(avg.avg_pct);
    if (pct == null || !Number.isFinite(pct)) {
      skippedNoGrades++;
      continue;
    }
    const res = await markCourseCompletion(db, {
      studentId: r.student_id,
      courseId: r.course_id,
      termId,
      passed: pct >= PASS_THRESHOLD_PERCENT,
    });
    if (res.status === 'completed') completed++;
    else failed++;
  }

  return { termId, processed: rows.length, completed, failed, skippedNoGrades };
}
