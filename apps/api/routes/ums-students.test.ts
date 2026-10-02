import { makeEnv } from './test-helpers';
/**
 * UMS Students Handler Unit Tests
 *
 * Tests handleCreateStudent, handleUpdateStudent, and handleDeleteStudent.
 * Covers schema validation, strict field injection prevention, and successful mutations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreateStudent, handleUpdateStudent, handleDeleteStudent } from './ums-students';

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeEnv(overrides: Record<string, unknown> = {}) {
  const db = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    run: vi.fn().mockResolvedValue({}),
    all: vi.fn().mockResolvedValue({ results: [] }),
    transaction: vi.fn().mockImplementation(async (cb: any) => cb(db)),
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    getPlatform: vi.fn().mockReturnValue('test'),
  };

  const context = {
    db,
    kv: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue({ keys: [] }) },
    queue: { send: vi.fn().mockResolvedValue(undefined), sendBatch: vi.fn().mockResolvedValue(undefined) },
    rateLimiter: { checkAndIncrement: vi.fn().mockResolvedValue({ allowed: true, remaining: 29 }), reset: vi.fn().mockResolvedValue(undefined) },
    writeQueue: { enqueue: vi.fn().mockResolvedValue(undefined) },
    secrets: { get: vi.fn().mockResolvedValue(null), getSecret: vi.fn().mockResolvedValue(null) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tracer: { getRequestId: vi.fn().mockReturnValue('test-id'), setTag: vi.fn() },
  };

  return {
    PLATFORM_CONTEXT: context,
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

function makeRequest(method: string, body: unknown) {
  return new Request('http://localhost/api/students', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('handleCreateStudent', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
  });

  it('returns 400 when missing required fields (caught by Zod)', async () => {
    const req = makeRequest('POST', { email: 'test@example.com' });
    const res = await handleCreateStudent(req, env as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    // Should have multiple missing fields like first_name, last_name, etc.
    expect(body.fields?.length).toBeGreaterThan(1);
  });

  it('returns 201 on success (new user)', async () => {
    // SQL-aware mock: orchestrator queries enrollment_status_logs (empty → first
    // status), then the canonical user row, then UID/reg helpers.
    const userRow = { id: 'new-user', first_name: 'John', last_name: 'Doe', email: 'john@example.com', student_email: null, person_id: null, uid: null, national_id: null, reg_no: null, catalog_year_id: null, official_student_id: null };
    const stmtFor = (firstVal: unknown) => ({
      bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(firstVal), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({}) }),
      first: vi.fn().mockResolvedValue(firstVal),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({}),
    });
    env.PLATFORM_CONTEXT.db.prepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('uid_counters')) {
        return stmtFor({ last_serial: 42 });
      }
      if (sql.includes('enrollment_status_logs')) {
        return stmtFor(null);
      }
      if (sql.includes('FROM users u') && sql.includes('LEFT JOIN persons')) {
        return stmtFor(userRow);
      }
      if (sql.includes('SELECT person_id FROM users')) {
        return stmtFor({ person_id: 'person-1' });
      }
      if (sql.includes('SELECT s.user_id as id')) {
        return stmtFor({ id: 'new-user', first_name: 'John' });
      }
      return stmtFor(null);
    });
    env.PLATFORM_CONTEXT.db.first = vi.fn().mockResolvedValue(null);
    env.PLATFORM_CONTEXT.db.run = vi.fn().mockResolvedValue({});

    const req = makeRequest('POST', {
      email: 'john@example.com',
      first_name: 'John',
      last_name: 'Doe',
      reg_no: 'REG123',
      admission_date: '2026-09-01',
      program: 'Computer Science',
    });

    const res = await handleCreateStudent(req, env as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('returns 201 on success (existing user, with uid)', async () => {
    const userRow = { id: 'existing-user', first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com', student_email: null, person_id: 'person-1', uid: 'BMI000000042', national_id: null, reg_no: null, catalog_year_id: null, official_student_id: 'BMI000000042' };
    env.PLATFORM_CONTEXT.db.prepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM users WHERE email')) {
        return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ id: 'existing-user' }), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({}) }) };
      }
      if (sql.includes('enrollment_status_logs')) {
        return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({}) }) };
      }
      if (sql.includes('FROM users u') && sql.includes('LEFT JOIN persons')) {
        return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(userRow), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({}) }) };
      }
      if (sql.includes('SELECT person_id FROM users')) {
        return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ person_id: 'person-1' }), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({}) }) };
      }
      if (sql.includes('SELECT s.user_id as id')) {
        return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ id: 'existing-user', first_name: 'Jane' }), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({}) }) };
      }
      return { bind: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }), run: vi.fn().mockResolvedValue({}) }) };
    });
    env.PLATFORM_CONTEXT.db.first = vi.fn().mockImplementation((..._args: unknown[]) => {
      // Fallback for direct .first() chains (prepare().bind() covers most paths)
      return Promise.resolve(null);
    });
    env.PLATFORM_CONTEXT.db.run = vi.fn().mockResolvedValue({});

    const req = makeRequest('POST', {
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Smith',
      admission_date: '2026-09-01',
      program: 'Mathematics',
    });

    const res = await handleCreateStudent(req, env as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });
});

describe('handleUpdateStudent', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
  });

  it('returns 400 when injecting unknown fields (caught by Zod .strict())', async () => {
    const req = makeRequest('PUT', {
      first_name: 'Jane',
      is_admin: true, // Malicious injection
    });
    const res = await handleUpdateStudent(req, env as any, 'student-1');
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/unrecognized key/i);
  });

  it('returns 404 when student not found', async () => {
    env.PLATFORM_CONTEXT.db.first = vi.fn().mockResolvedValue(null);
    const req = makeRequest('PUT', { first_name: 'Jane' });
    const res = await handleUpdateStudent(req, env as any, 'student-1');
    expect(res.status).toBe(404);
  });

  it('returns 200 on success and runs updates', async () => {
    env.PLATFORM_CONTEXT.db.first = vi.fn()
      .mockResolvedValueOnce({ user_id: 'u1' }) // find student
      .mockResolvedValueOnce({ id: 'u1', first_name: 'Jane' }); // return updated
    env.PLATFORM_CONTEXT.db.run = vi.fn().mockResolvedValue({});

    const req = makeRequest('PUT', { first_name: 'Jane', gpa: '3.9' });
    const res = await handleUpdateStudent(req, env as any, 'student-1');
    expect(res.status).toBe(200);
    
    // 1 lookup, 1 update students, 1 update users, 1 fetch
    expect(env.PLATFORM_CONTEXT.db.prepare).toHaveBeenCalledTimes(4);
  });
});

describe('handleDeleteStudent', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
  });

  it('returns 404 when student not found', async () => {
    env.PLATFORM_CONTEXT.db.first = vi.fn().mockResolvedValue(null);
    const req = new Request('http://localhost/api/students/student-1', { method: 'DELETE' });
    const res = await handleDeleteStudent(req, env as any, 'student-1');
    expect(res.status).toBe(404);
  });

  it('returns 200 and runs delete on success', async () => {
    env.PLATFORM_CONTEXT.db.first = vi.fn().mockResolvedValue({ user_id: 'u1' });
    env.PLATFORM_CONTEXT.db.run = vi.fn().mockResolvedValue({});
    const req = new Request('http://localhost/api/students/student-1', { method: 'DELETE' });
    const res = await handleDeleteStudent(req, env as any, 'student-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data?.deleted).toBe(true);
    // Ensure the delete query was prepared
    expect(vi.mocked(env.PLATFORM_CONTEXT.db.prepare).mock.calls.some(c => c[0].includes('DELETE FROM users'))).toBe(true);
  });
});
