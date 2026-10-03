import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./email', () => ({
  safeDispatchEmail: vi.fn().mockResolvedValue(undefined),
  buildEmailLayout: vi.fn((subtitle: string, content: string) => `<html>${subtitle}${content}</html>`),
  isValidEmail: (e: string) => /.+@.+\..+/.test(e),
}));

vi.mock('./census-job', () => ({
  runTermCensusJob: vi.fn().mockResolvedValue({ enrolledCount: 0 }),
}));

vi.mock('./provisioning', () => ({
  dispatchPendingJobs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./config', () => ({
  getPortalUrl: vi.fn().mockReturnValue('https://portal.test'),
}));

import { runLifecycleCronJobs } from './lifecycle-cron';
import { ENROLLMENT_STATUS } from './state-machine';

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

function makeEnv(prepareImpl: (sql: string) => any) {
  const db: any = {
    prepare: vi.fn().mockImplementation(prepareImpl),
    transaction: vi.fn().mockImplementation(async (cb: any) => {
      const tx: any = { prepare: vi.fn().mockImplementation(prepareImpl) };
      return cb(tx);
    }),
  };
  return { PLATFORM_CONTEXT: { db }, ENVIRONMENT: 'test' } as any;
}

const PAST = new Date(Date.now() - 86400000).toISOString();
const FUTURE_SOON = new Date(Date.now() + 86400000).toISOString();

beforeEach(() => vi.clearAllMocks());

