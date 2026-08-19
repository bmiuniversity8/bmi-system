import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleRecordDecision, handleAcceptOffer, handlePayDeposit } from './admissions';
import { handleGetRegistrationEligibility, handleReserveSeat, handleWaitlistSeat, handleSignEnrollmentAgreement, handleRunCensusJob } from './registration';
import { handleGetProvisioningStatus } from './provisioning';
import { setEnrollmentStatus, getEnrollmentStatus, ENROLLMENT_STATUS } from '../lib/state-machine';

describe('Authoritative Enrollment State Machine & Provisioning Saga', () => {
  let mockDb: any;
  let mockEnv: any;

  beforeEach(() => {
    const tableData: Record<string, any[]> = {
      applications: [
        {
          id: 'app-1',
          user_id: 'student-user-1',
          program: 'Theology',
          degree_level: 'undergraduate',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john.doe@example.com',
          status: 'submitted',
        },
      ],
      users: [
        {
          id: 'student-user-1',
          email: 'john.doe@example.com',
          first_name: 'John',
          last_name: 'Doe',
          role: 'applicant',
        },
      ],
      students: [
        {
          id: 'student-user-1',
          user_id: 'student-user-1',
          catalog_year_id: 'CAT-2026',
          official_student_id: 'BMI-2026-001',
          registration_number: 'REG-2026-001',
          program_name: 'Theology',
          gpa: 3.8,
        },
      ],
      enrollmentStatusLogs: [],
      admissionsDecisions: [],
      enrollmentDeposits: [],
      esignatures: [],
      financialAidAwards: [],
      studentHolds: [],
      advisingReleases: [{ student_id: 'student-user-1', term_id: 'term-2026-fall', released_by: 'advisor-1' }],
      courseSections: [{ id: 'sec-1', course_id: 'c-1', capacity: 30, seats_taken: 5, seats_held: 0 }],
      courseSectionWaitlists: [],
      enrollments: [],
      academic_terms: [{ id: 'term-2026-fall', name: 'Fall 2026', status: 'active', academic_year: '2026-2027' }],
    };

    mockDb = {
      _data: tableData,
      select: vi.fn(() => ({
        from: vi.fn((table: any) => {
          const tableName = table?.name || 'applications';
          const items = tableData[tableName] || [];
          return {
            where: vi.fn(() => ({
              execute: vi.fn(async () => items),
              first: vi.fn(async () => items[0] || null),
              orderBy: vi.fn(() => ({
                execute: vi.fn(async () => items),
                first: vi.fn(async () => items[0] || null),
              })),
            })),
            orderBy: vi.fn(() => ({
              execute: vi.fn(async () => items),
            })),
            execute: vi.fn(async () => items),
          };
        }),
      })),
      insert: vi.fn((table: any) => ({
        values: vi.fn((val: any) => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn(async () => [val]),
            })),
            execute: vi.fn(async () => [val]),
          })),
          returning: vi.fn(() => ({
            execute: vi.fn(async () => [val]),
          })),
          execute: vi.fn(async () => [val]),
        })),
      })),
      update: vi.fn((table: any) => ({
        set: vi.fn((vals: any) => ({
          where: vi.fn(() => ({
            execute: vi.fn(async () => [vals]),
          })),
        })),
      })),
      transaction: vi.fn(async (cb: any) => cb(mockDb)),
      prepare: vi.fn((sql: string) => {
        const stmt = {
          bind: vi.fn((...args: any[]) => stmt),
          run: vi.fn(async () => ({ success: true })),
          first: vi.fn(async () => {
            if (sql.includes('uid_counters') || sql.includes('regno_counters')) {
              return { last_serial: 101 };
            }
            if (sql.includes('applications')) {
              return {
                id: 'app-1',
                user_id: 'student-user-1',
                program: 'Theology',
                degree_level: 'undergraduate',
                first_name: 'John',
                last_name: 'Doe',
                email: 'john.doe@example.com',
                status: 'accepted',
              };
            }
            if (sql.includes('academic_terms') || sql.includes('terms')) {
              return { id: 'term-2026-fall', name: 'Fall 2026', academic_year: '2026-2027', status: 'active' };
            }
            if (sql.includes('students')) {
              return { id: 'student-user-1', official_student_id: 'BMI-2026-001', catalog_year_id: 'CAT-2026' };
            }
            if (sql.includes('users')) {
              return { id: 'student-user-1', email: 'john.doe@example.com', first_name: 'John', last_name: 'Doe', role: 'applicant' };
            }
            return null;
          }),
          all: vi.fn(async () => {
            if (sql.includes('courseSections') || sql.includes('course_sections')) {
              return { results: [{ id: 'sec-1', capacity: 30, seats_taken: 5, seats_held: 0 }] };
            }
            return { results: [] };
          }),
        };
        return stmt;
      }),
    };

    mockEnv = {
      PLATFORM_CONTEXT: { db: mockDb },
      DB: mockDb,
    };
  });

  describe('State Machine & Transition Rules', () => {
    it('sets and audits enrollment status transitions correctly', async () => {
      await expect(
        setEnrollmentStatus(mockDb, {
          userId: 'user-123',
          status: ENROLLMENT_STATUS.OFFER_ACCEPTED,
          changedBy: 'user-123',
          reason: 'Accepted offer',
        })
      ).resolves.not.toThrow();
    });

    it('queries enrollment status', async () => {
      const status = await getEnrollmentStatus(mockDb, 'user-123');
      expect(status).toBeDefined();
      expect(status).toHaveProperty('status');
    });
  });

  describe('Admissions Decisions & Offer Acceptance', () => {
    it('records an admission decision and updates status', async () => {
      const req = new Request('http://localhost/api/admissions/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: 'app-1',
          decision: 'admit',
          deposit_required: false,
        }),
      });

      const res = await handleRecordDecision(req, mockEnv, 'admin-1');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('accepted');
    });

    it('accepts offer and executes provisioning orchestrator saga', async () => {
      const req = new Request('http://localhost/api/admissions/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: 'app-1',
        }),
      });

      const res = await handleAcceptOffer(req, mockEnv, 'student-user-1', {} as any);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.provisioningResult).toBeDefined();
    });
  });

  describe('Provisioning Status Endpoint', () => {
    it('returns provisioning steps and identities', async () => {
      const req = new Request('http://localhost/api/provisioning/status', {
        method: 'GET',
      });

      const res = await handleGetProvisioningStatus(req, mockEnv, 'student-user-1');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.steps).toBeInstanceOf(Array);
      expect(body.data.steps.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Registration Eligibility Gating', () => {
    it('evaluates student registration clearance', async () => {
      const req = new Request('http://localhost/api/student/registration-eligibility', {
        method: 'GET',
      });

      const res = await handleGetRegistrationEligibility(req, mockEnv, 'student-user-1');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveProperty('eligible');
      expect(body.data).toHaveProperty('status');
      expect(body.data).toHaveProperty('reasons');
    });
  });

  describe('Census Batch Runner', () => {
    it('runs term census conversion from REGISTERED to OFFICIALLY_ENROLLED', async () => {
      const req = new Request('http://localhost/api/admin/census/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term_id: 'term-2026-fall' }),
      });

      const res = await handleRunCensusJob(req, mockEnv, 'admin-1');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('enrolledCount');
      expect(body.data).toHaveProperty('termId');
    });
  });
});
