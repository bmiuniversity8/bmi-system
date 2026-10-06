// worker/routes/student.ts
// Student Portal API Routes

import { error, ok, typedJson } from '../lib/types';
import type { Env } from '../lib/types';
import { percentageToGrade } from '@bmi/shared';
import {
  PORTAL_URL,
  INSTITUTION_LEGAL_NAME,
  INSTITUTION_TRADING_AS_LINE,
  buildPaymentDescription,
} from '@bmi/shared';

export async function handleGetDashboard(_request: Request, env: Env, userId: string): Promise<Response> {
  const { results: invoices } = await env.PLATFORM_CONTEXT!.db.prepare(
    'SELECT id, amount, due_date, status FROM invoices WHERE student_id = ? ORDER BY due_date DESC'
  ).bind(userId).all();

  const { results: enrollments } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT e.id, c.code, c.title, c.credits, c.term, e.grade, c.id as course_id 
     FROM enrollments e 
     JOIN courses c ON e.course_id = c.id 
     WHERE e.student_id = ? AND e.status = 'enrolled'`
  ).bind(userId).all();

  const balance = invoices.filter((i: Record<string, unknown>) => i.status === 'unpaid').reduce((sum: number, inv: Record<string, unknown>) => sum + (inv.amount as number), 0);

  const { results: activeHolds } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT hold_type, reason FROM student_holds WHERE student_id = ? AND is_active = 1 ORDER BY created_at ASC`
  ).bind(userId).all();

  const unpaidCount = invoices.filter((i: Record<string, unknown>) => i.status === 'unpaid').length;

  // Current academic standing (latest pre-computed record)
  const currentStanding = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT asr.standing, asr.term_gpa, asr.cumulative_gpa, asr.completion_rate,
            at.name as term_name, sr.description as rule_description
     FROM academic_standing_records asr
     LEFT JOIN academic_terms at ON at.id = asr.term_id
     LEFT JOIN standing_rules sr ON sr.id = asr.rule_id
     WHERE asr.student_id = ?
     ORDER BY asr.created_at DESC
     LIMIT 1`
  ).bind(userId).first();

  return ok({
    balance,
    unpaid_invoices: unpaidCount,
    upcoming_invoices: invoices.filter((i: Record<string, unknown>) => i.status === 'unpaid').slice(0, 5),
    current_classes: enrollments,
    registration_holds: activeHolds,
    has_registration_blocks: activeHolds.length > 0,
    academic_standing: currentStanding ?? { standing: 'good', message: 'No standing records yet — good standing by default.' },
    announcements: [
      { id: '1', title: 'Welcome to the New Academic Year', date: new Date().toISOString().split('T')[0], content: 'Complete your onboarding steps to register for courses.' },
    ]
  });
}

export async function handleGetCourses(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const term = url.searchParams.get('term') || 'Fall 2026';
  
  const { results: courses } = await env.PLATFORM_CONTEXT!.db.prepare(
    'SELECT id, code, title, description, credits, term, capacity FROM courses WHERE term = ? ORDER BY code ASC'
  ).bind(term).all();
  
  return ok(courses);
}

export async function handleEnroll(request: Request, env: Env, userId: string): Promise<Response> {
  let body: { course_id: string };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON');
  }

  if (!body.course_id) return error('course_id is required');

  const activeHold = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT hold_type, reason FROM student_holds WHERE student_id = ? AND is_active = 1 LIMIT 1`
  ).bind(userId).first<{ hold_type: string; reason: string }>();

  if (activeHold) {
    return error(`Cannot enroll: ${activeHold.reason} (${activeHold.hold_type} hold active).`, 403);
  }

  try {
    await env.PLATFORM_CONTEXT!.db.prepare(
      'INSERT INTO enrollments (id, student_id, course_id, status) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, body.course_id, 'enrolled').run();

    return ok({ success: true, message: 'Enrolled successfully' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('UNIQUE constraint failed')) {
      return error('Already enrolled in this course', 400);
    }
    return error('Enrollment failed', 500);
  }
}

export async function handleGetFinances(_request: Request, env: Env, userId: string): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  
  // Select full invoice details including FX snapshots and multi-currency amounts
  const { results: invoices } = await db.prepare(
    `SELECT i.*, 
            COALESCE(i.total_billing, i.amount) as payable_amount,
            COALESCE(i.total_base, i.amount) as authoritative_usd,
            COALESCE(i.balance, i.amount) as current_balance,
            COALESCE(i.base_currency, 'USD') as base_currency,
            COALESCE(i.billing_currency, 'KES') as billing_currency,
            COALESCE(i.exchange_rate, 129.76) as exchange_rate,
            COALESCE(i.exchange_rate_source, 'CBK') as exchange_rate_source
     FROM invoices i 
     WHERE i.student_id = ? 
     ORDER BY i.created_at DESC`
  ).bind(userId).all();
  
  // Fetch invoice lines for all student invoices
  const invoiceIds = invoices.map((inv: any) => inv.id);
  const linesMap: Record<string, any[]> = {};
  if (invoiceIds.length > 0) {
    try {
      const placeholders = invoiceIds.map(() => '?').join(',');
      const { results: lines } = await db.prepare(
        `SELECT * FROM invoice_lines WHERE invoice_id IN (${placeholders}) ORDER BY created_at ASC`
      ).bind(...invoiceIds).all();
      for (const line of lines) {
        if (!linesMap[line.invoice_id]) linesMap[line.invoice_id] = [];
        linesMap[line.invoice_id].push(line);
      }
    } catch {
      // Compatibility fallback if invoice_lines table is empty
    }
  }

  const enrichedInvoices = invoices.map((inv: any) => ({
    ...inv,
    lines: linesMap[inv.id] || [],
  }));

  const balanceBilling = enrichedInvoices
    .filter((i: any) => i.status === 'unpaid' || i.status === 'partially_paid')
    .reduce((sum: number, inv: any) => sum + (Number(inv.current_balance ?? inv.balance ?? inv.amount) || 0), 0);

  const balanceBase = enrichedInvoices
    .filter((i: any) => i.status === 'unpaid' || i.status === 'partially_paid')
    .reduce((sum: number, inv: any) => sum + (Number(inv.authoritative_usd ?? inv.total_base ?? inv.amount) || 0), 0);

  // Fetch student payment history & receipts
  let payments: any[] = [];
  try {
    const { results: payRows } = await db.prepare(
      `SELECT * FROM payments WHERE student_id = ? ORDER BY created_at DESC LIMIT 50`
    ).bind(userId).all();
    payments = payRows;
  } catch {
    // Non-fatal
  }

  return ok({
    balance: balanceBilling, // Primary billing currency (KES)
    balance_base_usd: balanceBase,
    currency: 'KES',
    base_currency: 'USD',
    invoices: enrichedInvoices,
    payments,
  });
}

