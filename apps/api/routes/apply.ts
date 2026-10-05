import type { IDatabase } from '@bmi/ports';
import { ok, error, logAdminAction } from '../lib/types';
import {
  applicationSubmittedEmail,
  statusUpdateEmail,
  isValidEmail,
  generateTraceId,
  buildEmailLayout,
  safeDispatchEmail,
} from '../lib/email';
import type { Env } from '../lib/types';
import { dispatchWebhook } from '../lib/webhook';
import { generateApplicationNumber } from '../lib/app_number';
import { getLifecycleHistory } from '../lib/lifecycle';
import { parseBody, SubmitApplicationSchema, ApplicationDraftSchema, normalizeDegreeLevel, VALID_DEGREE_LEVELS } from '../lib/schemas';
import { executeWithMonitoring } from '../lib/performance';
import { createCoreDb, setRequestContext, isNeon } from '../lib/db';
import { users } from '../schema/core';
import { eq } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';

/**
 * Resolve a program to its canonical { id, name } against the SINGLE SOURCE
 * OF TRUTH — the programs DB table. program_id is authoritative; a legacy
 * program name is resolved to its id for backwards compatibility.
 */
async function resolveProgram(
  env: Env,
  input: { program?: string; program_id?: string }
): Promise<{ id: string; name: string } | null> {
  const db = env.PLATFORM_CONTEXT!.db;
  if (input.program_id) {
    const trimmedId = input.program_id.trim();
    const row = await db.prepare(
      `SELECT id, name FROM programs WHERE (id = ? OR code = ? OR LOWER(name) = LOWER(?)) AND is_active = 1 LIMIT 1`,
    ).bind(trimmedId, trimmedId, trimmedId).first<{ id: string; name: string }>();
    if (row) return row;
    // Fall through to name lookup: offline fallback catalogs reuse the
    // label as id, so an unknown id with a valid name must still resolve.
  }
  if (input.program) {
    const trimmedName = input.program.trim();
    const row = await db.prepare(
      `SELECT id, name FROM programs WHERE (LOWER(name) = LOWER(?) OR LOWER(code) = LOWER(?) OR id = ?) AND is_active = 1 LIMIT 1`,
    ).bind(trimmedName, trimmedName, trimmedName).first<{ id: string; name: string }>();
    if (row) return row;
    return null;
  }
  return null;
}

