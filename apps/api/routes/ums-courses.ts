/**
 * BMI UMS – Courses & Programs Routes
 * Backed by Cloudflare D1. Accessible by admin/staff (write), all authenticated (read).
 */
import { ok, error, json } from '../lib/types';
import type { Env } from '../lib/types';
import { generateRegNo } from '../lib/reg_number';
import { cacheAside, invalidateCachePrefix } from '../lib/cache';

function paginate(url: URL) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const perPage = Math.min(100, parseInt(url.searchParams.get('perPage') || '20'));
  return { page, perPage, offset: (page - 1) * perPage };
}

// ─── list courses ─────────────────────────────────────────────────────────────

export async function handleListUmsCourses(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { page, perPage, offset } = paginate(url);

  const search = url.searchParams.get('search') || '';
  const departmentId = url.searchParams.get('department_id') || '';
  const noCache = url.searchParams.get('no_cache') === '1';
  const cacheKey = `catalog:courses:p${page}:pp${perPage}:s_${search}:d_${departmentId}`;

  // Force-bust the cache for this key family when requested (e.g. after seeding)
  if (noCache) {
    await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:courses:');
  }

  const { data, hit } = await cacheAside(
    noCache ? null : env.PLATFORM_CONTEXT?.kv,
    cacheKey,
    async () => {
      const filters: string[] = [];
      const bindings: unknown[] = [];

      if (search) {
        filters.push(`(c.code LIKE ? OR c.title LIKE ?)`);
        const q = `%${search}%`;
        bindings.push(q, q);
      }
      if (departmentId) { filters.push(`c.department_id = ?`); bindings.push(departmentId); }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const countRow = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as total FROM courses c ${where}`)
        .bind(...bindings).first<{ total: number }>();

      const rows = await env.PLATFORM_CONTEXT!.db.prepare(
        `SELECT c.*, d.name as department_name FROM courses c
         LEFT JOIN departments d ON c.department_id = d.id
         ${where}
         ORDER BY c.code ASC LIMIT ? OFFSET ?`
      ).bind(...bindings, perPage, offset).all();

      return { items: rows.results, page, perPage, total: countRow?.total ?? 0 };
    },
    { ttlSeconds: 3600 }
  );

  const response = ok(data);
  response.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return response;
}

// ─── create course ────────────────────────────────────────────────────────────

export async function handleCreateCourse(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const { code, title, description, credits, term, capacity, department_id } = body as Record<string, string>;

  if (!code || !title || !credits || !term || !capacity) {
    return error('Missing required fields: code, title, credits, term, capacity');
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  await env.PLATFORM_CONTEXT!.db.prepare(
    `INSERT INTO courses (id, code, title, description, credits, term, capacity, department_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, code, title, description || null, parseInt(credits), term, parseInt(capacity), department_id || null).run();

  // Writes go straight to Neon; invalidate the cached course catalog so the
  // next read re-populates it (cache-aside invalidation).
  await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:courses:');

  const created = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM courses WHERE id = ?`).bind(id).first();
  return json({ success: true, data: created }, 201);
}

// ─── update course ────────────────────────────────────────────────────────────

export async function handleUpdateCourse(request: Request, env: Env, courseId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const allowed = ['title', 'description', 'credits', 'term', 'capacity', 'department_id', 'is_active'];
  const updates: string[] = [];
  const vals: unknown[] = [];

  for (const key of allowed) {
    if (body[key] !== undefined) { updates.push(`${key} = ?`); vals.push(body[key]); }
  }
  if (!updates.length) return error('No valid fields to update');

  await env.PLATFORM_CONTEXT!.db.prepare(
    `UPDATE courses SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...vals, courseId).run();

  await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:courses:');

  const updated = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM courses WHERE id = ?`).bind(courseId).first();
  if (!updated) return error('Course not found', 404);
  return ok(updated);
}

// ─── create / update / delete program (admin writes — UI calls these) ─────

// Canonical programs.level values (see packages/shared VALID_LEVELS + all seeds).
// Legacy UI forms submit 'bachelor' / 'master'; normalize on write so the DB
// never drifts from the canonical taxonomy (readers tolerate both spellings,
// but filters, seat maps and reports assume canonical values).
function normalizeProgramLevelInput(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'bachelor' || v === 'bachelors' || v === 'undergrad' || v === 'ug') return 'undergraduate';
  if (v === 'master' || v === 'masters' || v === 'postgraduate' || v === 'grad' || v === 'pg') return 'graduate';
  return v;
}

export async function handleCreateProgram(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim().toUpperCase();
  if (!name || !code) return error('name and code are required', 400);
  const id = String(body.id || crypto.randomUUID());
  const department_id = (body.department_id as string) || (body as any).departmentId || null;
  const level = normalizeProgramLevelInput((body.level as string) || (body.degree_type as string) || 'undergraduate') || 'undergraduate';
  const degreeType = String((body.degree_type as string) || level);
  try {
    await env.PLATFORM_CONTEXT!.db.prepare(
      `INSERT INTO programs (id, name, code, degree_type, level, department_id, duration_years, total_credit_hours, mode_of_study, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(
      id, name, code,
      degreeType,
      level,
      department_id,
      Number((body as any).duration_years ?? 4),
      Number((body as any).total_credit_hours ?? 120),
      (body as any).mode_of_study || 'full_time',
    ).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|unique|duplicate/i.test(msg)) return error('Program code already exists', 409);
    throw e;
  }
  await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:programs');
  const created = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM programs WHERE id = ?`).bind(id).first();
  return json({ success: true, data: created }, 201);
}

export async function handleUpdateProgram(request: Request, env: Env, programId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const allowed = ['name', 'code', 'degree_type', 'level', 'department_id', 'duration_years', 'total_credit_hours', 'mode_of_study', 'description', 'is_active'];
  const updates: string[] = [];
  const vals: unknown[] = [];
  // Normalize legacy level aliases on write (see normalizeProgramLevelInput).
  if (typeof (body as any).level === 'string') {
    (body as any).level = normalizeProgramLevelInput((body as any).level) || (body as any).level;
  }
  for (const key of allowed) {
    if ((body as any)[key] !== undefined) { updates.push(`${key} = ?`); vals.push((body as any)[key]); }
  }
  // tolerate camelCase from UI
  if ((body as any).departmentId !== undefined && (body as any).department_id === undefined) { updates.push(`department_id = ?`); vals.push((body as any).departmentId); }
  if (!updates.length) return error('No valid fields to update', 400);
  updates.push(`updated_at = datetime('now')`);
  try {
    await env.PLATFORM_CONTEXT!.db.prepare(`UPDATE programs SET ${updates.join(', ')} WHERE id = ?`).bind(...vals, programId).run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such column/i.test(msg)) {
      // description/updated_at may not exist on older DBs — retry with core columns only
      const core = allowed.filter(k => !['description', 'updated_at'].includes(k));
      const u2: string[] = []; const v2: unknown[] = [];
      for (const key of core) if ((body as any)[key] !== undefined) { u2.push(`${key} = ?`); v2.push((body as any)[key]); }
      if (!u2.length) return error('No valid fields to update', 400);
      await env.PLATFORM_CONTEXT!.db.prepare(`UPDATE programs SET ${u2.join(', ')} WHERE id = ?`).bind(...v2, programId).run();
    } else throw e;
  }
  await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:programs');
  const updated = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM programs WHERE id = ?`).bind(programId).first();
  if (!updated) return error('Program not found', 404);
  return ok(updated);
}

