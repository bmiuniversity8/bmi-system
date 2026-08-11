import { PORTAL_URL } from '@bmi/shared';

const FROM_ADDRESS = 'BMI University <admissions@hkmministries.org>';

import type { Env } from './types';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  logId?: string;
  traceId?: string;
  templateName?: string;
  context?: Record<string, unknown>;
}

export interface EmailAttemptLog {
  attempt: number;
  timestamp: string;
  sender: string;
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
  durationMs: number;
}

export interface PersistentEmailLog {
  id: string;
  traceId: string;
  toAddress: string;
  subject: string;
  templateName?: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  startedAt: string;
  finishedAt?: string;
  attemptHistory: EmailAttemptLog[];
  context?: string;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function generateTraceId(): string {
  return `trace_${crypto.randomUUID().replace(/-/g, '')}_${Date.now().toString(36)}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function getExponentialBackoffDelay(attempt: number): number {
  const baseDelay = 1000;
  const multiplier = Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return Math.min(baseDelay * multiplier + jitter, 30000);
}

async function sendResendWithRetry(
  env: Env,
  payload: EmailPayload,
  traceId: string,
  maxAttempts: number = 3
): Promise<{ ok: boolean; status: number; error?: string; attempts: EmailAttemptLog[] }> {
  const senders = [
    env.RESEND_FROM_EMAIL || FROM_ADDRESS,
    ...(env.RESEND_FROM_EMAIL && env.RESEND_FROM_EMAIL !== 'onboarding@resend.dev' ? ['onboarding@resend.dev'] : [])
  ];

  const attemptHistory: EmailAttemptLog[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = getExponentialBackoffDelay(attempt - 1);
      console.info(`[email:${traceId}] Retry attempt ${attempt + 1}/${maxAttempts} after ${delay}ms backoff`);
      await sleep(delay);
    }

    for (const fromAddr of senders) {
      const attemptStart = performance.now();
      const attemptTimestamp = new Date().toISOString();

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Trace-Id': traceId,
          },
          body: JSON.stringify({
            from: fromAddr,
            to: payload.to.trim(),
            subject: payload.subject,
            html: payload.html,
            headers: {
              'X-Email-Trace-Id': traceId,
              'X-Email-Template': payload.templateName || 'unknown',
            },
          }),
        });

        const duration = performance.now() - attemptStart;

        if (res.ok) {
          attemptHistory.push({
            attempt: attempt + 1,
            timestamp: attemptTimestamp,
            sender: fromAddr,
            success: true,
            statusCode: res.status,
            durationMs: Math.round(duration),
          });
          console.info(`[email:${traceId}] Delivered via ${fromAddr} (attempt ${attempt + 1}/${maxAttempts}) in ${Math.round(duration)}ms`);
          return { ok: true, status: res.status, attempts: attemptHistory };
        }

        const errText = await res.text().catch(() => 'no error body');
        attemptHistory.push({
          attempt: attempt + 1,
          timestamp: attemptTimestamp,
          sender: fromAddr,
          success: false,
          statusCode: res.status,
          errorMessage: errText.substring(0, 500),
          durationMs: Math.round(duration),
        });
        console.warn(`[email:${traceId}] Sender ${fromAddr} rejected (${res.status}, attempt ${attempt + 1}/${maxAttempts}): ${errText.substring(0, 200)}`);

        if (res.status === 429) {
          console.warn(`[email:${traceId}] Rate limited (429) — will retry with extended backoff`);
          continue;
        }
        if (res.status >= 500) {
          console.warn(`[email:${traceId}] Server error (${res.status}) — will retry`);
          continue;
        }
        if (res.status === 403 || res.status === 422) {
          console.warn(`[email:${traceId}] Client error (${res.status}) — trying alternate sender`);
          continue;
        }
        if (res.status === 401) {
          console.error(`[email:${traceId}] Authentication failed (401) — RESEND_API_KEY may be invalid`);
          break;
        }
        break;
      } catch (err) {
        const duration = performance.now() - attemptStart;
        const errorMsg = err instanceof Error ? err.message : String(err);
        attemptHistory.push({
          attempt: attempt + 1,
          timestamp: attemptTimestamp,
          sender: fromAddr,
          success: false,
          errorMessage: errorMsg.substring(0, 500),
          durationMs: Math.round(duration),
        });
        console.error(`[email:${traceId}] Network error (attempt ${attempt + 1}/${maxAttempts}): ${errorMsg.substring(0, 200)}`);
        continue;
      }
    }
  }

  const finalError = attemptHistory.length > 0
    ? `Final error: ${attemptHistory[attemptHistory.length - 1].errorMessage || 'unknown'}`
    : 'All attempts exhausted - no attempts made';

  console.error(`[email:${traceId}] All ${maxAttempts} attempts exhausted after ${attemptHistory.length} sender attempts`);
  return { ok: false, status: 0, error: finalError, attempts: attemptHistory };
}

async function writePersistentEmailLog(
  env: Env,
  log: PersistentEmailLog
): Promise<void> {
  try {
    if (!env.PLATFORM_CONTEXT?.db) {
      console.debug(`[email:${log.traceId}] No DB available for persistent log, using in-memory only`);
      return;
    }

    const existing = await env.PLATFORM_CONTEXT.db.prepare(
      `SELECT id FROM email_logs WHERE id = ?`
    ).bind(log.id).first<{ id: string }>();

    if (existing) {
      await env.PLATFORM_CONTEXT.db.prepare(
        `UPDATE email_logs SET
           trace_id = ?,
           to_address = ?,
           subject = ?,
           template_name = ?,
           status = ?,
           attempts = ?,
           max_attempts = ?,
           last_error = ?,
           started_at = ?,
           finished_at = ?,
           attempt_history = ?,
           context = ?
         WHERE id = ?`
      ).bind(
        log.traceId,
        log.toAddress,
        log.subject,
        log.templateName || null,
        log.status,
        log.attempts,
        log.maxAttempts,
        log.lastError || null,
        log.startedAt,
        log.finishedAt || null,
        JSON.stringify(log.attemptHistory),
        log.context || null,
        log.id
      ).run();
    } else {
      await env.PLATFORM_CONTEXT.db.prepare(
        `INSERT INTO email_logs
           (id, trace_id, to_address, subject, template_name, status, attempts, max_attempts,
            last_error, started_at, finished_at, attempt_history, context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        log.id,
        log.traceId,
        log.toAddress,
        log.subject,
        log.templateName || null,
        log.status,
        log.attempts,
        log.maxAttempts,
        log.lastError || null,
        log.startedAt,
        log.finishedAt || null,
        JSON.stringify(log.attemptHistory),
        log.context || null
      ).run();
    }