function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export async function handleSubmitApplication(request: Request, env: Env, userId: string, ctx?: ExecutionContext): Promise<Response> {
  const startTime = performance.now();

  const parsed = await parseBody(request, SubmitApplicationSchema);
  if (parsed instanceof Response) return parsed;

  const { program, program_id, degree_level, personal_statement, prior_education, date_of_birth, nationality, address, gender, high_school, graduation_year, gpa } = parsed;

  const resolved = await resolveProgram(env, {
    program: program || undefined,
    program_id: program_id || undefined,
  });
  if (!resolved) {
    return error('Invalid program selected', 400);
  }
  const programName = resolved.name;
  const programId = resolved.id;

  const db = env.PLATFORM_CONTEXT!.db;

  const [existingApp, maxApps, deadline] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM applications WHERE user_id = ? AND status NOT IN (\'rejected\', \'draft\')').bind(userId).first<{ count: number }>(),
    db.prepare('SELECT value FROM app_config WHERE key = \'max_applications_per_user\'').first<{ value: string }>(),
    db.prepare('SELECT value FROM app_config WHERE key = \'application_deadline\'').first<{ value: string }>()
  ]);

  const existing = existingApp?.count || 0;
  if (existing > 0) {
    return error('You already have an active application. Please contact admissions to submit a new one.', 409);
  }

  const maxAppsConfig = maxApps?.value;
  if (maxAppsConfig) {
    const totalCountResult = await db.prepare('SELECT COUNT(*) as count FROM applications WHERE user_id = ? AND status NOT IN (\'draft\')').bind(userId).first<{ count: number }>();
    const totalApps = totalCountResult?.count || 0;

    if (totalApps >= parseInt(maxAppsConfig)) {
      return error(`You have reached the maximum of ${maxAppsConfig} applications allowed per user.`, 403);
    }
  }

  const deadlineConfig = deadline?.value;
  if (deadlineConfig) {
    const deadlineDate = new Date(deadlineConfig);
    if (new Date() > deadlineDate) {
      return error('The application deadline has passed.', 403);
    }
  }

  // Clean up any existing auto-created or manual draft applications before creating the submitted record
  try {
    await db.prepare('DELETE FROM applications WHERE user_id = ? AND status = \'draft\'').bind(userId).run();
  } catch (e) {
    console.warn('[apply] Clean up existing draft application skipped:', e);
  }

  const appId = crypto.randomUUID();
  const sanitizedStatement = personal_statement ? sanitizeHtml(personal_statement) : null;
  const sanitizedEducation = prior_education ? sanitizeHtml(prior_education) : null;

  // Generate the official application number INSIDE the submission path so the
  // applicant never sees "PENDING". Counter increment is atomic (single UPSERT).
  const year = new Date().getUTCFullYear();
  let applicationNumber: string;
  try {
    applicationNumber = await generateApplicationNumber(db, year);
  } catch (e) {
    console.error('Application number generation failed:', e);
    return error('Failed to submit application. Please try again.');
  }

  try {
    await createApplicationWithDependenciesOptimized(db, {
      appId,
      userId,
      program: programName,
      programId,
      degreeLevel: degree_level,
      personalStatement: sanitizedStatement ?? undefined,
      priorEducation: sanitizedEducation ? JSON.stringify(sanitizedEducation) : undefined,
      dateOfBirth: date_of_birth,
      nationality,
      address: address || undefined,
      gender,
      highSchool: high_school || undefined,
      graduationYear: graduation_year != null ? Number(graduation_year) : undefined,
      gpa: gpa != null ? Number(gpa) : undefined,
      applicationNumber,
    });
  } catch (e) {
    console.error('Application creation failed:', e);
    return error('Failed to submit application. Please try again.');
  }

  // Delete draft upon successful submission
  const deleteDraft = async () => {
    try {
      await db.prepare('DELETE FROM application_drafts WHERE user_id = ?').bind(userId).run();
    } catch (e) {
      console.error('[draft] Failed to delete draft:', e);
    }
  };

  // Async operations for non-critical tasks only (notifications + draft cleanup).
  // Application number is already assigned transactionally above — no background minting.
  const runBgTasks = async () => {
    const promises: Promise<unknown>[] = [deleteDraft()];

    promises.push(
      sendApplicationNotificationsOptimized(env, userId, programName, appId, applicationNumber)
        .catch(e => console.error('[email] Background notification failed:', e))
    );

    await Promise.allSettled(promises);
  };

  if (ctx) {
    ctx.waitUntil(runBgTasks());
  } else {
    await runBgTasks();
  }

  const duration = performance.now() - startTime;
  if (duration > 800) {
    console.warn(`Slow application submission detected: ${duration}ms for user ${userId}`);
  }

    // Section 17: On application submission, issue idempotent Application Fee invoice ($4 USD / KES equivalent)
    let applicationInvoice: any = null;
    try {
      const { createApplicationFeeInvoice } = await import('../lib/finance/fee-engine');
      applicationInvoice = await createApplicationFeeInvoice(db, userId, undefined, 'KE');
    } catch (e) {
      console.warn('[apply] Application fee invoice generation skipped/failed:', e);
    }

    return ok({
      application_id: appId,
      application_number: applicationNumber,
      status: 'submitted',
      invoice_id: applicationInvoice?.id,
      invoice_number: applicationInvoice?.invoice_number,
      _perf: { duration_ms: Math.round(duration) }
    });
  }

export async function handleSaveDraft(request: Request, env: Env, userId: string): Promise<Response> {
  const parsed = await parseBody(request, ApplicationDraftSchema);
  if (parsed instanceof Response) return parsed;

  const { current_step, application_data } = parsed;

  // Enforce 60-second cooldown
  const existing = await env.PLATFORM_CONTEXT!.db.prepare(
    'SELECT updated_at FROM application_drafts WHERE user_id = ?'
  ).bind(userId).first<{ updated_at: string }>();

  if (existing && existing.updated_at) {
    // SQLite datetime is UTC: '2026-07-06 16:22:26'
    // To safely parse in JS, append 'Z'
    const updatedStr = existing.updated_at.replace(' ', 'T') + 'Z';
    const secondsSinceLastUpdate = (Date.now() - new Date(updatedStr).getTime()) / 1000;

    if (secondsSinceLastUpdate < 60) {
      return ok({ message: 'Draft saved (cooldown)', throttled: true });
    }
  }

  // Insert or Update the draft
  await executeWithMonitoring(
    env.PLATFORM_CONTEXT!.db.prepare(`
      INSERT INTO application_drafts (user_id, application_data, current_step, updated_at, created_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET 
        application_data = excluded.application_data,
        current_step = excluded.current_step,
        updated_at = datetime('now')
    `).bind(userId, JSON.stringify(application_data), current_step),
    'save_application_draft'
  );

  return ok({ message: 'Draft saved successfully', throttled: false });
}


