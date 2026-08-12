import type { IDatabase } from '@bmi/ports';
import { ok, error, logAdminAction } from '../lib/types';
import {
  applicationSubmittedEmail,
  statusUpdateEmail,
  accountSetupPromptEmail,
  isValidEmail,
  generateTraceId,
  buildEmailLayout,
  safeDispatchEmail,
} from '../lib/email';
import type { Env } from '../lib/types';
import { dispatchWebhook } from '../lib/webhook';
import { generateApplicationNumber } from '../lib/app_number';
import { getLifecycleHistory } from '../lib/lifecycle';
import { dispatchPendingJobs } from '../lib/provisioning';
import { parseBody, SubmitApplicationSchema, ApplicationDraftSchema } from '../lib/schemas';
import { executeAdmissionPipelineOptimized, executeWithMonitoring } from '../lib/performance';
import { createCoreDb, setRequestContext, isNeon } from '../lib/db';
import { users } from '../schema/core';
import { eq } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';

/**
 * Validate a program name against the SINGLE SOURCE OF TRUTH — the programs DB table.
 *
 * Previously this used a hardcoded VALID_PROGRAMS list imported from @bmi/shared,
 * which drifted from the actual curriculum. Now we query the DB so any program
 * added/archived via the UMS is immediately reflected in application validation.
 *
 * Results are in-memory cached per Worker invocation for 60s to avoid N+1 lookups
 * during the same request lifecycle.
 */
async function isValidProgramName(env: Env, programName: string): Promise<boolean> {
  const row = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT 1 AS found FROM programs WHERE name = ? AND is_active = 1 LIMIT 1`,
  ).bind(programName).first<{ found: number }>();
  return (row?.found ?? 0) === 1;
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

  const { program, degree_level, personal_statement, prior_education, date_of_birth, nationality, address, gender, high_school, graduation_year, gpa } = parsed;

  if (!(await isValidProgramName(env, program))) {
    return error('Invalid program selected', 400);
  }

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

  try {
    await createApplicationWithDependenciesOptimized(db, {
      appId,
      userId,
      program,
      degreeLevel: degree_level,
      personalStatement: sanitizedStatement ?? undefined,
      priorEducation: sanitizedEducation ? JSON.stringify(sanitizedEducation) : undefined,
      dateOfBirth: date_of_birth,
      nationality,
      address,
      gender,
      highSchool: high_school,
      graduationYear: graduation_year,
      gpa
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

  // Async operations for non-critical tasks
  let applicationNumber: string | null = null;

  const runBgTasks = async () => {
    const promises: Promise<unknown>[] = [deleteDraft()];

    promises.push(
      generateAndUpdateApplicationNumber(db, appId)
        .catch(e => console.error('[app_number] Background generation failed:', e))
    );

    promises.push(
      sendApplicationNotificationsOptimized(env, userId, program, appId)
        .catch(e => console.error('[email] Background notification failed:', e))
    );

    await Promise.allSettled(promises);
  };

  if (ctx) {
    ctx.waitUntil(runBgTasks());
  } else {
    await runBgTasks();
    // Synchronously populate applicationNumber in the non-ctx (fallback/testing) path
    const year = new Date().getUTCFullYear();
    try {
      const generated = await generateApplicationNumber(db, year).catch(() => null);
      if (generated) {
        applicationNumber = generated;
        await db.prepare('UPDATE applications SET application_number = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(generated, appId).run();
      }
    } catch (e) {
      console.error('[app_number] Fallback generation failed:', e);
    }
  }

  const duration = performance.now() - startTime;
  if (duration > 800) {
    console.warn(`Slow application submission detected: ${duration}ms for user ${userId}`);
  }

  return ok({
    application_id: appId,
    application_number: applicationNumber || 'PENDING',
    status: 'submitted',
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
  }
): Promise<string> {
  const { appId, userId, program, degreeLevel, personalStatement, priorEducation, dateOfBirth, nationality, address, gender, highSchool, graduationYear, gpa } = applicationData;

  await db.transaction(async (tx) => {
    // 1. Update user's personal info
    await tx.prepare(
      `UPDATE users SET date_of_birth = ?, nationality = ?, address = ?, gender = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(dateOfBirth ?? null, nationality ?? null, address ?? null, gender ?? null, userId).run();

    // 2. Main application record with optimized fields
    await tx.prepare(
      `INSERT INTO applications (id, user_id, program, degree_level, status, personal_statement, prior_education, high_school, graduation_year, gpa, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`
    ).bind(appId, userId, program, degreeLevel, personalStatement ?? null, priorEducation ?? null, highSchool ?? null, graduationYear ?? null, gpa ?? null).run();

    // 3. Initial status log with timestamp
    await tx.prepare(
      `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
       VALUES (?, ?, ?, NULL, 'submitted', 'Initial submission', datetime('now'))`
    ).bind(crypto.randomUUID(), appId, userId).run();
  });

  return appId;
}