export async function handleDeleteProgram(_request: Request, env: Env, programId: string): Promise<Response> {
  await env.PLATFORM_CONTEXT!.db.prepare(`DELETE FROM programs WHERE id = ?`).bind(programId).run();
  await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:programs');
  return ok({ deleted: true, id: programId });
}

// ─── delete course ────────────────────────────────────────────────────────────

export async function handleDeleteCourse(_request: Request, env: Env, courseId: string): Promise<Response> {
  const result = await env.PLATFORM_CONTEXT!.db.prepare(`DELETE FROM courses WHERE id = ?`).bind(courseId).run();
  if (!result.meta.changes) return error('Course not found', 404);
  await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:courses:');
  return ok({ deleted: true });
}

// ─── list programs ────────────────────────────────────────────────────────────

export async function handleListPrograms(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { page, perPage, offset } = paginate(url);
  const noCache = url.searchParams.get('no_cache') === '1';
  const cacheKey = `catalog:programs:p${page}:pp${perPage}`;

  if (noCache) {
    await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:programs');
  }

  const { data, hit } = await cacheAside(
    noCache ? null : env.PLATFORM_CONTEXT?.kv,
    cacheKey,
    async () => {
      const rows = await env.PLATFORM_CONTEXT!.db.prepare(
        `SELECT p.*, d.name as department_name, f.name as faculty_name
         FROM programs p
         LEFT JOIN departments d ON p.department_id = d.id
         LEFT JOIN faculties f ON d.faculty_id = f.id
         ORDER BY p.name ASC LIMIT ? OFFSET ?`
      ).bind(perPage, offset).all();

      const countRow = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as total FROM programs`).first<{ total: number }>();
      return { items: rows.results, page, perPage, total: countRow?.total ?? 0 };
    },
    { ttlSeconds: 3600 }
  );

  const response = ok(data);
  response.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return response;
}

// ─── list faculties ───────────────────────────────────────────────────────────

export async function handleListFaculties(_request: Request, env: Env): Promise<Response> {
  const cacheKey = `catalog:faculties:all`;

  const { data, hit } = await cacheAside(
    env.PLATFORM_CONTEXT?.kv,
    cacheKey,
    async () => {
      const rows = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM faculties ORDER BY name ASC`).all();
      return rows.results;
    },
    { ttlSeconds: 86400 }
  );

  const response = ok(data);
  response.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return response;
}