    console.debug(`[email:${log.traceId}] Persistent log ${log.status} (id=${log.id.substring(0, 8)}...)`);
  } catch (dbErr) {
    console.error(`[email:${log.traceId}] Failed to write persistent email log:`, dbErr);
  }
}

export async function sendEmail(env: Env, payload: EmailPayload): Promise<boolean> {
  const logId = crypto.randomUUID();
  const traceId = payload.traceId || generateTraceId();
  let sent = false;
  let errorDetail: string | null = null;
  const startedAt = new Date().toISOString();
  let attemptHistory: EmailAttemptLog[] = [];

  const persistentLog: PersistentEmailLog = {
    id: logId,
    traceId,
    toAddress: payload.to,
    subject: payload.subject,
    templateName: payload.templateName,
    status: 'sending',
    attempts: 0,
    maxAttempts: 3,
    startedAt,
    attemptHistory: [],
    context: payload.context ? JSON.stringify(payload.context) : undefined,
  };

  console.info(`[email:${traceId}] Starting email delivery [logId=${logId.substring(0, 8)}] to=${payload.to} subject="${payload.subject.substring(0, 60)}"`);

  if (!isValidEmail(payload.to)) {
    errorDetail = 'invalid_recipient';
    console.error(`[email:${traceId}] Invalid recipient address, skipping: ${payload.to}`);
    persistentLog.status = 'failed';
    persistentLog.lastError = errorDetail;
    persistentLog.finishedAt = new Date().toISOString();
    await writePersistentEmailLog(env, persistentLog);
    return false;
  }

  if (!payload.subject || !payload.html) {
    errorDetail = 'missing_payload_fields';
    console.error(`[email:${traceId}] Missing subject or html body, skipping to: ${payload.to}`);
    persistentLog.status = 'failed';
    persistentLog.lastError = errorDetail;
    persistentLog.finishedAt = new Date().toISOString();
    await writePersistentEmailLog(env, persistentLog);
    return false;
  }

  if (!env.RESEND_API_KEY) {
    errorDetail = 'missing_api_key';
    console.warn(`[email:${traceId}] RESEND_API_KEY is not configured. Email logged but skipped:`, payload.subject);
    persistentLog.status = 'failed';
    persistentLog.lastError = errorDetail;
    persistentLog.finishedAt = new Date().toISOString();
    await writePersistentEmailLog(env, persistentLog);
    return false;
  }

  const queuedPayload: EmailPayload = { ...payload, logId, traceId };

  if (env.PLATFORM_CONTEXT?.queue) {
    try {
      persistentLog.status = 'queued';
      await writePersistentEmailLog(env, persistentLog);
      await env.PLATFORM_CONTEXT.queue.send(queuedPayload);
      sent = true;
      console.info(`[email:${traceId}] Queued for delivery via Cloudflare Queue`);
      persistentLog.status = 'sent';
      persistentLog.attempts = 1;
      persistentLog.finishedAt = new Date().toISOString();
      persistentLog.attemptHistory = [{
        attempt: 1,
        timestamp: new Date().toISOString(),
        sender: 'cloudflare-queue',
        success: true,
        durationMs: 0,
      }];
      await writePersistentEmailLog(env, persistentLog);
      return true;
    } catch (err) {
      const queueError = err instanceof Error ? err.message : String(err);
      console.warn(`[email:${traceId}] Queue.send failed (${queueError.substring(0, 100)}), falling back to direct Resend API fetch`);
      persistentLog.status = 'sending';
      persistentLog.lastError = `queue_failed: ${queueError.substring(0, 200)}`;
    }
  }

  const result = await sendResendWithRetry(env, payload, traceId, 3);
  attemptHistory = result.attempts;
  sent = result.ok;
  if (!sent) errorDetail = result.error || `status_${result.status}`;

  persistentLog.status = sent ? 'sent' : (persistentLog.attempts >= persistentLog.maxAttempts ? 'dead' : 'failed');
  persistentLog.attempts = attemptHistory.length;
  persistentLog.lastError = errorDetail || undefined;
  persistentLog.finishedAt = new Date().toISOString();
  persistentLog.attemptHistory = attemptHistory;

  await writePersistentEmailLog(env, persistentLog);

  if (sent) {
    console.info(`[email:${traceId}] Email successfully delivered in ${attemptHistory.length} attempt(s)`);
  } else {
    console.error(`[email:${traceId}] Email delivery FAILED after ${attemptHistory.length} attempt(s): ${errorDetail}`);
  }

  return sent;
}