export async function handlePayInvoice(_request: Request, env: Env, userId: string, invoiceId: string): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  const invoice = await db.prepare(
    `SELECT id, amount, total_billing, balance, billing_currency, status FROM invoices WHERE id = ? AND student_id = ?`
  ).bind(invoiceId, userId).first<{ id: string; amount: number; total_billing: number | null; balance: number | null; billing_currency: string | null; status: string }>();
  
  if (!invoice) return error('Invoice not found', 404);
  if (invoice.status === 'paid') return error('Invoice is already paid', 400);

  // Resolve payer email — Paystack requires it to initialize a transaction.
  let payerEmail = '';
  try {
    const user = await db
      .prepare('SELECT email FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email: string }>();
    if (user?.email) payerEmail = user.email;
  } catch { /* handled below */ }
  if (!payerEmail) return error('Student email is required to initialize payment', 400);

  const payableAmount = Number(invoice.balance ?? invoice.total_billing ?? invoice.amount);
  const payCurrency = (invoice.billing_currency || 'KES').toUpperCase();

  try {
    const paymentIntent = await env.PLATFORM_CONTEXT!.payment.createPaymentIntent({
      amount: payableAmount,
      currency: payCurrency,
      email: payerEmail,
      description: buildPaymentDescription(`Tuition Invoice ${String(invoice.id).slice(0, 8)}`),
      callbackUrl: env.PAYSTACK_CALLBACK_URL || `${PORTAL_URL}/student/finances`,
      metadata: {
        userId,
        invoiceId,
        merchant: INSTITUTION_LEGAL_NAME,
        trading_as: INSTITUTION_TRADING_AS_LINE,
      }
    });

    return ok({
      success: true,
      requires_action: true,
      message: `Complete your payment securely — payee: ${INSTITUTION_LEGAL_NAME}`,
      paymentIntentId: paymentIntent.id,
      reference: paymentIntent.reference || paymentIntent.id,
      authorization_url: paymentIntent.authorizationUrl,
      authorizationUrl: paymentIntent.authorizationUrl,
      access_code: paymentIntent.accessCode,
      currency: payCurrency,
      amount: payableAmount,
      merchant: INSTITUTION_LEGAL_NAME,
      tradingAs: INSTITUTION_TRADING_AS_LINE,
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : '';
    if (/email is required/i.test(msg)) return error(msg, 400);
    if (/not yet available|no real adapter|unimplemented/i.test(msg)) {
      return error('Payment processing is not yet available. Please try again later.', 501);
    }
    return error(msg || 'Payment processing is not yet available. Please try again later.', 500);
  }
}

export async function handleDropCourse(_request: Request, env: Env, userId: string, courseId: string): Promise<Response> {
  const result = await env.PLATFORM_CONTEXT!.db.prepare(
    'UPDATE enrollments SET status = "dropped" WHERE course_id = ? AND student_id = ? AND status = "enrolled"'
  ).bind(courseId, userId).run();
  
  if (result.meta.changes === 0) {
    return error('Course not found or not enrolled', 400);
  }

  // Also update student_course_registrations
  await env.PLATFORM_CONTEXT!.db.prepare(
    'UPDATE student_course_registrations SET status = "dropped" WHERE course_id = ? AND student_id = ? AND status = "registered"'
  ).bind(courseId, userId).run();

  // Auto-promote next student from waitlist if any
  try {
    const nextWaitlisted = await env.PLATFORM_CONTEXT!.db.prepare(
      'SELECT id, student_id, term_id FROM student_course_registrations WHERE course_id = ? AND status = "waitlisted" ORDER BY registered_at ASC LIMIT 1'
    ).bind(courseId).first<{ id: string; student_id: string; term_id: string }>();

    if (nextWaitlisted) {
      await env.PLATFORM_CONTEXT!.db.prepare(
        'UPDATE student_course_registrations SET status = "registered" WHERE id = ?'
      ).bind(nextWaitlisted.id).run();

      await env.PLATFORM_CONTEXT!.db.prepare(
        'INSERT INTO enrollments (id, student_id, course_id, status) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), nextWaitlisted.student_id, courseId, 'enrolled').run();

      // Send in-app notification to the promoted student
      const notifId = crypto.randomUUID();
      await env.PLATFORM_CONTEXT!.db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, link)
         VALUES (?, ?, 'success', 'Enrolled from Waitlist!', 'A seat became available in your waitlisted course and you have been automatically enrolled.', '/student/academics')`
      ).bind(notifId, nextWaitlisted.student_id).run();
    }
  } catch (err) {
    console.warn('Waitlist promotion warning:', err);
  }

  return ok({ success: true, message: 'Course dropped successfully' });
}

export async function handleGetTranscript(_request: Request, env: Env, userId: string): Promise<Response> {
  const { results: classes } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT c.code, c.title, c.credits, c.term, e.id as enrollment_id, e.status,
            (SELECT AVG(g.score * 100.0 / NULLIF(g.max_score, 0))
               FROM grades g WHERE g.enrollment_id = e.id AND g.max_score > 0) as avg_pct
     FROM enrollments e
     JOIN courses c ON e.course_id = c.id
     WHERE e.student_id = ? AND e.status != 'waitlisted'
     ORDER BY c.term DESC, c.code ASC`
  ).bind(userId).all();
  
  let totalPoints = 0;
  let totalCredits = 0;
  
  interface CourseRow { code: string; title: string; credits: number; term: string; enrollment_id: string; status: string; avg_pct: number | null }
  const withGrades = (classes as CourseRow[]).map((c) => {
    let letter_grade = 'N/A';
    if (c.avg_pct !== null) {
      const gradeInfo = percentageToGrade(c.avg_pct);
      letter_grade = gradeInfo.letter_grade;
      totalPoints += gradeInfo.grade_point * c.credits;
      totalCredits += c.credits;
    }
    return { ...c, grade: letter_grade };
  });
  
  const gpa = totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : null;
  
  return ok({ classes: withGrades, gpa });
}

export async function handleGetSettings(_request: Request, env: Env, userId: string): Promise<Response> {
  let settings = await env.PLATFORM_CONTEXT!.db.prepare(
    'SELECT directory_release, communications_opt_in FROM student_settings WHERE student_id = ?'
  ).bind(userId).first();
  
  if (!settings) {
    // Default settings
    settings = { directory_release: 1, communications_opt_in: 1 };
  }
  
  const studentInfo = await env.PLATFORM_CONTEXT!.db.prepare(
    'SELECT photo FROM students WHERE user_id = ?'
  ).bind(userId).first<{ photo: string | null }>();
  
  return ok({
    ...settings,
    photo: studentInfo?.photo || null
  });
}

export async function handleUpdateSettings(request: Request, env: Env, userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await typedJson<Record<string, unknown>>(request);
  } catch {
    return error('Invalid JSON');
  }
  
  const dirRelease = body.directory_release ? 1 : 0;
  const commOptIn = body.communications_opt_in ? 1 : 0;
  
  await env.PLATFORM_CONTEXT!.db.prepare(
    `INSERT INTO student_settings (student_id, directory_release, communications_opt_in, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(student_id) DO UPDATE SET 
       directory_release = excluded.directory_release,
       communications_opt_in = excluded.communications_opt_in,
       updated_at = excluded.updated_at`
  ).bind(userId, dirRelease, commOptIn).run();
  
  return ok({ success: true, message: 'Settings updated' });
}

export async function handleUpdatePhoto(request: Request, env: Env, userId: string): Promise<Response> {
  let body: { photo: string };
  try {
    body = await typedJson<{ photo: string }>(request);
  } catch {
    return error('Invalid JSON');
  }

  if (!body.photo) {
    return error('Photo is required', 400);
  }

  // Basic validation for base64 data URI
  if (!body.photo.startsWith('data:image/') || body.photo.length > 300 * 1024) {
    return error('Invalid photo format or size (max 300KB)', 400);
  }

  await env.PLATFORM_CONTEXT!.db.prepare(
    'UPDATE students SET photo = ? WHERE user_id = ?'
  ).bind(body.photo, userId).run();

  return ok({ success: true, message: 'Profile photo updated' });
}

export async function handleGetTickets(_request: Request, env: Env, userId: string): Promise<Response> {
  const { results: tickets } = await env.PLATFORM_CONTEXT!.db.prepare(
    'SELECT id, subject, status, created_at FROM support_tickets WHERE student_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return ok(tickets);
}

export async function handleCreateTicket(request: Request, env: Env, userId: string): Promise<Response> {
  let body: { subject: string, description: string };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON');
  }
  
  if (!body.subject || !body.description) {
    return error('Subject and description are required');
  }
  
  const ticketId = crypto.randomUUID();
  await env.PLATFORM_CONTEXT!.db.prepare(
    'INSERT INTO support_tickets (id, student_id, subject, description) VALUES (?, ?, ?, ?)'
  ).bind(ticketId, userId, body.subject, body.description).run();
  
  return ok({ success: true, message: 'Support ticket created successfully', ticket_id: ticketId });
}

export async function handleApplyGraduation(request: Request, env: Env, userId: string): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  const { assessGraduationFee } = await import('../lib/fee-assessment-service');

  await request.json().catch(() => null);

  const assessed = await assessGraduationFee(db, userId);

  return ok({
    success: true,
    message: 'Application for degree conferral received and graduation fee assessed',
    invoice: assessed,
  });
}