// Optimized application creation with enhanced batching + ACID transaction wrapper
async function createApplicationWithDependenciesOptimized(
  db: IDatabase,
  applicationData: {
    appId: string;
    userId: string;
    program: string;
    programId?: string;
    degreeLevel: string;
    personalStatement?: string;
    priorEducation?: string;
    dateOfBirth?: string;
    nationality?: string;
    address?: string;
    gender?: string;
    highSchool?: string;
    graduationYear?: number;
    gpa?: number;
    applicationNumber?: string;
  }
): Promise<string> {
  const { appId, userId, program, programId, degreeLevel, personalStatement, priorEducation, dateOfBirth, nationality, address, gender, highSchool, graduationYear, gpa, applicationNumber } = applicationData;

  await db.transaction(async (tx) => {
    // 1. Update user's personal info
    await tx.prepare(
      `UPDATE users SET date_of_birth = ?, nationality = ?, address = ?, gender = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(dateOfBirth ?? null, nationality ?? null, address ?? null, gender ?? null, userId).run();

    // 2. Main application record with official reference number assigned atomically.
    //    The number is minted before this transaction via an atomic counter UPSERT,
    //    then persisted here so the applicant never sees "PENDING".
    //    program_id is canonical; program (name) is denormalized display.
    //    Column may not exist until migration 0043 — fall back gracefully.
    try {
      await tx.prepare(
        `INSERT INTO applications (id, user_id, program, program_id, degree_level, status, personal_statement, prior_education, high_school, graduation_year, gpa, application_number, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`
      ).bind(appId, userId, program, programId ?? null, degreeLevel, personalStatement ?? null, priorEducation ?? null, highSchool ?? null, graduationYear ?? null, gpa ?? null, applicationNumber ?? null).run();
    } catch {
      await tx.prepare(
        `INSERT INTO applications (id, user_id, program, degree_level, status, personal_statement, prior_education, high_school, graduation_year, gpa, application_number, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`
      ).bind(appId, userId, program, degreeLevel, personalStatement ?? null, priorEducation ?? null, highSchool ?? null, graduationYear ?? null, gpa ?? null, applicationNumber ?? null).run();
    }

    // 3. Initial status log with timestamp
    await tx.prepare(
      `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
       VALUES (?, ?, ?, NULL, 'submitted', 'Initial submission', datetime('now'))`
    ).bind(crypto.randomUUID(), appId, userId).run();

    // 4. Clean up server-side draft atomically with submission (authoritative draft).
    try {
      await tx.prepare('DELETE FROM application_drafts WHERE user_id = ?').bind(userId).run();
    } catch {
      // Draft table may not exist in some test envs — submission itself must still succeed.
    }
  });

  return appId;
}

// Optimized notification email sending — per-email independent failure handling
async function sendApplicationNotificationsOptimized(
  env: Env,
  userId: string,
  program: string,
  appId: string,
  applicationNumber?: string | null
): Promise<void> {

  type UserRow = { email: string; first_name: string };
  const user = await env.PLATFORM_CONTEXT!.db
    .prepare('SELECT email, first_name FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow>();
  if (!user) {
    console.warn('[email:apply] No user found for notifications, userId=', userId);
    return;
  }
  if (!isValidEmail(user.email)) {
    console.warn('[email:apply] Invalid user email, skipping:', user.email);
    return;
  }

  const refNumber = applicationNumber ?? appId;

  // 1. Applicant confirmation
  try {
    await safeDispatchEmail(env, undefined, {
      to: user.email,
      subject: 'BMI University — Application Received',
      html: applicationSubmittedEmail(user.first_name, program, refNumber),
      templateName: 'application_submitted',
      context: { action: 'application_submitted', user_id: userId, application_id: appId },
    });
  } catch (e) {
    console.error('[email:apply] Applicant notification failed for', user.email, ':', e);
  }

  // 2. Admin notification
  if (env.ADMIN_EMAIL && isValidEmail(env.ADMIN_EMAIL)) {
    try {
      const { adminNewApplicationNoticeEmail } = await import('../lib/email');
      await safeDispatchEmail(env, undefined, {
        to: env.ADMIN_EMAIL,
        subject: `New Application — ${user.first_name} for ${program}`,
        html: adminNewApplicationNoticeEmail(
          user.first_name,
          user.email,
          program,
          appId,
          'Self-submitted'
        ),
        templateName: 'admin_new_application_notice',
        context: { action: 'admin_new_application', application_id: appId },
      });
    } catch (e) {
      console.error('[email:apply] Admin notification failed:', e);
    }
  }
}

export async function handleGetMyApplication(_request: Request, env: Env, userId: string): Promise<Response> {
  const app = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT a.*, 
       (SELECT json_group_array(json_object('id', d.id, 'doc_type', d.doc_type, 'file_name', d.file_name, 'uploaded_at', d.uploaded_at))
        FROM documents d WHERE d.application_id = a.id) as documents
     FROM applications a WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 1`
  ).bind(userId).first<Record<string, unknown>>();

  if (!app) return error('No application found', 404);

  // D1 json_group_array returns a JSON string — parse it into a real array
  if (typeof app.documents === 'string') {
    try {
      app.documents = JSON.parse(app.documents);
    } catch {
      app.documents = [];
    }
  }
  if (!Array.isArray(app.documents)) app.documents = [];

  return ok(app);
}


export async function handleListApplications(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

  let query = `SELECT a.id, a.program, a.degree_level, a.status, a.submitted_at, a.created_at,
                      u.first_name, u.last_name, u.email
               FROM applications a JOIN users u ON a.user_id = u.id`;
  const bindings: unknown[] = [];

  if (status && ['draft', 'submitted', 'under_review', 'accepted', 'rejected', 'waitlisted'].includes(status)) {
    query += ' WHERE a.status = ?';
    bindings.push(status);
  }

  query += ' ORDER BY a.submitted_at DESC LIMIT ? OFFSET ?';
  bindings.push(limit, offset);

  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(query).bind(...bindings).all();
  return ok(results);
}

export async function handleGetApplication(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const appId = url.pathname.split('/')[4];

  const app = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT a.*, u.first_name, u.last_name, u.email, u.phone, u.date_of_birth, u.nationality, u.address, u.gender,
       (SELECT json_group_array(json_object('id', d.id, 'doc_type', d.doc_type, 'file_name', d.file_name, 'uploaded_at', d.uploaded_at))
        FROM documents d WHERE d.application_id = a.id OR d.user_id = a.user_id) as documents
     FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`
  ).bind(appId).first<Record<string, unknown>>();

  if (!app) return error('Application not found', 404);

  if (typeof app.documents === 'string') {
    try {
      app.documents = JSON.parse(app.documents);
    } catch {
      app.documents = [];
    }
  }
  if (!Array.isArray(app.documents)) app.documents = [];

  return ok(app);
}

export async function handleUpdateStatus(
  request: Request,
  env: Env,
  appId: string,
  adminId: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const traceId = (request.headers.get('X-Trace-Id') as string | undefined) || generateTraceId();

  let body: { status: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  const { status, notes } = body;
  // Canonical lifecycle: formal admissions decisions (POST /api/admissions/decide)
  // are the SOLE authority for offers. This legacy status endpoint must never
  // create an "accepted" student state or trigger provisioning.
  // Allowed here: triage only (submitted / under_review / rejected / waitlisted).
  const validStatuses = ['submitted', 'under_review', 'rejected', 'waitlisted'];
  if (!validStatuses.includes(status)) {
    if (status === 'accepted') {
      return error(
        'Direct acceptance via this endpoint is disabled. Use POST /api/admissions/decide with decision "admit" to issue an offer; provisioning runs only after the applicant accepts the offer.',
        410
      );
    }
    return error(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  if (!adminId || typeof adminId !== 'string' || adminId.trim().length < 4) {
    console.error(`[apply:update:${traceId}] Rejected - invalid adminId format`);
    return error('Invalid request context. Admin identity verification failed.', 401);
  }
  const trimmedAdminId = adminId.trim();

  let adminRecord: { id: string; role: string; first_name?: string | null; email?: string | null } | null = null;

  // 1. Check primary D1 database (where users and applications live)
  try {
    const row = await env.PLATFORM_CONTEXT!.db
      .prepare('SELECT id, role, first_name, email FROM users WHERE id = ?')
      .bind(trimmedAdminId)
      .first<{ id: string; role: string; first_name: string | null; email: string | null }>();
    if (row) adminRecord = row;
  } catch (d1Err) {
    console.warn(`[apply:update:${traceId}] D1 user fetch warning:`, d1Err);
  }

  // 2. Fallback to authDb/Neon if not found in D1
  if (!adminRecord) {
    try {
      const authDb = createCoreDb(env);
      if (isNeon(authDb)) await setRequestContext(authDb as NeonHttpDatabase<any>, trimmedAdminId);
      const res = await authDb.select({ id: users.id, role: users.role, first_name: users.first_name, email: users.email })
        .from(users)
        .where(eq(users.id, trimmedAdminId))
        .execute();
      if (res && res.length > 0) adminRecord = res[0];
    } catch (authDbErr) {
      console.warn(`[apply:update:${traceId}] AuthDb user fetch warning:`, authDbErr);
    }
  }

  if (!adminRecord) {
    console.error(`[apply:update:${traceId}] Admin identity ${trimmedAdminId.substring(0, 8)}... NOT FOUND in users table`);
    return error('Admin identity could not be verified. Please log in again.', 401);
  }

  const authorizedRoles = ['admin', 'staff', 'registrar', 'superadmin'];
  if (!authorizedRoles.includes(adminRecord.role)) {
    console.error(`[apply:update:${traceId}] Role guard failed: user ${trimmedAdminId.substring(0, 8)}... has role "${adminRecord.role}" (required: admin/staff/registrar/superadmin)`);
    return error(`Insufficient permissions. Your role "${adminRecord.role}" cannot update application statuses.`, 403);
  }

  const db = env.PLATFORM_CONTEXT!.db;

  type AppRow = { id: string; status: string; program: string; user_id: string; email: string; first_name: string };
  const app = await db
    .prepare(
      `SELECT a.id, a.status, a.program, a.user_id, u.email, u.first_name
       FROM applications a JOIN users u ON a.user_id = u.id
       WHERE a.id = ?`
    )
    .bind(appId)
    .first<AppRow>();
  if (!app) return error('Application not found', 404);

  if (!isValidEmail(app.email)) {
    console.warn(`[apply:update:${traceId}] Invalid recipient email on file for app ${appId.substring(0, 8)}:`, app.email);
  }

  const oldStatus = app.status;

  const sanitizedNotes = notes ? notes.replace(/<[^>]*>/g, '').substring(0, 2000) : null;

  try {
    await db.transaction(async (tx) => {
      await tx.prepare(
        `UPDATE applications SET status = ?, reviewer_id = ?, reviewer_notes = ?, reviewed_at = datetime('now'), updated_at = datetime('now'), submitted_at = COALESCE(submitted_at, datetime('now'))
         WHERE id = ?`
      ).bind(status, trimmedAdminId, sanitizedNotes, appId).run();

      await tx.prepare(
        `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(crypto.randomUUID(), appId, trimmedAdminId, oldStatus, status, sanitizedNotes).run();

      // NOTE: no role change, no admission_code, no provisioning here.
      // Offers + provisioning flow exclusively via POST /api/admissions/decide
      // → OFFER_EXTENDED → applicant POST /api/admissions/accept → provisioning.
    });
  } catch (e) {
    console.error(`[apply:update:${traceId}] Status update transaction FAILED (rolled back):`, e);
    return error('Failed to update application status. Please try again.', 500);
  }

  console.info(`[apply:update:${traceId}] Application ${appId.substring(0, 8)} status ${oldStatus} → ${status} by ${trimmedAdminId.substring(0, 8)} (${adminRecord.role})`);
  await logAdminAction(env, trimmedAdminId, 'update_application_status', 'application', appId, { old_status: oldStatus, new_status: status, notes: sanitizedNotes }, request);

  const runNotifications = async () => {
    const dispatchPromises: Promise<unknown>[] = [];

    if (isValidEmail(app.email)) {
      const studentTraceContext = { traceId, action: 'status_update', role: 'student', application_id: appId };

      dispatchPromises.push(
        safeDispatchEmail(env, ctx, {
          to: app.email,
          subject: `BMI University — Application Update: ${status.replace('_', ' ').toUpperCase()}`,
          html: statusUpdateEmail(app.first_name, status, app.program, sanitizedNotes || undefined, undefined),
          templateName: 'status_update',
          traceId,
          context: studentTraceContext,
        })
      );
    }

    if (env.ADMIN_EMAIL && isValidEmail(env.ADMIN_EMAIL) && env.ADMIN_EMAIL !== adminRecord.email) {
      dispatchPromises.push(
        safeDispatchEmail(env, ctx, {
          to: env.ADMIN_EMAIL,
          subject: `[Admin] Application Status: ${app.first_name} → ${status.replace('_', ' ').toUpperCase()}`,
          html: buildEmailLayout('Application Status Update', `
            <h2 style="color: #0f172a;">Application Status Change</h2>
            <p style="color: #475569; line-height: 1.6;">
              <strong>${adminRecord.first_name || 'An admin'}</strong> (${adminRecord.role}) updated the application status for <strong>${app.first_name}</strong>.
            </p>
            <div style="background: #f8fafc; border-left: 4px solid #d4af37; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 8px 0;"><strong>Applicant:</strong> ${app.first_name} (${app.email})</p>
              <p style="margin: 8px 0;"><strong>Program:</strong> ${app.program}</p>
              <p style="margin: 8px 0;"><strong>Previous Status:</strong> ${oldStatus.replace('_', ' ')}</p>
              <p style="margin: 8px 0;"><strong>New Status:</strong> <span style="font-weight: bold; color: ${status === 'rejected' ? '#ef4444' : '#0f172a'};">${status.replace('_', ' ')}</span></p>
              <p style="margin: 8px 0;"><strong>Application ID:</strong> ${appId.substring(0, 8).toUpperCase()}...</p>
              ${sanitizedNotes ? `<p style="margin: 8px 0;"><strong>Reviewer Notes:</strong> ${sanitizedNotes}</p>` : ''}
            </div>
            <p style="color: #475569; font-size: 13px;">Review full application details in the UMS admin dashboard.</p>
          `),
          templateName: 'admin_status_change_notice',
          traceId,
          context: { traceId, action: 'status_update_copy', role: 'admin', application_id: appId, changed_by: trimmedAdminId },
        })
      );
    }

    try {
      await dispatchWebhook(env, 'application.status_changed', {
        application_id: appId,
        old_status: oldStatus,
        new_status: status,
        program: app.program,
        user_id: app.user_id,
        changed_at: new Date().toISOString(),
        changed_by: trimmedAdminId,
        trace_id: traceId,
      });
    } catch (e) {
      console.warn(`[apply:update:${traceId}] Webhook status_changed dispatch failed (non-critical):`, e);
    }

    await Promise.allSettled(dispatchPromises);
  };

  const runAll = async () => {
    await runNotifications();
  };

  if (ctx) {
    ctx.waitUntil(runAll());
  } else {
    await runAll();
  }

  return ok({
    application_id: appId,
    old_status: oldStatus,
    new_status: status,
    trace_id: traceId,
  });
}

// ─── GET lifecycle history for an application ─────────────────────────────────

export async function handleGetLifecycle(
  _request: Request,
  env: Env,
  appId: string,
  userId: string,
  userRole: string
): Promise<Response> {
  const app = await env.PLATFORM_CONTEXT!.db.prepare('SELECT id, user_id FROM applications WHERE id = ?')
    .bind(appId).first<{ id: string; user_id: string }>();
  if (!app) return error('Application not found', 404);
  if (userRole !== 'admin' && userRole !== 'staff' && app.user_id !== userId) {
    return error('Access denied', 403);
  }
  const events = await getLifecycleHistory(env.PLATFORM_CONTEXT!.db, { applicationId: appId });
  return ok(events);
}

export async function handleGetStatusLogs(_request: Request, env: Env, appId: string, userId: string, userRole: string): Promise<Response> {
  const app = await env.PLATFORM_CONTEXT!.db.prepare('SELECT id, user_id FROM applications WHERE id = ?')
    .bind(appId).first<{ id: string; user_id: string }>();

  if (!app) return error('Application not found', 404);

  if (userRole !== 'admin' && userRole !== 'staff' && app.user_id !== userId) {
    return error('Access denied', 403);
  }

  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT l.old_status, l.new_status, l.notes, l.changed_at,
            u.first_name as changed_by_name
     FROM application_status_logs l
     LEFT JOIN users u ON l.changed_by = u.id
     WHERE l.application_id = ?
     ORDER BY l.changed_at DESC`
  ).bind(appId).all();

  return ok(results);
}

// ─── Admin: Create application on behalf of an applicant ───────────────────────
// POST /api/admin/applications
// Accepts: { email, first_name, last_name, phone?, program, degree_level, high_school?, gpa?, address?, nationality? }
// Finds-or-creates the user record then inserts the application directly.
export async function handleAdminCreateApplication(
  request: Request,
  env: Env,
  adminId: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const { email, first_name, last_name, phone, program, program_id, degree_level, high_school, gpa, address, nationality } = body as Record<string, any>;

  if (!email || !first_name || !last_name || (!program && !program_id) || !degree_level) {
    return error('email, first_name, last_name, program (or program_id), and degree_level are required', 400);
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  const resolved = await resolveProgram(env, {
    program: program ? String(program) : undefined,
    program_id: program_id ? String(program_id) : undefined,
  });
  if (!resolved) {
    return error('Invalid program selected', 400);
  }

  // Same normalization as the applicant schema: catalog-sourced levels may
  // carry any case. Reject unknown levels with 400 (never let the DB CHECK
  // turn this into a 500).
  const normalizedLevel = normalizeDegreeLevel(degree_level);
  if (!normalizedLevel) {
    return error(`degree_level must be one of: ${VALID_DEGREE_LEVELS.join(', ')}`, 400);
  }

  const db = env.PLATFORM_CONTEXT!.db;

  // Find-or-create the applicant user
  const user = await db.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).bind(normalizedEmail).first<{ id: string }>();

  let userId: string;

  if (user) {
    userId = user.id;
  } else {
    // Create a new pre-verified applicant account with a random temp password
    const { hashPassword } = await import('@bmi/api-middleware');
    const tempPassword = crypto.randomUUID();
    const passwordHash = await hashPassword(tempPassword, env.PASSWORD_PEPPER, env.PBKDF2_ITERATIONS);
    userId = crypto.randomUUID();

    await db.prepare(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role, is_verified, account_claimed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'applicant', 1, 0, datetime('now'), datetime('now'))`
    ).bind(userId, normalizedEmail, passwordHash, String(first_name), String(last_name), phone ? String(phone) : null).run();
  }

  // Check for an existing non-rejected application
  const existing = await db.prepare(
    `SELECT COUNT(*) as count FROM applications WHERE user_id = ? AND status NOT IN ('rejected', 'draft')`
  ).bind(userId).first<{ count: number }>();

  if ((existing?.count ?? 0) > 0) {
    return error('An active application already exists for this email address.', 409);
  }

  // Clean up any existing draft application before creating the admin application
  try {
    await db.prepare("DELETE FROM applications WHERE user_id = ? AND status = 'draft'").bind(userId).run();
  } catch (e) {
    console.warn('[apply] Clean up existing draft application skipped:', e);
  }

  const appId = crypto.randomUUID();
  const gpaValue = gpa != null ? parseFloat(String(gpa)) : null;

  await createApplicationWithDependenciesOptimized(db, {
    appId,
    userId,
    program: resolved.name,
    programId: resolved.id,
    degreeLevel: normalizedLevel,
    highSchool: high_school ? String(high_school) : undefined,
    gpa: gpaValue ?? undefined,
    address: address ? String(address) : undefined,
    nationality: nationality ? String(nationality) : undefined,
  });

  await logAdminAction(env, adminId, 'admin_create_application', 'application', appId, {
    applicant_email: normalizedEmail,
    program: resolved.name,
    program_id: resolved.id,
    degree_level: normalizedLevel,
  }, request);

  // Notify the applicant about their new application
  if (env.RESEND_API_KEY && isValidEmail(normalizedEmail)) {
    await safeDispatchEmail(env, undefined, {
      to: normalizedEmail,
      subject: 'BMI University — Application Submitted on Your Behalf',
      html: applicationSubmittedEmail(
        String(first_name),
        resolved.name,
        appId
      ),
      templateName: 'admin_created_application_applicant',
      context: { action: 'admin_create_application', application_id: appId, created_by: adminId },
    });
  }

  // Notify admin email if configured
  if (env.ADMIN_EMAIL && isValidEmail(env.ADMIN_EMAIL)) {
    const { adminNewApplicationNoticeEmail } = await import('../lib/email');
    await safeDispatchEmail(env, undefined, {
      to: env.ADMIN_EMAIL,
      subject: `[Admin] Application Created for ${first_name} ${last_name}`,
      html: adminNewApplicationNoticeEmail(
        `${first_name} ${last_name}`,
        normalizedEmail,
        String(program),
        appId,
        adminId.substring(0, 8) + '...'
      ),
      templateName: 'admin_created_application_admin_notice',
      context: { action: 'admin_create_application_notice', application_id: appId },
    });
  }

  return ok({ application_id: appId, user_id: userId, status: 'submitted' });
}