import type { PlatformContext } from '@bmi/bootstrap';

export async function processEmailDelivery(payload: EmailPayload, ctx: PlatformContext): Promise<boolean> {
  const traceId = payload.traceId || generateTraceId();
  try {
    console.info(`[email:delivery:${traceId}] Processing queue delivery for ${payload.to}`);
    await ctx.email.sendEmail({
      to: payload.to,
      from: FROM_ADDRESS,
      subject: payload.subject,
      html: payload.html,
    });
    return true;
  } catch (err) {
    console.error(`[email:delivery:${traceId}] Email send error:`, err);
    return false;
  }
}

export function buildEmailLayout(subtitle: string, content: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 40px 20px;">
      <div style="background: #ffffff; padding: 28px 24px 20px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #d4af37; text-align: center;">
        <img src="https://bmi-portal.hkmministries.org/bmi-logo.png" alt="BMI University" style="height: 72px; width: auto; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto;" />
        <h1 style="color: #0f172a; margin: 0; font-size: 22px; letter-spacing: 0.5px;">BMI University</h1>
        <p style="color: #475569; margin: 4px 0 0; font-size: 13px;">${subtitle}</p>
      </div>
      <div style="background: #fff; padding: 32px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        ${content}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
        <p style="color: #94a3b8; font-size: 13px;">
          Questions? Email us at <a href="mailto:bmiuniversity8@gmail.com" style="color: #d4af37;">bmiuniversity8@gmail.com</a><br>
          or call us at 704-607-5540
        </p>
      </div>
    </div>
  `;
}

export function welcomeEmail(firstName: string, portalUrl: string = PORTAL_URL): string {
  const content = `
    <h2 style="color: #0f172a;">Welcome to BMI University, ${firstName}!</h2>
    <p style="color: #475569; line-height: 1.6;">
      We are thrilled to have you join the BMI University community. Your academic journey begins now, and we are here to support you every step of the way.
    </p>
    <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #d4af37; padding: 20px; margin: 24px 0; border-radius: 8px;">
      <p style="margin: 0 0 12px; color: #78350f; font-weight: 700; font-size: 16px;">🎉 What's Next?</p>
      <ol style="color: #78350f; line-height: 2; margin: 0; padding-left: 22px;">
        <li><strong>Complete your profile</strong> — Upload your photo and personal details</li>
        <li><strong>Verify your email</strong> — Check your inbox for the verification link</li>
        <li><strong>Submit your application</strong> — Choose your program of interest</li>
        <li><strong>Upload documents</strong> — Transcripts, ID, and supporting materials</li>
      </ol>
    </div>
    <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 24px 0;">
      <p style="margin: 0 0 8px; color: #0369a1; font-weight: 600;">📚 Important Resources:</p>
      <ul style="color: #0369a1; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li><a href="${portalUrl}/status" style="color: #0284c7;">Application Status Dashboard</a></li>
        <li><a href="${portalUrl}/documents" style="color: #0284c7;">Document Upload Center</a></li>
        <li><a href="${portalUrl}/support" style="color: #0284c7;">Student Support Desk</a></li>
      </ul>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      If you have any questions, our admissions team is here to help. Reply to this email or call us at 704-607-5540.
    </p>
    <a href="${portalUrl}/login"
       style="display: inline-block; background: #d4af37; color: #0f172a; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px; margin-top: 20px;">
      Access Your Student Portal →
    </a>
  `;
  return buildEmailLayout('Welcome to BMI University', content);
}

export function emailVerificationEmail(firstName: string, verificationToken: string, portalUrl: string = PORTAL_URL): string {
  const verifyUrl = `${portalUrl}/verify?token=${encodeURIComponent(verificationToken)}`;
  const content = `
    <h2 style="color: #0f172a;">Hi ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      Please verify your email address to activate your BMI University account. This step ensures we can send you important updates about your application and enrollment.
    </p>
    <div style="margin: 32px 0; text-align: center;">
      <a href="${verifyUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #d4af37 0%, #b45309 100%); color: #0f172a; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; box-shadow: 0 4px 14px rgba(212, 175, 55, 0.4);">
        ✉️ Verify Your Email Address
      </a>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      <strong>Or copy and paste this link into your browser:</strong>
    </p>
    <div style="background: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; word-break: break-all; font-family: monospace; font-size: 12px; color: #334155;">
      ${verifyUrl}
    </div>
    <div style="margin-top: 28px; padding: 16px; background: #fef2f2; border-radius: 6px; border-left: 3px solid #ef4444;">
      <p style="margin: 0; color: #991b1b; font-size: 13px; line-height: 1.5;">
        ⏰ <strong>This link expires in 24 hours.</strong> If you don't verify within this time, you'll need to request a new verification email.
      </p>
    </div>
    <p style="color: #94a3b8; font-size: 13px; margin-top: 20px; line-height: 1.5;">
      If you did not create an account at BMI University, you can safely ignore this email — your information will not be used.
    </p>
  `;
  return buildEmailLayout('Verify Your Email Address', content);
}

export function accountActivationConfirmationEmail(firstName: string, email: string, portalUrl: string = PORTAL_URL): string {
  const content = `
    <h2 style="color: #0f172a;">🎉 Account Activated, ${firstName}!</h2>
    <p style="color: #475569; line-height: 1.6;">
      Your BMI University account has been successfully activated. You now have full access to our student portal and all applicant services.
    </p>
    <div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px; padding: 24px; margin: 24px 0;">
      <p style="margin: 0 0 12px; color: #15803d; font-weight: 700; font-size: 17px;">✅ Your Account Details</p>
      <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; color: #166534; font-size: 14px;">
        <div style="font-weight: 600;">Name:</div><div>${firstName}</div>
        <div style="font-weight: 600;">Email:</div><div>${email}</div>
        <div style="font-weight: 600;">Status:</div><div style="color: #15803d;"><strong>✓ Active & Verified</strong></div>
      </div>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      Here's what you can do now:
    </p>
    <ul style="color: #475569; line-height: 2; margin: 16px 0 24px; padding-left: 22px;">
      <li>📝 <strong>Submit your application</strong> for your chosen program</li>
      <li>📎 <strong>Upload required documents</strong> (transcripts, ID, etc.)</li>
      <li>👥 <strong>Request recommendations</strong> from your referees</li>
      <li>📊 <strong>Track your application status</strong> in real-time</li>
    </ul>
    <a href="${portalUrl}/dashboard"
       style="display: inline-block; background: #22c55e; color: #ffffff; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
      Go to Your Dashboard →
    </a>
  `;
  return buildEmailLayout('Account Activated Successfully', content);
}

export function registrationRejectionEmail(
  firstName: string,
  program: string,
  reason: string = 'Unfortunately, after careful consideration, we are unable to offer you admission to BMI University at this time.',
  reviewerNotes?: string
): string {
  const content = `
    <h2 style="color: #0f172a;">Dear ${firstName},</h2>
    <p style="color: #475569; line-height: 1.7;">
      Thank you for the time and effort you put into your application to BMI University. We carefully review every application, and we appreciate your interest in our <strong>${program}</strong> program.
    </p>
    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; margin: 24px 0; border-radius: 4px;">
      <p style="margin: 0; color: #991b1b; line-height: 1.7;">
        ${reason}
      </p>
    </div>
    ${reviewerNotes ? `
    <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin: 16px 0; border-radius: 4px;">
      <p style="margin: 0 0 8px; color: #92400e; font-weight: 600; font-size: 14px;">💡 Feedback from Admissions Team:</p>
      <p style="margin: 0; color: #78350f; line-height: 1.6; font-size: 14px;">
        ${reviewerNotes}
      </p>
    </div>
    ` : ''}
    <div style="margin: 28px 0; padding: 20px; background: #f8fafc; border-radius: 8px;">
      <p style="margin: 0 0 12px; color: #0f172a; font-weight: 600;">🔄 Options Available:</p>
      <ul style="color: #475569; line-height: 1.9; margin: 0; padding-left: 22px;">
        <li><strong>Reapply next intake</strong> — Many successful students reapply after strengthening their application</li>
        <li><strong>Consider alternate programs</strong> — We offer programs across multiple disciplines</li>
        <li><strong>Contact admissions</strong> — Schedule a consultation for personalized guidance</li>
      </ul>
    </div>
    <p style="color: #475569; line-height: 1.7;">
      This decision is not a reflection of your worth or potential. We encourage you to continue pursuing your academic goals and hope you'll consider BMI University again in the future.
    </p>
    <p style="color: #475569; line-height: 1.7; margin-top: 20px;">
      If you have questions about this decision or would like feedback on strengthening your application, please contact our admissions office at <a href="mailto:bmiuniversity8@gmail.com" style="color: #d4af37;">bmiuniversity8@gmail.com</a>.
    </p>
    <div style="text-align: center; margin-top: 28px;">
      <a href="mailto:bmiuniversity8@gmail.com"
         style="display: inline-block; background: #f1f5f9; color: #0f172a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; border: 1px solid #cbd5e1;">
        Contact Admissions Team
      </a>
    </div>
  `;
  return buildEmailLayout('Application Status Update', content);
}

export function accountSetupPromptEmail(firstName: string, program: string, admissionCode: string, portalUrl: string = PORTAL_URL): string {
  const claimUrl = `${portalUrl}/claim?code=${encodeURIComponent(admissionCode)}`;
  const content = `
    <h2 style="color: #0f172a;">🎓 Set Up Your Student Account, ${firstName}</h2>
    <p style="color: #475569; line-height: 1.6;">
      Congratulations again on your admission to BMI University's <strong>${program}</strong> program! To get started, you'll need to complete your account setup.
    </p>
    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 10px; padding: 28px; margin: 24px 0; text-align: center;">
      <p style="margin: 0 0 12px; color: #15803d; font-weight: 700; font-size: 16px;">🔑 Your One-Time Admission Code</p>
      <div style="background: #0f172a; border-radius: 8px; padding: 16px 24px; display: inline-block; margin: 8px 0;">
        <span style="color: #d4af37; font-size: 28px; font-weight: 900; letter-spacing: 6px; font-family: 'Courier New', monospace;">${admissionCode}</span>
      </div>
      <p style="margin: 8px 0 0; color: #15803d; font-size: 13px;">
        ⏰ Expires in <strong>7 days</strong>
      </p>
    </div>
    <div style="margin: 24px 0;">
      <p style="margin: 0 0 12px; color: #0f172a; font-weight: 600;">Setup Steps:</p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: #d4af37; color: #0f172a; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">1</div>
          <div><p style="margin: 0; color: #334155;"><strong>Click the button below</strong> to go to the account claim page</p></div>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: #d4af37; color: #0f172a; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">2</div>
          <div><p style="margin: 0; color: #334155;"><strong>Enter your admission code</strong> if not auto-filled</p></div>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: #d4af37; color: #0f172a; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">3</div>
          <div><p style="margin: 0; color: #334155;"><strong>Create a secure password</strong> for your student account</p></div>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: #d4af37; color: #0f172a; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">4</div>
          <div><p style="margin: 0; color: #334155;"><strong>Complete your profile</strong> and begin onboarding</p></div>
        </div>
      </div>
    </div>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${claimUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); color: #ffffff; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; box-shadow: 0 4px 14px rgba(34, 197, 94, 0.4);">
        Claim Your Student Account →
      </a>
    </div>
    <p style="color: #64748b; font-size: 12px; line-height: 1.6; text-align: center; margin-top: 16px;">
      If the button doesn't work, go to <a href="${portalUrl}/claim" style="color: #d4af37;">${portalUrl}/claim</a> and enter your code manually.
    </p>
  `;
  return buildEmailLayout('Complete Your Account Setup', content);
}

export function applicationSubmittedEmail(firstName: string, program: string, applicationId: string): string {
  const content = `
    <h2 style="color: #0f172a;">Dear ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      Thank you for submitting your application to <strong>BMI University</strong>. We have received your application for:
    </p>
    <div style="background: #f8fafc; border-left: 4px solid #d4af37; padding: 16px; margin: 20px 0; border-radius: 4px;">
      <strong style="color: #0f172a;">${program}</strong>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      <strong>Application Reference:</strong> <code style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px;">${applicationId.substring(0, 8).toUpperCase()}</code>
    </p>
    <p style="color: #475569; line-height: 1.6;">
      Our admissions team will review your application and contact you within <strong>5–10 business days</strong>. 
      You can track your application status at any time by logging into your portal.
    </p>
    <div style="margin: 24px 0; padding: 16px; background: #f8fafc; border-radius: 8px;">
      <p style="margin: 0 0 8px; color: #475569; font-weight: 600;">Next Steps:</p>
      <ol style="color: #475569; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li>Upload your transcripts and ID documents in the portal</li>
        <li>Request letters of recommendation from your referees</li>
      </ol>
    </div>
    <a href="${PORTAL_URL}/status" 
       style="display: inline-block; background: #d4af37; color: #0f172a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 16px;">
      Track Application Status
    </a>
  `;
  return buildEmailLayout('Application Received', content);
}

export function statusUpdateEmail(firstName: string, newStatus: string, program: string, notes?: string, admissionCode?: string): string {
  const statusMessages: Record<string, string> = {
    under_review: 'Your application is now under review by our admissions committee.',
    accepted: 'Congratulations! You have been accepted to BMI University. Welcome to the BMI family!',
    rejected: 'After careful review, we are unable to offer you admission at this time.',
    waitlisted: 'You have been placed on our waitlist. We will contact you if a space becomes available.',
  };

  const content = `
    <h2 style="color: #0f172a;">Dear ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      There is an update regarding your application for <strong>${program}</strong>:
    </p>
    <p style="color: #0f172a; font-size: 18px; font-weight: bold;">${statusMessages[newStatus] || `Status updated to: ${newStatus.replace('_', ' ')}`}</p>
    ${notes ? `<p style="color: #475569; line-height: 1.6; font-style: italic;">${notes}</p>` : ''}
    ${newStatus === 'rejected' ? registrationRejectionEmail(firstName, program, notes) : ''}
    ${admissionCode && newStatus === 'accepted' ? `
    <div style="margin: 24px 0; padding: 20px 24px; background: #f0fdf4; border: 2px solid #22c55e; border-radius: 8px;">
      <p style="margin: 0 0 8px; color: #15803d; font-weight: 700; font-size: 15px;">🎓 Activate Your Student Account</p>
      <p style="margin: 0 0 12px; color: #475569; font-size: 14px; line-height: 1.5;">
        Use the one-time admission code below to set up your password and access your student portal. This code expires in <strong>7 days</strong>.
      </p>
      <div style="background: #0f172a; border-radius: 6px; padding: 12px 20px; text-align: center; margin-bottom: 16px;">
        <span style="color: #d4af37; font-size: 22px; font-weight: 900; letter-spacing: 4px; font-family: monospace;">${admissionCode}</span>
      </div>
      <a href="${PORTAL_URL}/claim?code=${encodeURIComponent(admissionCode)}"
         style="display: inline-block; background: #22c55e; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        Claim Your Account →
      </a>
    </div>` : ''}
    <a href="${PORTAL_URL}/status"
       style="display: inline-block; background: #d4af37; color: #0f172a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 16px;">
      View Application Status
    </a>
  `;
  return buildEmailLayout('Application Update', content);
}

export function invoiceCreatedEmail(
  firstName: string,
  invoice: { id: string; amount: number; description: string; due_date: string }
): string {
  const amountFormatted = `$${Number(invoice.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const content = `
    <h2 style="color: #0f172a;">Hi ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      A new invoice has been generated for your BMI University account.
    </p>
    <div style="background: #f8fafc; border-left: 4px solid #d4af37; padding: 20px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 8px 0;"><strong>Invoice ID:</strong> ${invoice.id.substring(0, 8).toUpperCase()}</p>
      <p style="margin: 8px 0;"><strong>Description:</strong> ${invoice.description}</p>
      <p style="margin: 8px 0;"><strong>Amount Due:</strong> <span style="color: #dc2626; font-size: 18px; font-weight: bold;">${amountFormatted}</span></p>
      <p style="margin: 8px 0;"><strong>Due Date:</strong> ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'Due upon receipt'}</p>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      Please log in to the student portal to view your invoice details and make a payment.
    </p>
    <a href="${PORTAL_URL}/student/finances"
       style="display: inline-block; background: #d4af37; color: #0f172a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 12px;">
      View Invoice & Pay Now
    </a>
  `;
  return buildEmailLayout('New Invoice Available', content);
}

export function lmsEnrollmentEmail(firstName: string, courseCount: number, programName: string, lmsUrl?: string): string {
  const finalLmsUrl = lmsUrl || `${PORTAL_URL}/student/academics`;
  const content = `
    <h2 style="color: #0f172a;">Hi ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      You have been enrolled in the Learning Management System (LMS) for your <strong>${programName}</strong> programme.
    </p>
    <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #15803d;">
        <strong>${courseCount}</strong> course${courseCount === 1 ? '' : 's'} ha${courseCount === 1 ? 's' : 've'} been added to your LMS dashboard.
      </p>
    </div>
    <div style="background: #f0f9ff; padding: 16px; border-radius: 6px; margin: 16px 0;">
      <p style="margin: 0 0 8px; color: #0369a1; font-weight: 600;">📚 What You'll Find in the LMS:</p>
      <ul style="margin: 0; padding-left: 20px; color: #0369a1; line-height: 1.8; font-size: 14px;">
        <li>Course syllabi and learning objectives</li>
        <li>Lecture notes, presentations, and reading materials</li>
        <li>Assignment submission portals</li>
        <li>Quizzes and assessments</li>
        <li>Discussion forums with peers and instructors</li>
        <li>Grade tracking and academic progress</li>
      </ul>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      Access your LMS now to begin exploring your courses. Check back regularly for new announcements and materials from your instructors.
    </p>
    <a href="${finalLmsUrl}"
       style="display: inline-block; background: #22c55e; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 12px;">
      Go to My Courses →
    </a>
  `;
  return buildEmailLayout('LMS Enrollment Complete', content);
}

export function documentReadyEmail(firstName: string, docType: string): string {
  const docLabels: Record<string, string> = {
    admission_letter: 'Admission Letter',
    id_card: 'Student ID Card',
    transcript: 'Academic Transcript',
    good_standing: 'Letter of Good Standing',
  };
  const label = docLabels[docType] || docType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const content = `
    <h2 style="color: #0f172a;">Hi ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      Your <strong>${label}</strong> is now available in the student portal.
    </p>
    <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #0369a1;">
        <strong>Document:</strong> ${label}
      </p>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      You can view, download, and share your document from the Documents section of the portal. Your documents are stored securely and are available for download at any time.
    </p>
    <div style="background: #fffbeb; padding: 14px; border-radius: 6px; margin: 16px 0;">
      <p style="margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;">
        💡 <strong>Tip:</strong> Keep digital copies of all your official documents in a secure location. You'll need them for registration, financial aid, and employment verification.
      </p>
    </div>
    <a href="${PORTAL_URL}/student/documents"
       style="display: inline-block; background: #0ea5e9; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 12px;">
      View My Documents →
    </a>
  `;
  return buildEmailLayout(`${label} Ready`, content);
}

export function staffWelcomeEmail(
  firstName: string,
  designation: string,
  email: string,
  tempPassword: string,
  umsUrl: string
): string {
  const content = `
    <h2 style="color:#0f172a;">Welcome to BMI University, ${firstName}!</h2>
    <p style="color:#475569;line-height:1.6;">
      An administrator has provisioned a <strong>${designation}</strong> account for you on the University Management System (UMS).
    </p>
    <div style="background:#f8fafc;border-left:4px solid #d4af37;padding:16px;margin:24px 0;border-radius:4px;">
      <p style="margin:0 0 8px;"><strong>Login Portal:</strong> <a href="${umsUrl}" style="color:#6b21a8;">${umsUrl}</a></p>
      <p style="margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
      <p style="margin:0;"><strong>Temporary Password:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;">${tempPassword}</code></p>
    </div>
    <p style="color:#dc2626;font-weight:bold;">⚠ You will be required to set a new password on first login.</p>
    <p style="color:#94a3b8;font-size:13px;">
      If you did not expect this email, contact your system administrator immediately.
    </p>
  `;
  return buildEmailLayout('Account Created', content);
}

export function passwordResetEmail(
  firstName: string,
  resetUrl: string,
  options?: { isStaff?: boolean; isAdminAction?: boolean }
): string {
  const isStaff = options?.isStaff ?? false;
  const isAdminAction = options?.isAdminAction ?? false;
  const systemLabel = isStaff ? 'University Management System (UMS)' : 'Student Portal';
  const subtitle = isAdminAction ? 'Password Reset by Administrator' : `Password Reset — ${systemLabel}`;

  const content = `
    <h2 style="color: #0f172a;">Hi ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      ${isAdminAction
        ? 'An administrator has initiated a password reset for your BMI University account.'
        : `We received a request to reset your BMI University password for the <strong>${systemLabel}</strong>.`}
      Please click the button below to set a new password:
    </p>
    <div style="margin: 32px 0; text-align: center;">
      <a href="${resetUrl}"
         style="display: inline-block; background: #d4af37; color: #0f172a; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
        Reset Password
      </a>
    </div>
    <p style="color: #94a3b8; font-size: 13px;">
      Or copy this link into your browser:<br>
      <a href="${resetUrl}" style="color: #d4af37; word-break: break-all;">${resetUrl}</a>
    </p>
    <p style="color: #94a3b8; font-size: 13px;">
      This link expires in <strong>${isAdminAction ? '24 hours' : '1 hour'}</strong>. If you didn't request this, you can safely ignore this email.
    </p>
  `;
  return buildEmailLayout(subtitle, content);
}

export function recommendationRequestEmail(
  refereeName: string,
  applicantName: string,
  program: string,
  uploadUrl: string
): string {
  const content = `
    <h2 style="color: #0f172a;">Dear ${refereeName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      <strong>${applicantName}</strong> has applied to the <strong>${program}</strong> program at BMI University and has requested a letter of recommendation from you.
    </p>
    <p style="color: #475569; line-height: 1.6;">
      Please use the secure link below to upload your recommendation letter. This link is unique to you and will expire after 30 days.
    </p>
    <div style="margin: 24px 0; text-align: center;">
      <a href="${uploadUrl}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:white;text-decoration:none;border-radius:6px;font-weight:bold;">Upload Recommendation Letter</a>
    </div>
    <p style="color: #475569; line-height: 1.6; font-size: 13px;">Or copy this link: <a href="${uploadUrl}" style="color:#d4af37;">${uploadUrl}</a></p>
  `;
  return buildEmailLayout('Recommendation Request', content);
}

export function recommendationReceivedEmail(
  firstName: string,
  portalUrl: string = PORTAL_URL
): string {
  const content = `
    <h2 style="color: #0f172a;">Dear ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      A recommendation letter has been received and added to your application.
    </p>
    <div style="margin: 24px 0; text-align: center;">
      <a href="${portalUrl}/status" style="display:inline-block;padding:12px 24px;background:#d4af37;color:#0f172a;text-decoration:none;border-radius:6px;font-weight:bold;">View Application Status</a>
    </div>
  `;
  return buildEmailLayout('Recommendation Received', content);
}

export function onboardingStepCompletedEmail(
  firstName: string,
  _stepId: string,
  stepTitle: string,
  progress: number = 33
): string {
  const content = `
    <h2 style="color: #0f172a;">Great progress, ${firstName}!</h2>
    <p style="color: #475569; line-height: 1.6;">
      You've completed: <strong style="color: #22c55e;">${stepTitle}</strong>
    </p>
    <div style="margin: 24px 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span style="color: #64748b; font-size: 13px; font-weight: 600;">Onboarding Progress</span>
        <span style="color: #0f172a; font-size: 13px; font-weight: 700;">${progress}%</span>
      </div>
      <div style="background: #e2e8f0; border-radius: 9999px; height: 14px; overflow: hidden;">
        <div style="background: linear-gradient(90deg, #d4af37, #22c55e); height: 100%; width: ${progress}%; border-radius: 9999px; transition: width 0.6s ease;"></div>
      </div>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      You're doing great! Keep going to complete your student onboarding and unlock full access to all BMI University services.
    </p>
    <a href="${PORTAL_URL}/dashboard"
       style="display: inline-block; background: #d4af37; color: #0f172a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 12px;">
      Continue Onboarding →
    </a>
  `;
  return buildEmailLayout(`Onboarding: ${stepTitle}`, content);
}

export async function safeDispatchEmail(
  env: Env,
  ctx: ExecutionContext | undefined,
  payload: EmailPayload
): Promise<void> {
  const traceId = payload.traceId || generateTraceId();
  const tracedPayload = { ...payload, traceId };

  console.info(`[email:dispatch:${traceId}] Safe dispatch initiated: ${tracedPayload.subject.substring(0, 50)} → ${tracedPayload.to}`);

  const emailPromise = sendEmail(env, tracedPayload).then(success => {
    if (success) {
      console.info(`[email:dispatch:${traceId}] Safe dispatch completed successfully`);
    } else {
      console.warn(`[email:dispatch:${traceId}] Safe dispatch completed with failure (non-blocking)`);
    }
    return success;
  }).catch(e => {
    console.error(`[email:dispatch:${traceId}] Safe dispatch caught error (non-blocking):`, e?.message || String(e));
    return false;
  });

  if (ctx) {
    ctx.waitUntil(emailPromise);
  } else {
    await emailPromise;
  }
}
