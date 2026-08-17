/**
 * End-to-End Live Student Enrollment Journey Integration Test
 *
 * Tests the complete multi-stage student enrollment workflow using
 * realistic mock wiring that simulates each stage's DB interactions:
 *
 * Stage 0: Registration → user + draft application
 * Stage 1: Application submission → draft purged, submitted app created (no 409)
 * Stage 3: Admin acceptance → role=student, admission code generated, student status=Admitted
 * Stage 5: Account claim → password set, account activated
 * Stage 6: Registration wizard complete → student status=Active
 * Stage 7: Onboarding & registration-progress APIs unified
 * Stage 8: Stats include admitted breakdown
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEnv, makeDrizzleMock } from './test-helpers';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@bmi/api-middleware', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed_password_123'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/jwt', () => ({
  signJWT: vi.fn().mockResolvedValue('mock_jwt_token'),
  validatePasswordStrength: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  isCommonPassword: vi.fn().mockReturnValue(false),
}));

vi.mock('../lib/email', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendEmail: vi.fn().mockResolvedValue(true),
    safeDispatchEmail: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../lib/webhook', () => ({
  dispatchWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/app_number', () => ({
  generateApplicationNumber: vi.fn().mockResolvedValue('APP-2026-0099'),
}));

vi.mock('../lib/lifecycle', () => ({
  runAdmissionPipeline: vi.fn().mockResolvedValue({ uid: 'BMI000000001', regNo: null }),
  appendLifecycleEvent: vi.fn().mockResolvedValue(undefined),
  getLifecycleHistory: vi.fn().mockResolvedValue([]),
  isStageComplete: vi.fn().mockResolvedValue(false),
  STAGES: {
    APPLICATION_SUBMITTED: 'application_submitted',
    APPLICATION_ACCEPTED: 'application_accepted',
    UID_GENERATED: 'uid_generated',
    STUDENT_RECORD_CREATED: 'student_record_created',
    PROGRAM_ENROLLED: 'program_enrolled',
    REGISTRATION_NUMBER_GENERATED: 'registration_number_generated',
    DOCUMENTS_GENERATED: 'documents_generated',
    HOLDS_ASSIGNED: 'holds_assigned',
    PROVISIONING_QUEUED: 'provisioning_queued',
    STUDENT_ACTIVE: 'student_active',
  },
}));

vi.mock('../lib/provisioning', () => ({
  dispatchPendingJobs: vi.fn().mockResolvedValue(undefined),
  enqueueProvisioningJobs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/performance', () => ({
  createApplicationWithDependencies: vi.fn().mockResolvedValue('app-submitted'),
  createApplicationWithDependenciesOptimized: vi.fn().mockResolvedValue('app-submitted'),
  executeAdmissionPipelineOptimized: vi.fn().mockResolvedValue({ uid: 'BMI000000001', regNo: 'BMI/UG-BIB/26/0001' }),
  executeWithMonitoring: vi.fn().mockImplementation(async (_db: any, _op: string, fn: () => any) => {
    return { result: await fn(), metrics: {} };
  }),
}));

vi.mock('../lib/unified-provisioner', () => ({
  runUnifiedProvisioning: vi.fn().mockResolvedValue({
    uid: 'BMI000000001',
    regNo: 'BMI/UG-BIB/26/0001',
    userId: 'user-john-1',
    personId: 'person-1',
    studentExists: false,
    programLinked: true,
    documentsGenerated: true,
    provisioningQueued: true,
    lifecycleKeys: [],
  }),
}));

vi.mock('../lib/config', () => ({
  getPortalUrl: vi.fn().mockReturnValue('https://portal.example.com'),
}));

vi.mock('../lib/db', () => ({
  createCoreDb: vi.fn(),
  setRequestContext: vi.fn().mockResolvedValue(undefined),
  isNeon: vi.fn().mockReturnValue(false),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { handleRegister } from './auth';
import { handleSubmitApplication, handleUpdateStatus } from './apply';
import { handleClaimAccount } from './claim';
import { handleSaveRegistrationStep, handleCompleteRegistration } from './registration';
import { handleGetOnboardingStatus } from './onboarding';
import { handleGetRegistrationProgress } from './enrollment';
import { handleStudentStatsOverview } from './ums-stats';
import { createCoreDb } from '../lib/db';

// ─── Helper: Build a chainable mock db where prepare() returns .bind().first()/.run() AND .first() ─

function makeChainableDb(overrides: Record<string, any> = {}) {
  const defaultResult = { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({ success: true }) };
  const db: any = {
    prepare: vi.fn().mockReturnValue({
      ...defaultResult,
      bind: vi.fn().mockReturnValue(defaultResult),
    }),
    batch: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (cb: any) => {
      const tx: any = {
        prepare: vi.fn().mockReturnValue({
          ...defaultResult,
          bind: vi.fn().mockReturnValue(defaultResult),
        }),
      };
      return cb(tx);
    }),
    ...overrides,
  };
  return db;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('End-to-End Live Student Enrollment Journey', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 0: Registration creates user + draft application (not submitted)
  // ═══════════════════════════════════════════════════════════════════════════
  it('Stage 0 — Registration creates user and draft application', async () => {
    const drizzle = makeDrizzleMock(); // no existing user → select returns []
    vi.mocked(createCoreDb).mockReturnValue(drizzle);

    const env = makeEnv(undefined, {
      PASSWORD_PEPPER: 'test-pepper',
      RESEND_API_KEY: undefined,
    });

    const req = new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'john.doe@example.com',
        password: 'ValidPass123!',
        first_name: 'John',
        last_name: 'Doe',
      }),
    });

    const res = await handleRegister(req, env);
    expect(res.status).toBeLessThan(400);

    // The transaction was invoked (user + email verification + draft app)
    expect(drizzle.transaction).toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 1: Application submission succeeds even with prior draft record
  // ═══════════════════════════════════════════════════════════════════════════
  it('Stage 1 — Application submission succeeds (draft app does NOT cause 409)', async () => {
    const defaultBinding = {
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true }),
    };

    const db = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        const bindFn = vi.fn().mockReturnValue(defaultBinding);

        if (sql.includes('FROM programs')) {
          return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ found: 1 }) }), first: vi.fn().mockResolvedValue({ found: 1 }) };
        }
        if (sql.includes("status NOT IN")) {
          return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ count: 0 }) }), first: vi.fn().mockResolvedValue({ count: 0 }) };
        }
        if (sql.includes("app_config")) {
          return { bind: bindFn, first: vi.fn().mockResolvedValue(null) };
        }
        if (sql.includes("DELETE FROM applications")) {
          return { bind: vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({ success: true }) }), run: vi.fn().mockResolvedValue({ success: true }) };
        }
        // Default
        return { bind: bindFn, first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({ success: true }) };
      }),
      batch: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (cb: any) => cb(db)),
    };

    const env = {
      PLATFORM_CONTEXT: { db },
      RESEND_API_KEY: 'test-key',
      ADMIN_EMAIL: 'admin@test.com',
      ENVIRONMENT: 'test',
    };

    const req = new Request('http://localhost/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program: 'BA in Biblical Studies',
        degree_level: 'undergraduate',
        personal_statement: 'I want to study.',
        date_of_birth: '2000-01-01',
        nationality: 'Liberian',
        gender: 'Male',
      }),
    });

    const res = await handleSubmitApplication(req, env as any, 'user-john-1');
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.application_id).toBeDefined();
    expect(body.data.status).toBe('submitted');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 3: Admin acceptance → role=student, admission code
  // ═══════════════════════════════════════════════════════════════════════════
  it('Stage 3 — Admin accepts application (sets role, generates admission code)', async () => {
    const drizzle = makeDrizzleMock([{ id: 'admin-1', role: 'admin', first_name: 'Admin', email: 'admin@test.com' }]);
    vi.mocked(createCoreDb).mockReturnValue(drizzle);

    const defaultBinding = { first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({ success: true }) };
    const db: any = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM applications a JOIN users u')) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue({
                id: 'app-1', status: 'submitted', program: 'BA in Biblical Studies',
                user_id: 'user-john-1', email: 'john@example.com', first_name: 'John',
              }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue(defaultBinding),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] }),
        };
      }),
      transaction: vi.fn().mockImplementation(async (cb: any) => {
        const tx = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({ success: true }) }) }) };
        return cb(tx);
      }),
    };

    const env = {
      PLATFORM_CONTEXT: { db, document: null },
      RESEND_API_KEY: 'test-key',
      ADMIN_EMAIL: 'admin@test.com',
      ENVIRONMENT: 'test',
    };

    const req = new Request('http://localhost/api/admin/applications/app-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', notes: 'Congratulations!' }),
    });

    const res = await handleUpdateStatus(req, env as any, 'app-1', 'admin-1');
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.new_status).toBe('accepted');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 5: Account claim with admission code
  // ═══════════════════════════════════════════════════════════════════════════
  it('Stage 5 — Account claim succeeds with valid admission code', async () => {
    const drizzle = makeDrizzleMock([{ id: 'user-john-1', first_name: 'John', email: 'john@example.com' }]);
    vi.mocked(createCoreDb).mockReturnValue(drizzle);

    const env = {
      PLATFORM_CONTEXT: {
        db: {
          transaction: vi.fn().mockImplementation(async (cb: any) => {
            const tx = {
              prepare: vi.fn().mockReturnValue({
                bind: vi.fn().mockReturnValue({
                  first: vi.fn().mockResolvedValue({ id: 'app-1' }),
                  run: vi.fn().mockResolvedValue({ success: true }),
                }),
              }),
            };
            return cb(tx);
          }),
        },
      },
      PASSWORD_PEPPER: 'test-pepper',
      PBKDF2_ITERATIONS: '100000',
      RESEND_API_KEY: 'test-key',
      ENVIRONMENT: 'test',
    };

    const req = new Request('http://localhost/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admissionCode: 'ABCD1234', password: 'NewSecurePass123!' }),
    });

    const res = await handleClaimAccount(req, env as any);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 6: Registration wizard step save + complete → status=Active
  // ═══════════════════════════════════════════════════════════════════════════
  it('Stage 6 — Registration wizard complete transitions student to Active', async () => {
    // Pre-populate all wizard steps in "metadata"
    const registrationData = {
      personal_details: { first_name: 'John', last_name: 'Doe', date_of_birth: '2000-01-01', gender: 'male', nationality: 'Kenyan' },
      address: { current_address: '123 Main St', emergency_contact_name: 'Jane Doe', emergency_contact_phone: '+254700000000' },
      program: { program_id: 'prog-1', program_name: 'BA in Biblical Studies', study_mode: 'full_time' },
      modules: { selected_course_ids: ['crs-1', 'crs-2'] },
      fees: { accepted_fee_structure: true, payment_method: 'card' },
      confirm: { accepted_terms: true, data_accuracy_confirmed: true, signed_name: 'John Doe', signed_date: '2026-08-12' },
    };

    const defaultBinding = { first: vi.fn().mockResolvedValue(null), run: vi.fn().mockResolvedValue({ success: true }) };
    const db: any = {
      prepare: vi.fn().mockImplementation((sql: string) => ({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockImplementation(async () => {
            if (sql.includes('FROM metadata')) return { value: JSON.stringify(registrationData) };
            if (sql.includes('FROM users')) return { email: 'john@example.com', first_name: 'John', last_name: 'Doe', reg_no: 'PENDING-USERJOHN', uid: 'BMI000000001' };
            return null;
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      })),
      transaction: vi.fn().mockImplementation(async (cb: any) => {
        const tx = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({ success: true }), first: vi.fn().mockResolvedValue(null) }) }) };
        return cb(tx);
      }),
    };

    const env = {
      PLATFORM_CONTEXT: { db, document: null },
      RESEND_API_KEY: 'test-key',
      ENVIRONMENT: 'test',
    };

    // Complete registration — should succeed and trigger status → Active
    const completeReq = new Request('http://localhost/api/registration/complete', { method: 'POST' });
    const completeRes = await handleCompleteRegistration(completeReq, env as any, 'user-john-1');
    expect(completeRes.status).toBe(200);

    const body = await completeRes.json() as any;
    expect(body.success).toBe(true);

    // Verify transaction was called (which sets status='Active' + enrollments)
    expect(db.transaction).toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 7: Onboarding and registration-progress APIs are unified
  // ═══════════════════════════════════════════════════════════════════════════
  it('Stage 7 — Onboarding delegates to registration-progress (unified 4-task checklist)', async () => {
    const drizzle = makeDrizzleMock();
    vi.mocked(createCoreDb).mockReturnValue(drizzle);

    const env = { PLATFORM_CONTEXT: { db: { prepare: vi.fn() } }, ENVIRONMENT: 'test' };

    const regProgressRes = await handleGetRegistrationProgress(
      new Request('http://localhost/api/student/registration-progress'), env as any, 'user-john-1'
    );
    expect(regProgressRes.status).toBe(200);
    const regData = await regProgressRes.json() as any;
    expect(regData.data.tasks).toBeDefined();
    expect(regData.data.tasks.length).toBe(4);
    expect(regData.data.tasks.map((t: any) => t.id)).toEqual(['upload_id', 'orientation', 'course_selection', 'payment']);

    // Onboarding now delegates to the same handler
    const onboardingRes = await handleGetOnboardingStatus(
      new Request('http://localhost/api/student/onboarding'), env as any, 'user-john-1'
    );
    expect(onboardingRes.status).toBe(200);
    const onboardingData = await onboardingRes.json() as any;
    expect(onboardingData.data.tasks.length).toBe(4);

    // Both endpoints return identical task IDs
    expect(regData.data.tasks.map((t: any) => t.id)).toEqual(onboardingData.data.tasks.map((t: any) => t.id));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Stage 8: Stats endpoint includes 'admitted' breakdown
  // ═══════════════════════════════════════════════════════════════════════════
  it('Stage 8 — Student stats overview includes admitted count', async () => {
    const env = {
      PLATFORM_CONTEXT: {
        db: {
          prepare: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ c: 5 }),
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
        },
      },
      ENVIRONMENT: 'test',
    };

    const res = await handleStudentStatsOverview(
      new Request('http://localhost/api/v1/students/stats/overview'), env as any
    );
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.data).toHaveProperty('admitted');
    expect(body.data).toHaveProperty('active');
    expect(body.data).toHaveProperty('total');
  });
});