// ─── Admin: Delete application ───────────────────────────────────────────────────
// DELETE /api/admin/applications/:id
export async function handleDeleteApplication(
  _request: Request,
  env: Env,
  applicationId: string,
  adminId: string,
): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;

  // Check if application exists
  const app = await db.prepare(
    `SELECT id, user_id, program FROM applications WHERE id = ?`
  ).bind(applicationId).first<{ id: string; user_id: string; program: string }>();

  if (!app) {
    return error('Application not found', 404);
  }

  // Delete associated status logs, recommendations, documents (metadata), and the application record
  try {
    await db.prepare(`DELETE FROM application_status_logs WHERE application_id = ?`).bind(applicationId).run();
  } catch (e) {
    console.warn('[delete_app] status logs delete warning:', e);
  }

  try {
    await db.prepare(`DELETE FROM recommendations WHERE application_id = ?`).bind(applicationId).run();
  } catch (e) {
    console.warn('[delete_app] recommendations delete warning:', e);
  }

  try {
    await db.prepare(`DELETE FROM documents WHERE application_id = ?`).bind(applicationId).run();
  } catch (e) {
    console.warn('[delete_app] documents delete warning:', e);
  }

  await db.prepare(`DELETE FROM applications WHERE id = ?`).bind(applicationId).run();

  await logAdminAction(env, adminId, 'DELETE_APPLICATION', 'applications', applicationId, {
    program: app.program,
    applicant_user_id: app.user_id,
  });

  return ok({ message: 'Application deleted successfully', application_id: applicationId });
}