// ─── list departments ─────────────────────────────────────────────────────────

export async function handleListDepartments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const facultyId = url.searchParams.get('faculty_id') || 'all';
  const cacheKey = `catalog:departments:f_${facultyId}`;

  const { data, hit } = await cacheAside(
    env.PLATFORM_CONTEXT?.kv,
    cacheKey,
    async () => {
      const query = facultyId !== 'all'
        ? `SELECT * FROM departments WHERE faculty_id = ? ORDER BY name ASC`
        : `SELECT * FROM departments ORDER BY name ASC`;

      const rows = facultyId !== 'all'
        ? await env.PLATFORM_CONTEXT!.db.prepare(query).bind(facultyId).all()
        : await env.PLATFORM_CONTEXT!.db.prepare(query).all();

      return rows.results;
    },
    { ttlSeconds: 86400 }
  );

  const response = ok(data);
  response.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return response;
}

// ─── list academic terms ──────────────────────────────────────────────────────

export async function handleListTerms(_request: Request, env: Env): Promise<Response> {
  const cacheKey = `catalog:terms:all`;

  const { data, hit } = await cacheAside(
    env.PLATFORM_CONTEXT?.kv,
    cacheKey,
    async () => {
      const rows = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM academic_terms ORDER BY start_date DESC`).all();
      return rows.results;
    },
    { ttlSeconds: 86400 }
  );

  const response = ok(data);
  response.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return response;
}

// ─── admin: create / update academic term (registration window + census) ─────
// Gap 2 fix: census_date / registration_opens_at / registration_closes_at
// previously had no writer, so the nightly census could never run. These two
// handlers are the canonical writers (wired in index.ts as admin-only routes).

function parseOptionalDate(v: unknown): string | null | undefined {
  if (v === undefined) return undefined; // not supplied — leave unchanged
  if (v === null || v === '') return null; // explicit clear
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(v)}`);
  return d.toISOString();
}

function validateTermWindow(args: {
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  census_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}): void {
  const { registration_opens_at: opens, registration_closes_at: closes, census_date: census } = args;
  if (opens && closes && new Date(opens).getTime() >= new Date(closes).getTime()) {
    throw new Error('registration_opens_at must be before registration_closes_at');
  }
  if (closes && census && new Date(closes).getTime() > new Date(census).getTime()) {
    throw new Error('registration_closes_at must be on or before census_date');
  }
  if (args.start_date && args.end_date && new Date(args.start_date).getTime() >= new Date(args.end_date).getTime()) {
    throw new Error('start_date must be before end_date');
  }
}

export async function handleCreateTerm(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const code = String(body.code || '').trim();
    if (!name || !code) return error('name and code are required', 400);
    const academic_year = String(body.academic_year || '').trim();
    const semester_number = Number(body.semester_number ?? 1);
    const status = String(body.status || 'upcoming').trim();
    const allowed = new Set(['upcoming', 'registration', 'active', 'exam', 'grading', 'closed']);
    if (!allowed.has(status)) return error(`Invalid status: ${status}`, 400);

    let start_date: string | null = null;
    let end_date: string | null = null;
    try {
      const s = parseOptionalDate(body.start_date);
      const e = parseOptionalDate(body.end_date);
      start_date = s === undefined ? null : s;
      end_date = e === undefined ? null : e;
      if (!start_date || !end_date) return error('start_date and end_date are required', 400);
    } catch (e: unknown) {
      return error(e instanceof Error ? e.message : 'Invalid term dates', 400);
    }

    let registration_opens_at: string | null = null;
    let registration_closes_at: string | null = null;
    let census_date: string | null = null;
    try {
      const o = parseOptionalDate(body.registration_opens_at);
      const c = parseOptionalDate(body.registration_closes_at);
      const cd = parseOptionalDate(body.census_date);
      registration_opens_at = o === undefined ? null : o;
      registration_closes_at = c === undefined ? null : c;
      census_date = cd === undefined ? null : cd;
      validateTermWindow({ registration_opens_at, registration_closes_at, census_date, start_date, end_date });
    } catch (e: unknown) {
      return error(e instanceof Error ? e.message : 'Invalid registration window', 400);
    }

    const id = String(body.id || crypto.randomUUID());
    try {
      await env.PLATFORM_CONTEXT!.db.prepare(
        `INSERT INTO academic_terms
         (id, name, code, academic_year, semester_number, start_date, end_date, status,
          registration_opens_at, registration_closes_at, census_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, name, code, academic_year, semester_number, start_date, end_date, status,
        registration_opens_at, registration_closes_at, census_date,
      ).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Pre-migration DBs lack the window columns — fall back to the base
      // columns so term creation still works, then report the gap.
      if (/no such column|no column named|undefined column/i.test(msg)) {
        await env.PLATFORM_CONTEXT!.db.prepare(
          `INSERT INTO academic_terms
           (id, name, code, academic_year, semester_number, start_date, end_date, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, name, code, academic_year, semester_number, start_date, end_date, status).run();
        return json({ success: true, data: { id }, warning: 'Term created without window columns (DB pre-migration 0048)' }, 201);
      }
      if (/UNIQUE|unique|duplicate/i.test(msg)) return error('Term code already exists', 409);
      throw e;
    }
    await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:terms');
    const created = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM academic_terms WHERE id = ?`).bind(id).first().catch(() => ({ id }));
    return json({ success: true, data: created }, 201);
  } catch (e: unknown) {
    return error(e instanceof Error ? e.message : 'Failed to create term', 500);
  }
}

export async function handleUpdateTerm(request: Request, env: Env, termId: string): Promise<Response> {
  try {
    if (!termId) return error('term id is required', 400);
    const body = (await request.json()) as Record<string, unknown>;
    const db = env.PLATFORM_CONTEXT!.db;

    const existing = await db.prepare(`SELECT * FROM academic_terms WHERE id = ?`).bind(termId).first<Record<string, any>>().catch(() => null);
    if (!existing) return error('Academic term not found', 404);

    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'code', 'academic_year', 'semester_number', 'status', 'start_date', 'end_date', 'registration_opens_at', 'registration_closes_at', 'census_date']) {
      if (k in body) patch[k] = (body as any)[k];
    }
    if (Object.keys(patch).length === 0) return error('No updatable fields supplied', 400);

    if (patch.status !== undefined) {
      const allowed = new Set(['upcoming', 'registration', 'active', 'exam', 'grading', 'closed']);
      if (!allowed.has(String(patch.status))) return error(`Invalid status: ${String(patch.status)}`, 400);
    }

    // Normalize date fields (explicit null clears the column).
    try {
      for (const k of ['start_date', 'end_date', 'registration_opens_at', 'registration_closes_at', 'census_date']) {
        if (k in patch) {
          const v = parseOptionalDate((patch as any)[k]);
          (patch as any)[k] = v === undefined ? existing[k] ?? null : v;
        }
      }
      validateTermWindow({
        registration_opens_at: ((patch as any).registration_opens_at ?? (existing as any).registration_opens_at ?? null) as string | null,
        registration_closes_at: ((patch as any).registration_closes_at ?? (existing as any).registration_closes_at ?? null) as string | null,
        census_date: ((patch as any).census_date ?? (existing as any).census_date ?? null) as string | null,
        start_date: ((patch as any).start_date ?? (existing as any).start_date ?? null) as string | null,
        end_date: ((patch as any).end_date ?? (existing as any).end_date ?? null) as string | null,
      });
    } catch (e: unknown) {
      return error(e instanceof Error ? e.message : 'Invalid term dates', 400);
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
    vals.push(termId);
    try {
      await db.prepare(`UPDATE academic_terms SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no such column|no column named|undefined column/i.test(msg)) {
        return error('Term window columns missing — apply migration 0048 first', 500);
      }
      if (/UNIQUE|unique|duplicate/i.test(msg)) return error('Term code already exists', 409);
      throw e;
    }
    await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:terms');
    const updated = await db.prepare(`SELECT * FROM academic_terms WHERE id = ?`).bind(termId).first().catch(() => null);
    return ok(updated);
  } catch (e: unknown) {
    return error(e instanceof Error ? e.message : 'Failed to update term', 500);
  }
}