describe('Task 01: offer-expiry cron', () => {
  it('(a) expired unaccepted OFFER_EXTENDED offer is lapsed', async () => {
    const writes: string[] = [];
    const env = makeEnv((sql: string) => {
      if (sql.includes('FROM admissions_decisions')) {
        return stmt(null, [{
          id: 'd-1', application_id: 'app-1', offer_expires_at: PAST, decision: 'admit',
          user_id: 'u-1', program: 'Theology', app_status: 'accepted',
          email: 'a@b.c', first_name: 'Ann',
        }]);
      }
      if (sql.includes('FROM students WHERE user_id')) return stmt(null);
      if (sql.includes('FROM enrollment_status_logs') && sql.includes('SELECT')) {
        return stmt({ status: ENROLLMENT_STATUS.OFFER_EXTENDED });
      }
      if (sql.includes('UPDATE applications SET')) { writes.push('app'); return stmt(); }
      if (sql.includes('INSERT INTO application_status_logs')) { writes.push('log'); return stmt(); }
      if (sql.includes('INSERT INTO enrollment_status_logs')) { writes.push('enrollment'); return stmt(); }
      if (sql.includes('FROM metadata')) return stmt(null);
      // reconciliation empties
      if (sql.includes('FROM students s')) return stmt(null, []);
      if (sql.includes('enrollment_status_logs') && sql.includes('PROVISIONING_IN_PROGRESS')) return stmt(null, []);
      if (sql.includes('FROM provisioning_jobs')) return stmt(null, []);
      if (sql.includes('FROM applications a')) return stmt(null, []);
      if (sql.includes('FROM course_sections')) return stmt(null, []);
      if (sql.includes('FROM enrollment_deposits')) return stmt(null, []);
      return stmt();
    });
    const report = await runLifecycleCronJobs(env);
    expect(report.offerExpiry.checked).toBe(1);
    expect(report.offerExpiry.expired).toBe(1);
    expect(report.offerExpiry.failed).toBe(0);
    expect(writes).toEqual(expect.arrayContaining(['app', 'log', 'enrollment']));
  });

  it('(b) expired offer of accepted+provisioned student is untouched', async () => {
    let appUpdated = false;
    const env = makeEnv((sql: string) => {
      if (sql.includes('FROM admissions_decisions')) {
        return stmt(null, [{
          id: 'd-1', application_id: 'app-1', offer_expires_at: PAST, decision: 'admit',
          user_id: 'u-1', program: 'Theology', app_status: 'accepted',
          email: 'a@b.c', first_name: 'Ann',
        }]);
      }
      if (sql.includes('FROM students WHERE user_id')) return stmt({ user_id: 'u-1' });
      if (sql.includes('UPDATE applications SET')) { appUpdated = true; return stmt(); }
      if (sql.includes('FROM students s')) return stmt(null, []);
      if (sql.includes('PROVISIONING_IN_PROGRESS')) return stmt(null, []);
      if (sql.includes('FROM provisioning_jobs')) return stmt(null, []);
      if (sql.includes('FROM applications a')) return stmt(null, []);
      if (sql.includes('FROM course_sections')) return stmt(null, []);
      if (sql.includes('FROM enrollment_deposits')) return stmt(null, []);
      return stmt();
    });
    const report = await runLifecycleCronJobs(env);
    expect(report.offerExpiry.expired).toBe(0);
    expect(appUpdated).toBe(false);
  });

  it('(c) one failing student does not stop the rest', async () => {
    const env = makeEnv((sql: string) => {
      if (sql.includes('FROM admissions_decisions')) {
        return stmt(null, [
          { id: 'd-1', application_id: 'app-bad', offer_expires_at: PAST, decision: 'admit', user_id: 'u-bad', program: 'P', app_status: 'accepted', email: 'a@b.c', first_name: 'Bad' },
          { id: 'd-2', application_id: 'app-good', offer_expires_at: PAST, decision: 'admit', user_id: 'u-good', program: 'P', app_status: 'accepted', email: 'a@b.c', first_name: 'Good' },
        ]);
      }
      if (sql.includes('FROM students WHERE user_id')) return stmt(null);
      if (sql.includes('FROM enrollment_status_logs') && sql.includes('SELECT')) {
        return stmt({ status: ENROLLMENT_STATUS.OFFER_EXTENDED });
      }
      if (sql.includes('UPDATE applications SET')) {
        return {
          bind: vi.fn().mockImplementation((...a: unknown[]) => {
            if (String(a[1]).includes('bad')) throw new Error('write fail');
            return { run: vi.fn().mockResolvedValue({}), first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }) };
          }),
        };
      }
      if (sql.includes('FROM students s')) return stmt(null, []);
      if (sql.includes('PROVISIONING_IN_PROGRESS')) return stmt(null, []);
      if (sql.includes('FROM provisioning_jobs')) return stmt(null, []);
      if (sql.includes('FROM applications a')) return stmt(null, []);
      if (sql.includes('FROM course_sections')) return stmt(null, []);
      if (sql.includes('FROM enrollment_deposits')) return stmt(null, []);
      return stmt();
    });
    const report = await runLifecycleCronJobs(env);
    expect(report.offerExpiry.expired).toBe(1);
    expect(report.offerExpiry.failed).toBe(1);
  });

  it('(d) reminder sent once within 3 days, not again', async () => {
    const { safeDispatchEmail } = await import('./email');
    const env = makeEnv((sql: string) => {
      if (sql.includes('FROM admissions_decisions')) {
        return stmt(null, [{
          id: 'd-1', application_id: 'app-1', offer_expires_at: FUTURE_SOON, decision: 'admit',
          user_id: 'u-1', program: 'Theology', app_status: 'accepted',
          email: 'a@b.c', first_name: 'Ann',
        }]);
      }
      if (sql.includes('FROM students WHERE user_id')) return stmt(null);
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.OFFER_EXTENDED });
      // First call: no reminder marker → send; covered by re-run below with marker present.
      if (sql.includes('FROM metadata')) return stmt(null);
      if (sql.includes('FROM students s')) return stmt(null, []);
      if (sql.includes('PROVISIONING_IN_PROGRESS')) return stmt(null, []);
      if (sql.includes('FROM provisioning_jobs')) return stmt(null, []);
      if (sql.includes('FROM applications a')) return stmt(null, []);
      if (sql.includes('FROM course_sections')) return stmt(null, []);
      if (sql.includes('FROM enrollment_deposits')) return stmt(null, []);
      return stmt();
    });
    const r1 = await runLifecycleCronJobs(env);
    expect(r1.offerExpiry.remindersSent).toBe(1);
    expect(safeDispatchEmail).toHaveBeenCalledTimes(1);

    // Second run with marker present → no resend.
    vi.clearAllMocks();
    const env2 = makeEnv((sql: string) => {
      if (sql.includes('FROM admissions_decisions')) {
        return stmt(null, [{
          id: 'd-1', application_id: 'app-1', offer_expires_at: FUTURE_SOON, decision: 'admit',
          user_id: 'u-1', program: 'Theology', app_status: 'accepted',
          email: 'a@b.c', first_name: 'Ann',
        }]);
      }
      if (sql.includes('FROM students WHERE user_id')) return stmt(null);
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.OFFER_EXTENDED });
      if (sql.includes('FROM metadata')) return stmt({ value: new Date().toISOString() });
      if (sql.includes('FROM students s')) return stmt(null, []);
      if (sql.includes('PROVISIONING_IN_PROGRESS')) return stmt(null, []);
      if (sql.includes('FROM provisioning_jobs')) return stmt(null, []);
      if (sql.includes('FROM applications a')) return stmt(null, []);
      if (sql.includes('FROM course_sections')) return stmt(null, []);
      if (sql.includes('FROM enrollment_deposits')) return stmt(null, []);
      return stmt();
    });
    const r2 = await runLifecycleCronJobs(env2);
    expect(r2.offerExpiry.remindersSent).toBe(0);
  });

  it('(e) invalid transition never leaves application changed without enrollment', async () => {
    let appUpdated = false;
    const env = makeEnv((sql: string) => {
      if (sql.includes('FROM admissions_decisions')) {
        return stmt(null, [{
          id: 'd-1', application_id: 'app-1', offer_expires_at: PAST, decision: 'admit',
          user_id: 'u-1', program: 'P', app_status: 'accepted',
          email: 'a@b.c', first_name: 'A',
        }]);
      }
      if (sql.includes('FROM students WHERE user_id')) return stmt(null);
      // WAITLISTED cannot go to DENIED per ALLOWED_TRANSITIONS → must be blocked pre-write.
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.WAITLISTED });
      if (sql.includes('UPDATE applications SET')) { appUpdated = true; return stmt(); }
      if (sql.includes('FROM students s')) return stmt(null, []);
      if (sql.includes('PROVISIONING_IN_PROGRESS')) return stmt(null, []);
      if (sql.includes('FROM provisioning_jobs')) return stmt(null, []);
      if (sql.includes('FROM applications a')) return stmt(null, []);
      if (sql.includes('FROM course_sections')) return stmt(null, []);
      if (sql.includes('FROM enrollment_deposits')) return stmt(null, []);
      return stmt();
    });
    const report = await runLifecycleCronJobs(env);
    // WAITLISTED is not lapsable → skipped, no write, no failure.
    expect(appUpdated).toBe(false);
    expect(report.offerExpiry.expired).toBe(0);
  });
});

