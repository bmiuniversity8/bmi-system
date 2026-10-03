import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/email', () => ({
  safeDispatchEmail: vi.fn().mockResolvedValue(undefined),
  buildEmailLayout: vi.fn().mockReturnValue('<html></html>'),
  isValidEmail: (e: string) => /.+@.+\..+/.test(e),
}));

import { validateCourseRegistration } from '../lib/registration-validation';
import { checkRegistrationEligibility } from '../lib/eligibility-service';
import { handleFinalizeRegistration, handleRunCensusJob } from './registration';
import { runTermCensusJob } from '../lib/census-job';
import { ENROLLMENT_STATUS } from '../lib/state-machine';

function stmt(firstVal: unknown = null, allVal: unknown[] = []) {
  return {
    bind: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue(firstVal),
      all: vi.fn().mockResolvedValue({ results: allVal }),
      run: vi.fn().mockResolvedValue({ success: true }),
    }),
    first: vi.fn().mockResolvedValue(firstVal),
    all: vi.fn().mockResolvedValue({ results: allVal }),
    run: vi.fn().mockResolvedValue({ success: true }),
  };
}

function makeDb(impl: (sql: string) => any) {
  const db: any = {
    prepare: vi.fn().mockImplementation(impl),
    transaction: vi.fn().mockImplementation(async (cb: any) => {
      const tx: any = { prepare: vi.fn().mockImplementation(impl) };
      return cb(tx);
    }),
  };
  return db;
}

beforeEach(() => vi.clearAllMocks());

describe('Task 06: registration validation', () => {
  const ALL_SECTIONS = [
    { id: 's-1', course_id: 'c-1', section_code: 'A', schedule: JSON.stringify([{ day: 'Mon', start: '09:00', end: '10:00' }]) },
    { id: 's-2', course_id: 'c-2', section_code: 'B', schedule: JSON.stringify([{ day: 'Mon', start: '09:30', end: '10:30' }]) },
  ];
  function validationDb() {
    return makeDb((sql: string) => {
      if (sql.includes('FROM app_config')) return stmt({ value: '18' });
      if (sql.includes('FROM courses WHERE id')) {
        return stmt(null, [
          { id: 'c-1', code: 'C101', title: 'T1', credits: 3 },
          { id: 'c-2', code: 'C102', title: 'T2', credits: 3 },
        ]);
      }
      if (sql.includes('FROM student_course_registrations WHERE student_id') && sql.includes("status = 'completed'")) {
        return stmt(null, [{ course_id: 'c-0' }]);
      }
      if (sql.includes('FROM program_courses')) {
        return stmt(null, [
          { course_id: 'c-2', prerequisite_ids: JSON.stringify(['c-0']), code: 'C102' },
          { course_id: 'c-1', prerequisite_ids: null, code: 'C101' },
        ]);
      }
      if (sql.includes('FROM course_sections')) {
        // Respect the IN (...) filter: only return sections actually requested.
        return {
          bind: vi.fn().mockImplementation((...ids: unknown[]) => ({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({
              results: ids.length > 0 ? ALL_SECTIONS.filter((s) => ids.includes(s.id)) : ALL_SECTIONS,
            }),
            run: vi.fn().mockResolvedValue({}),
          })),
        };
      }
      return stmt();
    });
  }

  it('prerequisite met passes; unmet fails', async () => {
    const db = validationDb();
    const okRes = await validateCourseRegistration(db, 'u-1', ['c-1'], ['s-1']);
    expect(okRes.valid).toBe(true);
  });

  it('credit overload fails', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM app_config')) return stmt({ value: '3' });
      if (sql.includes('FROM courses WHERE id')) {
        return stmt(null, [
          { id: 'c-1', code: 'C101', title: 'T', credits: 3 },
          { id: 'c-2', code: 'C102', title: 'T', credits: 3 },
        ]);
      }
      if (sql.includes("status = 'completed'")) return stmt(null, []);
      if (sql.includes('FROM program_courses')) return stmt(null, []);
      if (sql.includes('FROM course_sections')) return stmt(null, []);
      return stmt();
    });
    const res = await validateCourseRegistration(db, 'u-1', ['c-1', 'c-2'], []);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/Credit overload/i);
  });

  it('timetable clash fails', async () => {
    const db = validationDb();
    const res = await validateCourseRegistration(db, 'u-1', ['c-1', 'c-2'], ['s-1', 's-2']);
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/Timetable conflict/i);
  });

  it('outside the registration window blocks eligibility', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE });
      if (sql.includes('FROM students s WHERE')) return stmt({ user_id: 'u-1', catalog_year_id: null, official_student_id: null, status: 'Active' });
      if (sql.includes('FROM student_holds')) return stmt(null, []);
      if (sql.includes('FROM academic_terms')) {
        return stmt({ id: 't-1', name: 'Term', academic_year: '2026', status: 'registration', registration_opens_at: new Date(Date.now() + 86400000).toISOString(), registration_closes_at: new Date(Date.now() + 2 * 86400000).toISOString() });
      }
      if (sql.includes('FROM advising_releases')) return stmt(null);
      return stmt();
    });
    const res = await checkRegistrationEligibility(db, 'u-1');
    expect(res.eligible).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/not opened/i);
  });
});