// ─── admin: course completion (Gap 1 writer) ─────────────────────────────────
// Canonical writer for student_course_registrations.status = 'completed'.
// Without this, prerequisite validation could never pass.

export async function handleCompleteCourseRegistration(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { student_id?: string; course_id?: string; term_id?: string; passed?: boolean; grade_percent?: number };
    if (!body.student_id || !body.course_id || !body.term_id) {
      return error('student_id, course_id and term_id are required', 400);
    }
    let passed = body.passed;
    if (passed === undefined && body.grade_percent !== undefined) {
      passed = Number(body.grade_percent) >= 40;
    }
    if (passed === undefined) return error('passed or grade_percent is required', 400);
    const { markCourseCompletion } = await import('../lib/course-completion');
    const res = await markCourseCompletion(env.PLATFORM_CONTEXT!.db, {
      studentId: body.student_id,
      courseId: body.course_id,
      termId: body.term_id,
      passed: !!passed,
    });
    return ok(res);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to complete registration';
    if (/not found/i.test(msg)) return error(msg, 404);
    if (/Cannot complete/i.test(msg)) return error(msg, 409);
    return error(msg, 500);
  }
}

export async function handleCloseTermWithCompletions(_request: Request, env: Env, termId: string): Promise<Response> {
  try {
    if (!termId) return error('term id is required', 400);
    const db = env.PLATFORM_CONTEXT!.db;
    const term = await db.prepare(`SELECT id, status FROM academic_terms WHERE id = ?`).bind(termId).first<{ id: string; status: string }>().catch(() => null);
    if (!term) return error('Academic term not found', 404);
    const { finalizeTermCompletions } = await import('../lib/course-completion');
    const result = await finalizeTermCompletions(db, termId);
    // Mark the term closed only after completions are written.
    await db.prepare(`UPDATE academic_terms SET status = 'closed' WHERE id = ?`).bind(termId).run().catch(() => null);
    await invalidateCachePrefix(env.PLATFORM_CONTEXT?.kv, 'catalog:terms');
    return ok(result);
  } catch (e: unknown) {
    return error(e instanceof Error ? e.message : 'Failed to close term', 500);
  }
}

