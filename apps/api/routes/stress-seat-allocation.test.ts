/**
 * Concurrent Seat Allocation Stress Test
 * ─────────────────────────────────────────
 * Simulates N parallel registration requests against a 1-seat course section.
 * Validates: exactly 1 succeeds with 'reserved', the rest get 'waitlisted'.
 *
 * Usage:
 *   pnpm --filter @bmi/api test -- --testPathPattern stress-seat-allocation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reserveSectionSeat, dropSectionSeat } from '../lib/seat-allocation-service';

// ─── In-memory section state ───
let sectionState = {
  id: 'section-stress-1',
  course_id: 'THEO-101',
  term_id: 'fall-2026',
  capacity: 1,
  seats_taken: 0,
  is_active: 1,
  code: 'THEO-101-A',
  title: 'Introduction to Theology',
};

// ─── In-memory tables ───
let registrations: Map<string, { student_id: string; course_id: string; status: string; section_id: string }>;
let enrollments: Map<string, { student_id: string; course_id: string; status: string }>;
let waitlist: Map<string, { id: string; student_id: string; position: number }>;

function resetState(capacity = 1) {
  sectionState = { ...sectionState, seats_taken: 0, capacity };
  registrations = new Map();
  enrollments = new Map();
  waitlist = new Map();
}

/**
 * Creates a mock IDatabase that faithfully simulates atomic seat allocation
 * using in-memory state. The critical path — `UPDATE course_sections SET seats_taken = seats_taken + 1
 * WHERE id = ? AND seats_taken < capacity` — uses a synchronous compare-and-swap
 * to simulate row-level locking.
 */
function createMockDb() {
  const db: any = {
    prepare: vi.fn((sql: string) => {
      const stmt: any = {
        bind: vi.fn((..._args: any[]) => {
          stmt._args = _args;
          return stmt;
        }),
        _args: [] as any[],
        first: vi.fn(async () => {
          // Section lookup
          if (sql.includes('FROM course_sections') && sql.includes('JOIN courses')) {
            return sectionState.is_active ? { ...sectionState } : null;
          }
          // Student already enrolled check
          if (sql.includes('student_course_registrations') && sql.includes('LIMIT 1')) {
            const studentId = stmt._args[0];
            const courseId = stmt._args[1];
            for (const [, r] of registrations) {
              if (r.student_id === studentId && r.course_id === courseId && r.status === 'registered') {
                return { id: 'exists' };
              }
            }
            return null;
          }
          // Waitlist count
          if (sql.includes('COUNT(*)') && sql.includes('course_section_waitlists')) {
            return { count: waitlist.size };
          }
          // Top waitlisted student
          if (sql.includes('course_section_waitlists') && sql.includes('ORDER BY position ASC LIMIT 1')) {
            let top: { id: string; student_id: string; position: number } | null = null;
            for (const [, w] of waitlist) {
              if (!top || w.position < top.position) top = w;
            }
            return top;
          }
          return null;
        }),
        run: vi.fn(async () => {
          // ─── ATOMIC SEAT INCREMENT (compare-and-swap) ───
          if (sql.includes('UPDATE course_sections') && sql.includes('seats_taken = seats_taken + 1') && sql.includes('seats_taken < capacity')) {
            // This is the critical atomicity test:
            // Only one concurrent caller should win this CAS.
            if (sectionState.seats_taken < sectionState.capacity) {
              sectionState.seats_taken += 1;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }

          // Seat decrement on drop
          if (sql.includes('UPDATE course_sections') && sql.includes('seats_taken - 1')) {
            sectionState.seats_taken = Math.max(0, sectionState.seats_taken - 1);
            return { success: true };
          }

          // Registration insert/upsert
          if (sql.includes('INSERT INTO student_course_registrations')) {
            const regId = stmt._args[0];
            const studentId = stmt._args[1];
            const courseId = stmt._args[2];
            const sectionId = stmt._args[4] || stmt._args[3];
            registrations.set(regId, { student_id: studentId, course_id: courseId, status: 'registered', section_id: sectionId });
            return { success: true };
          }

          // Registration drop
          if (sql.includes('UPDATE student_course_registrations') && sql.includes("status = 'dropped'")) {
            for (const [k, r] of registrations) {
              if (r.student_id === stmt._args[0] && r.course_id === stmt._args[1]) {
                r.status = 'dropped';
              }
            }
            return { success: true };
          }

          // Enrollment insert/upsert
          if (sql.includes('INSERT INTO enrollments')) {
            const enrollId = stmt._args[0];
            enrollments.set(enrollId, { student_id: stmt._args[1], course_id: stmt._args[2], status: 'enrolled' });
            return { success: true };
          }

          // Enrollment drop
          if (sql.includes('UPDATE enrollments') && sql.includes("status = 'dropped'")) {
            for (const [, e] of enrollments) {
              if (e.student_id === stmt._args[0] && e.course_id === stmt._args[1]) {
                e.status = 'dropped';
              }
            }
            return { success: true };
          }

          // Waitlist insert
          if (sql.includes('INSERT INTO course_section_waitlists')) {
            const wlId = stmt._args[0];
            waitlist.set(wlId, { id: wlId, student_id: stmt._args[2], position: stmt._args[3] });
            return { success: true };
          }

          // Waitlist delete (promotion)
          if (sql.includes('DELETE FROM course_section_waitlists')) {
            for (const [k, w] of waitlist) {
              if (w.student_id === stmt._args[1]) {
                waitlist.delete(k);
              }
            }
            return { success: true };
          }

          return { success: true };
        }),
        all: vi.fn(async () => ({ results: [] })),
      };
      return stmt;
    }),
    transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
      // Execute the transaction body using the same db mock as "tx"
      await fn(db);
    }),
  };
  return db;
}

