/**
 * BMI UMS – Stats & Catalog Routes
 * Computed analytics endpoints + catalog lookups for faculties/departments/programs.
 */
import { ok, error, typedJson } from '../lib/types';
import type { Env } from '../lib/types';

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG (faculties, departments, programs) — used by forms/dropdowns
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleCatalogFaculties(_request: Request, env: Env): Promise<Response> {
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT id, name, code, description, is_active FROM faculties WHERE is_active=1 ORDER BY name`).all();
  return ok(results);
}

export async function handleCatalogDepartments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const facultyId = url.searchParams.get('facultyId');
  let query = `SELECT id, name, code, faculty_id, description, is_active FROM departments WHERE is_active=1`;
  const bindings: unknown[] = [];
  if (facultyId) { query += ` AND faculty_id = ?`; bindings.push(facultyId); }
  query += ` ORDER BY name`;
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(query).bind(...bindings).all();
  return ok(results);
}

export async function handleCatalogPrograms(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const deptId = url.searchParams.get('deptId') || url.searchParams.get('department_id');
  let query = `SELECT id, name, code, degree_type, level, department_id, duration_years, total_credit_hours, mode_of_study, is_active FROM programs WHERE is_active=1`;
  const bindings: unknown[] = [];
  if (deptId) { query += ` AND department_id = ?`; bindings.push(deptId); }
  query += ` ORDER BY name`;
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(query).bind(...bindings).all();
  return ok(results);
}

export async function handleCatalogTerms(_request: Request, env: Env): Promise<Response> {
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT * FROM academic_terms ORDER BY start_date DESC`).all();
  return ok(results);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS OVERVIEW ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleStudentStatsOverview(_request: Request, env: Env): Promise<Response> {
  const total     = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM students`).first<{c:number}>())?.c || 0;
  const active    = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM students WHERE status='Active'`).first<{c:number}>())?.c || 0;
  const inactive  = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM students WHERE status='Inactive'`).first<{c:number}>())?.c || 0;
  const graduated = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM students WHERE status='Graduated'`).first<{c:number}>())?.c || 0;
  const applicants= (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM students WHERE status='Applicant'`).first<{c:number}>())?.c || 0;
  const suspended = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM students WHERE status='Suspended'`).first<{c:number}>())?.c || 0;
  const byGender  = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT gender, COUNT(*) as count FROM students s INNER JOIN users u ON s.user_id=u.id GROUP BY gender`).all();
  return ok({ total, active, inactive, graduated, applicants, suspended, byGender: byGender.results });
}

export async function handleStaffStatsOverview(_request: Request, env: Env): Promise<Response> {
  const total = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM staff`).first<{c:number}>())?.c || 0;
  const byDept = await env.PLATFORM_CONTEXT!.db.prepare(`SELECT d.name as department, COUNT(*) as count FROM staff s LEFT JOIN departments d ON s.department_id=d.id GROUP BY s.department_id ORDER BY count DESC LIMIT 10`).all();
  return ok({ total, byDepartment: byDept.results });
}

export async function handleCourseStatsOverview(_request: Request, env: Env): Promise<Response> {
  const total      = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM courses`).first<{c:number}>())?.c || 0;
  const published  = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM courses WHERE status='Published'`).first<{c:number}>())?.c || 0;
  const draft      = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM courses WHERE status='Draft'`).first<{c:number}>())?.c || 0;
  const enrollments= (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM enrollments WHERE status='enrolled'`).first<{c:number}>())?.c || 0;
  return ok({ total, published, draft, enrollments });
}

export async function handleFinanceStats(_request: Request, env: Env): Promise<Response> {
  const totalInvoices = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM invoices`).first<{c:number}>())?.c || 0;
  const totalRevenue  = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM invoices WHERE status='paid'`).first<{s:number}>())?.s || 0;
  const outstanding   = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM invoices WHERE status='unpaid'`).first<{s:number}>())?.s || 0;
  const paid          = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE status='paid'`).first<{c:number}>())?.c || 0;
  const unpaid        = (await env.PLATFORM_CONTEXT!.db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE status='unpaid'`).first<{c:number}>())?.c || 0;
  return ok({ totalInvoices, totalRevenue, outstanding, paid, unpaid });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CERTIFICATE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

interface CertificateRow {
  id: string;
  serial_number: string;
  verification_count: number;
  status?: string;
  content_hash?: string;
  student_name?: string;
  degree_title?: string;
  issue_date?: string;
  gpa?: string;
  user_id?: string;
  student_id?: string;
  [key: string]: unknown;
}

function logVerification(env: Env, entry: {
  certificateId: string | null;
  serial: string;
  studentName: string | null;
  result: 'valid' | 'invalid' | 'revoked';
  method: string;
  ip?: string;
  location?: string;
  userAgent?: string;
}): void {
  try {
    env.PLATFORM_CONTEXT!.db.prepare(
      `INSERT INTO verification_logs (id, certificate_id, serial_number, student_name, result, method, ip_address, location, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      entry.certificateId,
      entry.serial,
      entry.studentName,
      entry.result,
      entry.method,
      entry.ip || null,
      entry.location || null,
      entry.userAgent || null
    ).run().catch(e => console.error('Failed to write verification log:', e));
  } catch (e) {
    // Never let a ledger write failure break certificate verification.
    console.error('Failed to write verification log:', e);
  }
}