// ─── enrollments ──────────────────────────────────────────────────────────────

export async function handleListEnrollments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const studentId = url.searchParams.get('studentId');
  const courseId = url.searchParams.get('courseId');

  const filters: string[] = [];
  const bindings: unknown[] = [];

  if (studentId) { filters.push(`e.student_id = ?`); bindings.push(studentId); }
  if (courseId) { filters.push(`e.course_id = ?`); bindings.push(courseId); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const rows = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT e.*, c.code as course_code, c.title as course_name, c.credits,
            u.first_name, u.last_name, s.reg_no
     FROM enrollments e
     INNER JOIN courses c ON e.course_id = c.id
     INNER JOIN students s ON e.student_id = s.user_id
     INNER JOIN users u ON s.user_id = u.id
     ${where}
     ORDER BY e.enrolled_at DESC`
  ).bind(...bindings).all();

  return ok(rows.results);
}

export async function handleCreateEnrollment(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const { student_id, course_id, term_id } = body as Record<string, string>;

  if (!student_id || !course_id) return error('student_id and course_id are required');

  // ── Resolve student → program → career for RegNo generation ──────────────
  const studentInfo = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT s.user_id, s.program_id, s.reg_no,
            u.person_id, p.uid,
            pr.code as program_code, pr.level as career
     FROM students s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN persons p ON u.person_id = p.id
     LEFT JOIN programs pr ON s.program_id = pr.id
     WHERE s.user_id = ?`
  ).bind(student_id).first<{
    user_id: string;
    program_id: string | null;
    reg_no: string | null;
    person_id: string | null;
    uid: string | null;
    program_code: string | null;
    career: string | null;
  }>();

  if (!studentInfo) return error('Student not found', 404);

  const enrollmentId = crypto.randomUUID().replace(/-/g, '');

  // Determine admission year from the term or fall back to current year
  let admissionYear = new Date().getUTCFullYear();
  if (term_id) {
    const term = await env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT academic_year FROM academic_terms WHERE id = ?`
    ).bind(term_id).first<{ academic_year: string }>();
    if (term?.academic_year) {
      const parsed = parseInt(term.academic_year.split('/')[0] ?? term.academic_year);
      if (!isNaN(parsed)) admissionYear = parsed;
    }
  }

  // ── Generate Registration Number if student has a program and no reg_no yet ─
  let regNo: string | null = studentInfo.reg_no;
  const batchOps: { sql: string; params: unknown[] }[] = [
    {
      sql: `INSERT INTO enrollments (id, student_id, course_id, term_id) VALUES (?, ?, ?, ?)`,
      params: [enrollmentId, student_id, course_id, term_id || null]
    }
  ];

  if (
    !regNo &&
    studentInfo.program_id &&
    studentInfo.program_code &&
    studentInfo.career &&
    studentInfo.uid
  ) {
    try {
      regNo = await generateRegNo(
        env.PLATFORM_CONTEXT!.db,
        studentInfo.program_id,
        studentInfo.program_code,
        admissionYear,
        studentInfo.career
      );

      batchOps.push({
        sql: `UPDATE students SET previous_reg_no = reg_no, updated_at = datetime('now')
              WHERE user_id = ? AND reg_no IS NOT NULL AND reg_no != '' AND previous_reg_no IS NULL`,
        params: [student_id]
      });

      batchOps.push({
        sql: `UPDATE students SET reg_no = ?, updated_at = datetime('now')
              WHERE user_id = ? AND (reg_no IS NULL OR reg_no NOT LIKE 'BMI/%')`,
        params: [regNo, student_id]
      });

      batchOps.push({
        sql: `UPDATE student_programs
              SET registration_number = ?, updated_at = datetime('now')
              WHERE uid = ? AND current_flag = 1 AND registration_number IS NULL`,
        params: [regNo, studentInfo.uid]
      });
    } catch (e) {
      console.error('[reg_number] Failed to generate registration number:', e);
      regNo = null;
    }
  }

  // Execute enrollment (+ optional reg_no updates) atomically
  await env.PLATFORM_CONTEXT!.db.transaction(async (tx) => {
    for (const op of batchOps) {
      await tx.prepare(op.sql).bind(...op.params).run();
    }
  });

  const created = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM enrollments WHERE id = ?`).bind(enrollmentId).first();
  return json({ success: true, data: { ...created, registration_number: regNo } }, 201);
}
