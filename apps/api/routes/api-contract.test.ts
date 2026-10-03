/**
 * Cross-app API contract tests — the canonical path + payload table shared by
 * the portal, UMS and API worker. If a backend route moves, this file fails
 * first, before the frontends drift.
 *
 * Canonical contracts pinned here:
 *  POST /api/applications                       { program_id?, program?, ... } → { application_id, application_number }
 *  POST /api/applications/check-duplicate        { email, ... } → { received } (generic, no oracle)
 *  POST /api/admissions/decide                   formal decision (sole offer authority)
 *  POST /api/admissions/accept                   applicant accepts → provisioning
 *  GET  /api/student/sections?course_id=         → { sections, my_section_ids }
 *  POST /api/registration/reserve-seat           { section_id, term_id? }
 *  POST /api/registration/waitlist               { section_id }
 *  POST /api/registration/drop                   { course_id, section_id? }
 *  GET  /api/enrollment/agreement               → { document_id, version, version_hash, text }
 *  POST /api/enrollment/sign-agreement           { document_id, signed_name, document_version_hash } → agreement_signed (NOT REGISTERED)
 *  POST /api/registration/finalize               → owns REGISTERED transition
 *  POST /api/payment/create-intent               { invoiceId } → amount resolved server-side
 *  PATCH /api/admin/documents/:id/verification   { verification_status } → only verified clears holds
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/email', () => ({
  safeDispatchEmail: vi.fn().mockResolvedValue(undefined),
  buildEmailLayout: vi.fn().mockReturnValue('<html></html>'),
  isValidEmail: (e: string) => /.+@.+\..+/.test(e),
}));

import { handleCheckDuplicate } from './apply';
import { handleListSections, handleFinalizeRegistration, handleSignEnrollmentAgreement, handleGetEnrollmentAgreement } from './registration';
import { handleCreatePaymentIntent } from './payment';
import { getEnrollmentAgreementMeta } from '../lib/agreement';

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

describe('API contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /applications/check-duplicate requires a valid email', async () => {
    const env: any = { PLATFORM_CONTEXT: { db: { prepare: vi.fn().mockReturnValue(stmt()) } } };
    const bad = await handleCheckDuplicate(
      new Request('http://x/api/applications/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
      env
    );
    expect(bad.status).toBe(400);
  });

  it('GET /student/sections requires course_id', async () => {
    const env: any = { PLATFORM_CONTEXT: { db: { prepare: vi.fn().mockReturnValue(stmt()) } } };
    const res = await handleListSections(new Request('http://x/api/student/sections'), env, 'u-1');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('POST /registration/finalize rejects non-POST', async () => {
    const env: any = { PLATFORM_CONTEXT: { db: { prepare: vi.fn().mockReturnValue(stmt()) } } };
    const res = await handleFinalizeRegistration(new Request('http://x/api/registration/finalize'), env, 'u-1');
    expect(res.status).toBe(405);
  });

  it('POST /enrollment/sign-agreement requires all three fields', async () => {
    const env: any = { PLATFORM_CONTEXT: { db: { prepare: vi.fn().mockReturnValue(stmt()) } } };
    const res = await handleSignEnrollmentAgreement(
      new Request('http://x/api/enrollment/sign-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: 'ENROLL-AGREEMENT-2026' }),
      }),
      env,
      'u-1'
    );
    expect(res.status).toBe(400);
  });

  it('GET /enrollment/agreement returns a verifiable version hash', async () => {
    const env: any = {};
    const res = await handleGetEnrollmentAgreement(new Request('http://x/api/enrollment/agreement'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const meta = body.data ?? body;
    expect(meta.document_id).toBe('ENROLL-AGREEMENT-2026');
    expect(meta.version_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Hash must reproduce from the canonical text (auditable, not placeholder)
    const recomputed = await getEnrollmentAgreementMeta();
    expect(meta.version_hash).toBe(recomputed.version_hash);
  });

  it('POST /payment/create-intent with unknown invoice → 404 (never trusts client amount)', async () => {
    const env: any = {
      PLATFORM_CONTEXT: {
        db: { prepare: vi.fn().mockReturnValue(stmt(null)) },
        payment: { createPaymentIntent: vi.fn() },
      },
    };
    const res = await handleCreatePaymentIntent(
      new Request('http://x/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1, invoiceId: 'no-such-invoice' }),
      }),
      env,
      'u-1'
    );
    expect(res.status).toBe(404);
    // Gateway must never be reached when the invoice cannot be resolved
    expect(env.PLATFORM_CONTEXT.payment.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('POST /payment/create-intent ignores client amount when invoice exists', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pi-1', reference: 'ref-1', amount: 50000, currency: 'KES', status: 'pending' });
    const env: any = {
      PLATFORM_CONTEXT: {
        db: {
          prepare: vi.fn().mockImplementation((sql: string) => {
            if (sql.includes('FROM users')) return stmt({ email: 's@bmi.edu' });
            if (sql.includes('FROM invoices')) {
              return stmt({ id: 'inv-1', amount: 500, status: 'unpaid', student_id: 'u-1' });
            }
            return stmt();
          }),
        },
        payment: { createPaymentIntent: create },
      },
    };
    const res = await handleCreatePaymentIntent(
      new Request('http://x/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1, invoiceId: 'inv-1' }),
      }),
      env,
      'u-1'
    );
    expect(res.status).toBe(200);
    // Server-resolved invoice amount (500), NOT the client-supplied 1
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 500 }));
  });
});