describe('Task 07: finalize', () => {
  function finalizeDb(opts?: { invoiceTerm?: string | null; sigHash?: string | null }) {
    return makeDb((sql: string) => {
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE, changed_at: new Date().toISOString(), reason: null });
      if (sql.includes('FROM students s WHERE')) return stmt({ user_id: 'u-1', catalog_year_id: 'C', official_student_id: 'X', status: 'Active' });
      if (sql.includes('FROM student_holds')) return stmt(null, []);
      if (sql.includes('FROM academic_terms')) {
        return stmt({ id: 't-1', name: 'T', academic_year: '2026', status: 'registration', registration_opens_at: null, registration_closes_at: null });
      }
      if (sql.includes('FROM advising_releases')) return stmt(null);
      if (sql.includes('FROM student_course_registrations')) return stmt(null, [{ id: 'scr-1', status: 'registered' }]);
      if (sql.includes('FROM invoices')) {
        if (opts?.invoiceTerm === 'NULL') return stmt({ id: 'inv-legacy' });
        if (sql.includes('term_id = ?')) return stmt(opts?.invoiceTerm === 't-1' ? { id: 'inv-1' } : null);
        return stmt(null);
      }
      if (sql.includes('FROM financial_aid_awards')) return stmt(null);
      if (sql.includes('FROM esignatures')) {
        // finalize queries with term_id + version; return a row only when the test opts in.
        if (opts?.sigHash === 'current') return stmt({ id: 'sig-1' });
        return stmt(null);
      }
      if (sql.includes('INSERT INTO enrollment_status_logs')) return stmt();
      return stmt();
    });
  }

  it('402 without a paid current-term invoice (NULL term_id does not satisfy)', async () => {
    const db = finalizeDb({ invoiceTerm: 'NULL', sigHash: 'current' });
    // Legacy paid invoice with NULL term_id exists, but term-scoped check fails.
    const db2 = makeDb((sql: string) => {
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE, changed_at: new Date().toISOString(), reason: null });
      if (sql.includes('FROM students s WHERE')) return stmt({ user_id: 'u-1', catalog_year_id: 'C', official_student_id: 'X', status: 'Active' });
      if (sql.includes('FROM student_holds')) return stmt(null, []);
      if (sql.includes('FROM academic_terms')) return stmt({ id: 't-1', name: 'T', academic_year: '2026', status: 'registration' });
      if (sql.includes('FROM advising_releases')) return stmt(null);
      if (sql.includes('FROM student_course_registrations')) return stmt(null, [{ id: 'scr-1', status: 'registered' }]);
      if (sql.includes('FROM invoices') && sql.includes('term_id = ?')) return stmt(null);
      if (sql.includes('FROM financial_aid_awards')) return stmt(null);
      if (sql.includes('FROM invoices') && sql.includes('term_id IS NULL')) return stmt({ id: 'inv-legacy' });
      if (sql.includes('FROM esignatures')) return stmt({ id: 'sig-1' });
      return stmt();
    });
    const env: any = { PLATFORM_CONTEXT: { db: db2 } };
    void db;
    const res = await handleFinalizeRegistration(new Request('http://x/api/registration/finalize', { method: 'POST' }), env, 'u-1');
    expect(res.status).toBe(402);
    expect(await res.text()).toMatch(/NULL term_id/i);
  });

  it('second call returns 409', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.REGISTERED, changed_at: new Date().toISOString(), reason: null });
      return stmt();
    });
    const env: any = { PLATFORM_CONTEXT: { db } };
    const res = await handleFinalizeRegistration(new Request('http://x/api/registration/finalize', { method: 'POST' }), env, 'u-1');
    expect(res.status).toBe(409);
  });

  it('no enrollments row is written with a registration id as course_id', async () => {
    const enlistedSql: string[] = [];
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE, changed_at: new Date().toISOString(), reason: null });
      if (sql.includes('FROM students s WHERE')) return stmt({ user_id: 'u-1', catalog_year_id: 'C', official_student_id: 'X', status: 'Active' });
      if (sql.includes('FROM student_holds')) return stmt(null, []);
      if (sql.includes('FROM academic_terms')) return stmt({ id: 't-1', name: 'T', academic_year: '2026', status: 'registration' });
      if (sql.includes('FROM advising_releases')) return stmt(null);
      if (sql.includes('FROM student_course_registrations')) return stmt(null, [{ id: 'scr-1', status: 'registered' }]);
      if (sql.includes('FROM invoices')) return stmt({ id: 'inv-1' });
      if (sql.includes('FROM financial_aid_awards')) return stmt(null);
      if (sql.includes('FROM esignatures')) return stmt({ id: 'sig-1' });
      if (sql.includes('INSERT INTO enrollments')) enlistedSql.push(sql);
      if (sql.includes('INSERT INTO enrollment_status_logs')) return stmt();
      return stmt();
    });
    const env: any = { PLATFORM_CONTEXT: { db } };
    await handleFinalizeRegistration(new Request('http://x/api/registration/finalize', { method: 'POST' }), env, 'u-1');
    expect(enlistedSql).toHaveLength(0);
  });
});