describe('Concurrent Seat Allocation Stress Tests', () => {
  let mockDb: any;

  beforeEach(() => {
    resetState(1);
    mockDb = createMockDb();
  });

  it('exactly 1 of N concurrent requests wins the last seat; the rest are waitlisted', async () => {
    const CONCURRENCY = 10;
    const studentIds = Array.from({ length: CONCURRENCY }, (_, i) => `student-${i}`);

    // Fire all N requests concurrently
    const results = await Promise.all(
      studentIds.map(sid =>
        reserveSectionSeat(mockDb, {
          sectionId: 'section-stress-1',
          studentId: sid,
        })
      )
    );

    const reserved = results.filter(r => r.status === 'reserved');
    const waitlisted = results.filter(r => r.status === 'waitlisted');

    // Exactly 1 should win the seat
    expect(reserved.length).toBe(1);
    // Remaining N-1 should be waitlisted
    expect(waitlisted.length).toBe(CONCURRENCY - 1);
    // Section should be at capacity
    expect(sectionState.seats_taken).toBe(1);
  });

  it('no duplicate registrations: re-registering same student returns already_enrolled', async () => {
    // First attempt: succeeds
    const r1 = await reserveSectionSeat(mockDb, {
      sectionId: 'section-stress-1',
      studentId: 'student-dup',
    });
    expect(r1.status).toBe('reserved');

    // Second attempt: same student, same course → already_enrolled
    const r2 = await reserveSectionSeat(mockDb, {
      sectionId: 'section-stress-1',
      studentId: 'student-dup',
    });
    expect(r2.status).toBe('already_enrolled');
  });

  it('drop promotes the top waitlisted student automatically', async () => {
    // Fill the 1-seat section
    const r1 = await reserveSectionSeat(mockDb, {
      sectionId: 'section-stress-1',
      studentId: 'winner',
    });
    expect(r1.status).toBe('reserved');

    // Waitlist a second student
    const r2 = await reserveSectionSeat(mockDb, {
      sectionId: 'section-stress-1',
      studentId: 'waiter-1',
    });
    expect(r2.status).toBe('waitlisted');
    expect(r2.waitlistPosition).toBe(1);

    // Drop the winner
    const dropResult = await dropSectionSeat(mockDb, {
      sectionId: 'section-stress-1',
      courseId: 'THEO-101',
      studentId: 'winner',
    });

    expect(dropResult.success).toBe(true);
    expect(dropResult.promotedStudentId).toBe('waiter-1');
  });

  it('handles high-volume (50 students) with exactly 5 seats', async () => {
    resetState(5);
    mockDb = createMockDb();

    const STUDENTS = 50;
    const studentIds = Array.from({ length: STUDENTS }, (_, i) => `bulk-student-${i}`);

    const results = await Promise.all(
      studentIds.map(sid =>
        reserveSectionSeat(mockDb, {
          sectionId: 'section-stress-1',
          studentId: sid,
        })
      )
    );

    const reserved = results.filter(r => r.status === 'reserved');
    const waitlisted = results.filter(r => r.status === 'waitlisted');

    expect(reserved.length).toBe(5);
    expect(waitlisted.length).toBe(STUDENTS - 5);
    expect(sectionState.seats_taken).toBe(5);
  });

  it('inactive section rejects all requests gracefully', async () => {
    sectionState.is_active = 0;
    mockDb = createMockDb();

    const result = await reserveSectionSeat(mockDb, {
      sectionId: 'section-stress-1',
      studentId: 'student-inactive',
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('inactive');
  });
});