// ─── Duplicate applicant detection ─────────────────────────────────────────
// POST /api/applications/check-duplicate { email, date_of_birth?, national_id? }
// Privacy-hardened: always returns the same generic shape so the endpoint
// cannot be used as an account-existence oracle. Staff review happens
// server-side; no user_id / application_id / status is ever returned.
// Never auto-merges — flags possible matches for staff review internally.
export async function handleCheckDuplicate(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; date_of_birth?: string; national_id?: string; first_name?: string; last_name?: string };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }
  const email = (body.email || '').toLowerCase().trim();
  if (!email || !isValidEmail(email)) return error('A valid email is required', 400);

  const db = env.PLATFORM_CONTEXT!.db;

  // Internal-only duplicate screen for staff review. Results are recorded for
  // ops review but NEVER returned to the caller.
  try {
    const userMatch = await db.prepare(
      `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`
    ).bind(email).first<{ id: string }>().catch(() => null);
    if (userMatch) {
      console.info('[duplicate] possible match flagged for staff review');
    }
  } catch (e) {
    console.warn('[duplicate] email lookup failed:', e);
  }

  if (body.date_of_birth) {
    try {
      await db.prepare(
        `SELECT id FROM users WHERE LOWER(email) != ? AND date_of_birth = ? LIMIT 5`
      ).bind(email, body.date_of_birth).all<{ id: string }>().catch(() => null);
    } catch { /* column may not exist — ignore */ }
  }

  return ok({
    received: true,
    message: 'Your information has been received. Our admissions team will review and link your application if appropriate.',
  });
}

