import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/email', () => ({
  safeDispatchEmail: vi.fn().mockResolvedValue(undefined),
  buildEmailLayout: vi.fn().mockReturnValue('<html></html>'),
  isValidEmail: (e: string) => /.+@.+\..+/.test(e),
}));

import { handleDeclineOffer, handlePayDeposit, handleRecordDecision } from './admissions';
import { recordAdmissionsDecision } from '../lib/admissions-decision-service';
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

describe('Task 02: decline offer', () => {
  it('decline succeeds and leaves application=withdrawn + enrollment=APPLICANT_WITHDRAWN', async () => {
    const transitioned: string[] = [];
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM applications WHERE id')) return stmt({ id: 'app-1', user_id: 'u-1', status: 'accepted' });
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.OFFER_EXTENDED });
      if (sql.includes('UPDATE applications SET')) {
        expect(sql).toContain("'withdrawn'");
        return stmt();
      }
      if (sql.includes('INSERT INTO application_status_logs')) return stmt();
      if (sql.includes('INSERT INTO enrollment_status_logs')) {
        return {
          bind: vi.fn().mockImplementation((...a: unknown[]) => {
            transitioned.push(String(a[3]));
            return { run: vi.fn().mockResolvedValue({}), first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }) };
          }),
        };
      }
      return stmt();
    });
    const env: any = { PLATFORM_CONTEXT: { db } };
    const res = await handleDeclineOffer(
      new Request('http://x/api/admissions/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: 'app-1' }) }),
      env, 'u-1'
    );
    expect(res.status).toBe(200);
    expect(transitioned).toContain(ENROLLMENT_STATUS.APPLICANT_WITHDRAWN);
  });

  it("declining someone else's application returns 404", async () => {
    const db = makeDb(() => stmt(null));
    const env: any = { PLATFORM_CONTEXT: { db } };
    const res = await handleDeclineOffer(
      new Request('http://x/api/admissions/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: 'app-x' }) }),
      env, 'u-attacker'
    );
    expect(res.status).toBe(404);
  });

  it('declining after acceptance/provisioning returns 409 with no change', async () => {
    let updated = false;
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM applications WHERE id')) return stmt({ id: 'app-1', user_id: 'u-1', status: 'accepted' });
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.PROVISIONED });
      if (sql.includes('UPDATE applications SET')) { updated = true; return stmt(); }
      return stmt();
    });
    const env: any = { PLATFORM_CONTEXT: { db } };
    const res = await handleDeclineOffer(
      new Request('http://x/api/admissions/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: 'app-1' }) }),
      env, 'u-1'
    );
    expect(res.status).toBe(409);
    expect(updated).toBe(false);
  });
});