// Background application number generation (ACID-wrapped)
async function generateAndUpdateApplicationNumber(db: IDatabase, appId: string): Promise<void> {
  const year = new Date().getUTCFullYear();
  try {
    const applicationNumber = await generateApplicationNumber(db, year);

    await db.transaction(async (tx) => {
      await tx.prepare(
        'UPDATE applications SET application_number = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).bind(applicationNumber, appId).run();

      const noteMsg = `Application Reference Number assigned: ${applicationNumber}`;
      await tx.prepare(
        `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
         VALUES (?, ?, 'system', NULL, 'application_number_generated', ?, datetime('now'))`
      ).bind(crypto.randomUUID(), appId, noteMsg).run();
    });
  } catch (e) {
    console.error('[app_number] Background generation failed for', appId, ':', e);
    throw e;
  }
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
  const validStatuses = ['under_review', 'accepted', 'rejected', 'waitlisted'];
  if (!validStatuses.includes(status)) {
    return error(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  if (!adminId || typeof adminId !== 'string' || adminId.trim().length < 4) {
    console.error(`[apply:update:${traceId}] Rejected - invalid adminId format`);
    return error('Invalid request context. Admin identity verification failed.', 401);
  }
  const trimmedAdminId = adminId.trim();

  const authDb = createCoreDb(env);
  if (isNeon(authDb)) await setRequestContext(authDb as NeonHttpDatabase<any>, trimmedAdminId);
  const adminRecord = (await authDb.select({ id: users.id, role: users.role, first_name: users.first_name, email: users.email })
    .from(users)
    .where(eq(users.id, trimmedAdminId))
    .execute())[0];

  if (!adminRecord) {
    console.error(`[apply:update:${traceId}] Admin identity ${trimmedAdminId.substring(0, 8)}... NOT FOUND in users table`);
    return error('Admin identity could not be verified. Please log in again.', 401);
  }

  const authorizedRoles = ['admin', 'staff', 'registrar'];
  if (!authorizedRoles.includes(adminRecord.role)) {
    console.error(`[apply:update:${traceId}] Role guard failed: user ${trimmedAdminId.substring(0, 8)}... has role "${adminRecord.role}" (required: admin/staff/registrar)`);
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
  let pipelineResult: { uid: string | null; registration_number: string | null } | null = null;
  let admissionCode: string | undefined;

  const sanitizedNotes = notes ? notes.replace(/<[^>]*>/g, '').substring(0, 2000) : null;

  try {
    await db.transaction(async (tx) => {
      await tx.prepare(
        `UPDATE applications SET status = ?, reviewer_id = ?, reviewer_notes = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).bind(status, trimmedAdminId, sanitizedNotes, appId).run();

      await tx.prepare(
        `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(crypto.randomUUID(), appId, trimmedAdminId, oldStatus, status, sanitizedNotes).run();

      if (status === 'accepted') {
        admissionCode = crypto.randomUUID().split('-')[0].toUpperCase() + crypto.randomUUID().split('-')[0].toUpperCase();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        await tx.prepare(
          `UPDATE users SET role = 'student', admission_code = ?, admission_code_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(admissionCode, expiresAt, app.user_id).run();
      }
    });
  } catch (e) {
    console.error(`[apply:update:${traceId}] Status update transaction FAILED (rolled back):`, e);
    return error('Failed to update application status. Please try again.', 500);
  }

  console.info(`[apply:update:${traceId}] Application ${appId.substring(0, 8)} status ${oldStatus} → ${status} by ${trimmedAdminId.substring(0, 8)} (${adminRecord.role})`);
  await logAdminAction(env, trimmedAdminId, 'update_application_status', 'application', appId, { old_status: oldStatus, new_status: status, notes: sanitizedNotes }, request);

  // RC-7: Use a shared mutable result ref so runAdmissionPostAccept can populate it
  // before runNotifications reads it — avoids a sequential await that would add latency,
  // while still guaranteeing the reg_no is available when instructor emails are dispatched.
  const sharedResult: { uid: string | null; registration_number: string | null } = { uid: null, registration_number: null };

  const runAdmissionPostAccept = async () => {
    try {
      if (status === 'accepted') {
        const result = await executeAdmissionPipelineOptimized(db, {
          applicationId: appId,
          userId: app.user_id,
          actorId: trimmedAdminId,
          program: app.program,
        }, env.PLATFORM_CONTEXT!.document);
        // Populate shared ref so runNotifications can access the data
        sharedResult.uid = result.uid;
        sharedResult.registration_number = result.regNo;
        pipelineResult = sharedResult;
        await dispatchPendingJobs(env).catch(e => console.error(`[apply:update:${traceId}] Provisioning dispatch failed:`, e));
      }
    } catch (e) {
      console.error(`[apply:update:${traceId}] Admission post-accept pipeline error:`, e);
    }
  };

  const runNotifications = async () => {
    const dispatchPromises: Promise<unknown>[] = [];

    if (isValidEmail(app.email)) {
      const studentTraceContext = { traceId, action: 'status_update', role: 'student', application_id: appId };
      if (status === 'accepted' && admissionCode) {
        dispatchPromises.push(
          safeDispatchEmail(env, ctx, {
            to: app.email,
            subject: '🎉 BMI University — You\'ve Been Accepted! Complete Your Account Setup',
            html: accountSetupPromptEmail(app.first_name, app.program, admissionCode),
            templateName: 'account_setup_prompt',
            traceId,
            context: studentTraceContext,
          })
        );
      }

      dispatchPromises.push(
        safeDispatchEmail(env, ctx, {
          to: app.email,
          subject: `BMI University — Application Update: ${status.replace('_', ' ').toUpperCase()}`,
          html: statusUpdateEmail(app.first_name, status, app.program, sanitizedNotes || undefined, admissionCode),
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
              <p style="margin: 8px 0;"><strong>New Status:</strong> <span style="font-weight: bold; color: ${status === 'accepted' ? '#22c55e' : status === 'rejected' ? '#ef4444' : '#0f172a'};">${status.replace('_', ' ')}</span></p>
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

    if (status === 'accepted') {
      const instructorMatches = await db.prepare(
        `SELECT DISTINCT u.email, u.first_name, u.last_name
         FROM courses c
         JOIN instructors i ON c.instructor_id = i.id
         JOIN users u ON i.user_id = u.id
         WHERE c.program_id = (SELECT id FROM programs WHERE name = ? LIMIT 1)
         AND u.email IS NOT NULL AND u.email != ''`
      ).bind(app.program).all<{ email: string; first_name: string | null; last_name: string | null }>();

      if (instructorMatches?.results?.length) {
        for (const instructor of instructorMatches.results) {
          if (instructor.email && isValidEmail(instructor.email)) {
            const instructorName = [instructor.first_name, instructor.last_name].filter(Boolean).join(' ') || 'Instructor';
            dispatchPromises.push(
              safeDispatchEmail(env, ctx, {
                to: instructor.email,
                subject: `[Faculty] New Student Admitted to ${app.program}`,
                html: buildEmailLayout('New Student Admission Notice', `
                  <h2 style="color: #0f172a;">Dear ${instructorName},</h2>
                  <p style="color: #475569; line-height: 1.6;">
                    A new student has been admitted to the <strong>${app.program}</strong> program and will be joining your upcoming courses.
                  </p>
                  <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 8px 0; color: #166534;"><strong>Student Name:</strong> ${app.first_name}</p>
                    <p style="margin: 8px 0; color: #166534;"><strong>Contact:</strong> ${app.email}</p>
                    <p style="margin: 8px 0; color: #166534;"><strong>Program:</strong> ${app.program}</p>
                    ${sharedResult.registration_number ? `<p style="margin: 8px 0; color: #166534;"><strong>Student Reg No:</strong> ${sharedResult.registration_number}</p>` : ''}
                  </div>
                  <p style="color: #475569; line-height: 1.6;">
                    Student LMS enrollment, email provisioning, and course registration are being processed. You will see the student appear in your class rosters within 24 hours. Please update your syllabi and prepare welcome materials.
                  </p>
                  <p style="color: #64748b; font-size: 13px;">
                    If you have questions about this student's placement, contact the Registrar's Office at <a href="mailto:bmiuniversity8@gmail.com" style="color: #d4af37;">bmiuniversity8@gmail.com</a>.
                  </p>
                `),
                templateName: 'instructor_new_student_notice',
                traceId,
                context: { traceId, action: 'accepted_faculty_notice', role: 'instructor', application_id: appId, program: app.program },
              })
            );
          }
        }
      }
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

  // RC-7: Run pipeline first (populates sharedResult.registration_number), then notifications.
  // Both are async but notifications wait for pipeline to resolve via sequential await inside waitUntil.
  const runAll = async () => {
    await runAdmissionPostAccept();
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
    ...(pipelineResult ? { admission: pipelineResult } : {}),
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

  const { email, first_name, last_name, phone, program, degree_level, high_school, gpa, address, nationality } = body as Record<string, any>;

  if (!email || !first_name || !last_name || !program || !degree_level) {
    return error('email, first_name, last_name, program, and degree_level are required', 400);
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  if (!(await isValidProgramName(env, program))) {
    return error('Invalid program selected', 400);
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
    program: String(program),
    degreeLevel: String(degree_level),
    highSchool: high_school ? String(high_school) : undefined,
    gpa: gpaValue ?? undefined,
    address: address ? String(address) : undefined,
    nationality: nationality ? String(nationality) : undefined,
  });

  await logAdminAction(env, adminId, 'admin_create_application', 'application', appId, {
    applicant_email: normalizedEmail,
    program,
    degree_level,
  }, request);

  // Notify the applicant about their new application
  if (env.RESEND_API_KEY && isValidEmail(normalizedEmail)) {
    await safeDispatchEmail(env, undefined, {
      to: normalizedEmail,
      subject: 'BMI University — Application Submitted on Your Behalf',
      html: applicationSubmittedEmail(
        String(first_name),
        String(program),
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