export async function checkAdmissionCodeExpiries(env: Env, ctx?: ExecutionContext): Promise<void> {
  const db = env.PLATFORM_CONTEXT!.db;
  try {
    const { results } = await db.prepare(
      `SELECT u.id, u.email, u.first_name, u.admission_code, u.admission_code_expires_at,
              (SELECT program FROM applications WHERE user_id = u.id AND status = 'accepted' ORDER BY updated_at DESC LIMIT 1) as program
       FROM users u
       WHERE u.admission_code IS NOT NULL
         AND u.account_claimed = 0
         AND u.admission_code_expires_at > datetime('now')
         AND u.admission_code_expires_at <= datetime('now', '+2 days')`
    ).all<{ id: string; email: string; first_name: string; admission_code: string; admission_code_expires_at: string; program: string | null }>();

    if (!results || results.length === 0) return;

    for (const user of results) {
      if (user.email && isValidEmail(user.email)) {
        const portalUrl = (env as any).PORTAL_URL || 'https://bmi-portal.pages.dev';
        const claimUrl = `${portalUrl}/claim?code=${encodeURIComponent(user.admission_code)}`;
        const runNotify = async () => {
          await safeDispatchEmail(env, ctx, {
            to: user.email,
            subject: '⏰ Action Required — Your BMI Admission Code Expires Soon',
            html: buildEmailLayout('Admission Code Expiry Warning', `
              <h2 style="color: #0f172a;">Hi ${user.first_name},</h2>
              <p style="color: #475569; line-height: 1.6;">
                Your one-time admission code for <strong>${user.program || 'BMI University'}</strong> will expire in less than 48 hours.
              </p>
              <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; color: #92400e; font-weight: bold; font-size: 18px;">
                  Code: <span style="font-family: monospace; letter-spacing: 2px;">${user.admission_code}</span>
                </p>
              </div>
              <a href="${claimUrl}"
                 style="display: inline-block; background: #d4af37; color: #0f172a; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold;">
                Claim Your Account Now →
              </a>
            `),
            templateName: 'admission_code_expiry_reminder',
            context: { action: 'admission_code_reminder', user_id: user.id },
          });
        };
        if (ctx) ctx.waitUntil(runNotify());
        else await runNotify();
      }
    }
  } catch (e) {
    console.error('[expiry_check] Failed to check admission code expiries:', e);
  }
}