describe('Task 04: reconciliation', () => {
  it('detects each discrepancy type and records admin_audit_logs with user_id', async () => {
    const auditInserts: string[] = [];
    const env = makeEnv((sql: string) => {
      if (sql.includes('FROM admissions_decisions')) return stmt(null, []);
      if (sql.includes('FROM students s')) {
        return stmt(null, [{ user_id: 's-1', email: 's@x.y' }]);
      }
      if (sql.includes("status = 'PROVISIONING_IN_PROGRESS'")) {
        return stmt(null, [{ user_id: 's-stuck', status: 'PROVISIONING_IN_PROGRESS', changed_at: new Date(Date.now() - 7200000).toISOString() }]);
      }
      if (sql.includes('FROM enrollment_status_logs') && sql.includes('ORDER BY')) {
        return stmt({ status: 'PROVISIONING_IN_PROGRESS' });
      }
      if (sql.includes('FROM provisioning_jobs')) {
        return stmt(null, [{ id: 'job-1', status: 'failed', attempts: 6 }]);
      }
      if (sql.includes('FROM applications a')) return stmt(null, []);
      if (sql.includes('FROM course_sections') && !sql.includes('registrations')) {
        return stmt(null, [{ id: 'sec-1', seats_taken: 5 }]);
      }
      if (sql.includes('FROM student_course_registrations')) {
        return stmt({ count: 3 });
      }
      if (sql.includes('FROM enrollment_deposits')) {
        return stmt(null, [{ id: 'dep-1', application_id: 'app-x' }]);
      }
      if (sql.includes('INSERT INTO admin_audit_logs')) {
        expect(sql).toContain('user_id');
        expect(sql).not.toContain('admin_id');
        auditInserts.push(sql);
        return stmt();
      }
      return stmt();
    });
    const report = await runLifecycleCronJobs(env);
    expect(report.reconciliation.run).toBe(true);
    expect(report.reconciliation.discrepanciesFound).toBeGreaterThanOrEqual(4);
    expect(report.reconciliation.details?.missingUid).toBe(1);
    expect(report.reconciliation.details?.provisioningJobsFailed).toBe(1);
    expect(report.reconciliation.details?.seatsMismatch).toBe(1);
    expect(report.reconciliation.details?.orphanDeposits).toBe(1);
    expect(auditInserts.length).toBeGreaterThanOrEqual(4);
  });
});