export async function handleVerifyCertificate(request: Request, env: Env): Promise<Response> {
  const body = await typedJson<{ serial?: string; serial_number?: string; method?: string; hash?: string }>(request).catch(() => ({} as Record<string, unknown>)) as { serial?: string; serial_number?: string; method?: string; hash?: string };
  const serial = body.serial || body.serial_number;
  if (!serial) return error('Serial number is required', 400);

  const method = ['online', 'offline', 'qr_scan'].includes(body.method || '') ? body.method! : 'online';
  const cfIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || undefined;
  const cfCountry = request.headers.get('CF-IPCountry') || undefined;
  const userAgent = request.headers.get('User-Agent') || undefined;

  const cert = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT c.*, u.first_name || ' ' || u.last_name as student_name
     FROM certificates c LEFT JOIN users u ON c.student_id = u.id
     WHERE c.serial_number = ?`
  ).bind(serial).first<CertificateRow>();

  if (!cert) {
    logVerification(env, {
      certificateId: null, serial, studentName: null,
      result: 'invalid', method, ip: cfIp, location: cfCountry, userAgent,
    });
    return ok({ valid: false, error: 'Certificate not found', code: 'NOT_FOUND' });
  }

  const result: 'valid' | 'revoked' | 'invalid' =
    cert.status === 'ISSUED' ? 'valid' : cert.status === 'REVOKED' ? 'revoked' : 'invalid';

  logVerification(env, {
    certificateId: cert.id, serial, studentName: cert.student_name || null,
    result, method, ip: cfIp, location: cfCountry, userAgent,
  });

  await env.PLATFORM_CONTEXT!.db.prepare(`UPDATE certificates SET verification_count = verification_count + 1, updated_at=datetime('now') WHERE id=?`).bind(cert.id).run();

  return ok({
    valid: cert.status === 'ISSUED',
    certificate: {
      serial_number: cert.serial_number,
      student_name: cert.student_name || null,
      degree_title: cert.degree_title || null,
      issue_date: cert.issue_date || null,
      gpa: cert.gpa || null,
      status: cert.status || null,
    },
    verification: {
      timestamp: new Date().toISOString(),
      method,
      hash_verified: body.hash ? body.hash === cert.content_hash : false,
      verification_count: (cert.verification_count || 0) + 1,
    }
  });
}

export async function handleCertificateVerificationStats(_request: Request, env: Env): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;

  const certTotal = (await db.prepare(`SELECT COUNT(*) as c FROM certificates`).first<{ c: number }>())?.c || 0;
  const issued = (await db.prepare(`SELECT COUNT(*) as c FROM certificates WHERE status='ISSUED'`).first<{ c: number }>())?.c || 0;
  const revoked = (await db.prepare(`SELECT COUNT(*) as c FROM certificates WHERE status='REVOKED'`).first<{ c: number }>())?.c || 0;
  const suspended = (await db.prepare(`SELECT COUNT(*) as c FROM certificates WHERE status='SUSPENDED'`).first<{ c: number }>())?.c || 0;
  const totalVerifications = (await db.prepare(`SELECT COALESCE(SUM(verification_count),0) as s FROM certificates`).first<{ s: number }>())?.s || 0;

  // ── Activity metrics from the verification_logs ledger ───────────────────────
  const today = (await db.prepare(`SELECT COUNT(*) as c FROM verification_logs WHERE date(created_at) = date('now')`).first<{ c: number }>())?.c || 0;
  const thisMonth = (await db.prepare(`SELECT COUNT(*) as c FROM verification_logs WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`).first<{ c: number }>())?.c || 0;
  const successTotal = (await db.prepare(`SELECT COUNT(*) as c FROM verification_logs WHERE result='valid'`).first<{ c: number }>())?.c || 0;
  const loggedTotal = (await db.prepare(`SELECT COUNT(*) as c FROM verification_logs`).first<{ c: number }>())?.c || 0;
  const uniqueVerifiers = (await db.prepare(`SELECT COUNT(DISTINCT ip_address) as c FROM verification_logs WHERE ip_address IS NOT NULL`).first<{ c: number }>())?.c || 0;
  const successRate = loggedTotal > 0 ? Math.round((successTotal / loggedTotal) * 1000) / 10 : 0;

  const byMethod: Record<string, number> = {};
  const methodRows = await db.prepare(`SELECT method, COUNT(*) as c FROM verification_logs GROUP BY method`).all<{ method: string; c: number }>();
  for (const r of methodRows.results) byMethod[r.method] = r.c;

  const byFaculty: Record<string, number> = {};
  const facultyRows = await db.prepare(
    `SELECT COALESCE(s.program, c.degree_title, 'Other') AS label, COUNT(*) AS c
     FROM certificates c
     LEFT JOIN users u ON c.student_id = u.id
     LEFT JOIN students s ON u.id = s.user_id
     GROUP BY label
     ORDER BY c DESC
     LIMIT 20`
  ).all<{ label: string; c: number }>();
  for (const r of facultyRows.results) byFaculty[r.label] = r.c;

  return ok({
    total: certTotal,
    issued,
    revoked,
    suspended,
    totalVerifications,
    activity: { today, this_month: thisMonth, success_rate: successRate, unique_verifiers: uniqueVerifiers },
    by_method: byMethod,
    by_faculty: byFaculty,
  });
}