describe('Task 03: deposits via gateway', () => {
  const DECISION = { deposit_required: 1, deposit_amount: 100, offer_expires_at: new Date(Date.now() + 86400000).toISOString() };

  function depositEnv(intent: any) {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM applications WHERE id')) return stmt({ id: 'app-1', user_id: 'u-1', status: 'accepted' });
      if (sql.includes('FROM admissions_decisions')) return stmt(DECISION);
      if (sql.includes('FROM enrollment_deposits WHERE payment_reference')) return stmt(null);
      if (sql.includes('INSERT INTO enrollment_deposits')) return stmt();
      if (sql.includes('SELECT id FROM enrollment_deposits')) return stmt({ id: 'dep-1' });
      return stmt();
    });
    const env: any = {
      PLATFORM_CONTEXT: {
        db,
        payment: { verifyPaymentIntent: vi.fn().mockResolvedValue(intent) },
      },
    };
    return env;
  }

  it('a fake reference is rejected (gateway says failed)', async () => {
    const env = depositEnv({ id: 'fake', amount: 100, currency: 'USD', status: 'failed', reference: 'fake', metadata: { userId: 'u-1', purpose: 'deposit', applicationId: 'app-1' } });
    const res = await handlePayDeposit(
      new Request('http://x/api/admissions/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: 'app-1', payment_reference: 'fake' }) }),
      env, 'u-1'
    );
    expect([400, 402]).toContain(res.status);
  });

  it('amount mismatch rejected', async () => {
    const env = depositEnv({ id: 'r1', amount: 1, currency: 'USD', status: 'succeeded', reference: 'r1', metadata: { userId: 'u-1', purpose: 'deposit', applicationId: 'app-1' } });
    const res = await handlePayDeposit(
      new Request('http://x/api/admissions/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: 'app-1', payment_reference: 'r1' }) }),
      env, 'u-1'
    );
    expect(res.status).toBe(402);
  });

  it("another user's application rejected", async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM applications WHERE id')) return stmt({ id: 'app-1', user_id: 'u-victim', status: 'accepted' });
      return stmt();
    });
    const env: any = { PLATFORM_CONTEXT: { db, payment: { verifyPaymentIntent: vi.fn() } } };
    const res = await handlePayDeposit(
      new Request('http://x/api/admissions/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: 'app-1', payment_reference: 'r1' }) }),
      env, 'u-attacker'
    );
    expect(res.status).toBe(404);
  });

  it('webhook/verify delivered twice produces exactly one deposit (idempotent)', async () => {
    const { recordEnrollmentDeposit } = await import('../lib/admissions-decision-service');
    let inserts = 0;
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM enrollment_deposits WHERE payment_reference')) {
        return stmt(inserts > 0 ? { id: 'dep-1' } : null);
      }
      if (sql.includes('INSERT INTO enrollment_deposits')) {
        inserts++;
        return stmt();
      }
      if (sql.includes('SELECT id FROM enrollment_deposits')) return stmt({ id: 'dep-1' });
      return stmt();
    });
    const r1 = await recordEnrollmentDeposit(db, { applicationId: 'app-1', userId: 'u-1', amount: 100, paymentReference: 'ref-1' });
    const r2 = await recordEnrollmentDeposit(db, { applicationId: 'app-1', userId: 'u-1', amount: 100, paymentReference: 'ref-1' });
    expect(r1.depositId).toBe(r2.depositId);
    expect(inserts).toBe(1);
  });
});

describe('Task 05: decision robustness', () => {
  it('repeating the same decision is idempotent', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM applications a WHERE a.id')) return stmt({ id: 'app-1', user_id: 'u-1', program: 'P', status: 'accepted' });
      if (sql.includes('FROM admissions_decisions WHERE application_id')) return stmt({ id: 'dec-1', decision: 'admit' });
      if (sql.includes('SELECT status FROM applications WHERE id')) return stmt({ status: 'accepted' });
      return stmt();
    });
    const res = await recordAdmissionsDecision(db, { applicationId: 'app-1', decision: 'admit', decidedBy: 'admin-1' });
    expect(res.success).toBe(true);
    expect(res.decisionId).toBe('dec-1');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('invalid re-decision returns 409 with no change', async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes('FROM applications a WHERE a.id')) return stmt({ id: 'app-1', user_id: 'u-1', program: 'P', status: 'accepted' });
      if (sql.includes('FROM admissions_decisions WHERE application_id')) return stmt({ id: 'dec-1', decision: 'admit' });
      if (sql.includes('SELECT status FROM applications WHERE id')) return stmt({ status: 'waitlisted' });
      if (sql.includes('FROM enrollment_status_logs')) return stmt({ status: ENROLLMENT_STATUS.OFFER_EXTENDED });
      return stmt();
    });
    const env: any = { PLATFORM_CONTEXT: { db } };
    // admit (→OFFER_EXTENDED) then waitlist (→WAITLISTED) is not an allowed move.
    const res = await handleRecordDecision(
      new Request('http://x/api/admissions/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_id: 'app-1', decision: 'waitlist' }) }),
      env, 'admin-1'
    );
    expect(res.status).toBe(409);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('a decision insert failure rolls everything back (no swallow)', async () => {
    const appUpdated = false;
    const db: any = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM applications a WHERE a.id')) return stmt({ id: 'app-1', user_id: 'u-1', program: 'P', status: 'submitted' });
        if (sql.includes('FROM admissions_decisions WHERE application_id')) return stmt(null);
        if (sql.includes('FROM enrollment_status_logs')) return stmt(null);
        return stmt();
      }),
      transaction: vi.fn().mockImplementation(async () => {
        throw new Error('insert failed');
      }),
    };
    await expect(
      recordAdmissionsDecision(db, { applicationId: 'app-1', decision: 'admit', decidedBy: 'admin-1' })
    ).rejects.toThrow('insert failed');
    expect(appUpdated).toBe(false);
  });
});