describe('Task 08: census date', () => {
  it('before the census date nothing changes', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM academic_terms')) {
        return stmt({ id: 't-1', name: 'T', census_date: new Date(Date.now() + 86400000).toISOString() });
      }
      return stmt();
    });
    const res = await runTermCensusJob(db, 't-1', 'test');
    expect(res.enrolledCount).toBe(0);
    expect(res.skippedReason).toBe('before_census_date');
  });

  it('NULL census_date skips with a clear reason and never enrolls', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM academic_terms')) return stmt({ id: 't-1', name: 'T', census_date: null });
      if (sql.includes('JOIN enrollments e')) return stmt(null, [{ user_id: 'u-1', uid: 'X', reg_no: 'R' }]);
      return stmt();
    });
    const res = await runTermCensusJob(db, 't-1', 'test');
    expect(res.enrolledCount).toBe(0);
    expect(res.skippedReason).toBe('census_date_not_set');
  });

  it('forced run is audited', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM academic_terms')) {
        return stmt({ id: 't-1', name: 'T', census_date: new Date(Date.now() + 86400000).toISOString() });
      }
      if (sql.includes('JOIN enrollments e')) return stmt(null, []);
      return stmt();
    });
    const logged: string[] = [];
    const env: any = {
      PLATFORM_CONTEXT: {
        db: {
          ...db,
          prepare: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('INSERT INTO admin_audit_logs')) {
              logged.push(sql);
              return stmt();
            }
            return (db.prepare as any)(sql);
          }),
        },
      },
    };
    const res = await handleRunCensusJob(
      new Request('http://x/api/admin/census/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term_id: 't-1', force: true }) }),
      env, 'admin-1'
    );
    expect(res.status).toBe(200);
    expect(logged.length).toBeGreaterThanOrEqual(1);
  });
});
