import { PORTAL_URL, ADMISSIONS_EMAIL } from '@bmi/shared';

const FROM_ADDRESS = `BMI University <${ADMISSIONS_EMAIL}>`;

import type { Env } from './types';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  traceId?: string;
  templateName?: string;
  context?: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Core Email Delivery ─────────────────────────────────────────────────────
//
// Design principles (2026 best practices):
//   1. Direct Resend REST API — no intermediary queues for transactional mail.
//   2. Synchronous await — caller gets confirmation before proceeding.
//   3. Exponential backoff retry with jitter (max 3 attempts).
//   4. Console-based observability — structured logs, no D1 dependency.
//   5. Fail-safe — errors are caught and logged, never crash the caller.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;

function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 15000);
}

/**
 * Send a single email via the Resend REST API with retry.
 * Returns `true` when Resend accepts the message (HTTP 2xx).
 */
export async function sendEmail(env: Env, payload: EmailPayload): Promise<boolean> {
  const traceId = payload.traceId || generateTraceId();
  const tag = `[email:${traceId}]`;

  // ── Pre-flight checks ──────────────────────────────────────────────────
  if (!isValidEmail(payload.to)) {
    console.error(`${tag} REJECTED — invalid recipient: ${payload.to}`);
    return false;
  }
  if (!payload.subject || !payload.html) {
    console.error(`${tag} REJECTED — missing subject or html body for: ${payload.to}`);
    return false;
  }
  if (!env.RESEND_API_KEY) {
    console.warn(`${tag} SKIPPED — RESEND_API_KEY not configured. Subject: "${payload.subject.substring(0, 60)}"`);
    return false;
  }

  const fromAddr = FROM_ADDRESS;

  console.info(`${tag} SENDING to=${payload.to} subject="${payload.subject.substring(0, 60)}" template=${payload.templateName || 'unknown'}`);

  // ── Retry loop ─────────────────────────────────────────────────────────
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const delay = backoffMs(attempt - 1);
      console.info(`${tag} Retry ${attempt}/${MAX_ATTEMPTS} after ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    const start = performance.now();
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: payload.to.trim(),
          subject: payload.subject,
          html: payload.html,
        }),
      });

      const ms = Math.round(performance.now() - start);

      if (res.ok) {
        let resendId = '';
        try { const j = await res.json() as { id?: string }; resendId = j.id || ''; } catch { /* ok */ }
        console.info(`${tag} DELIVERED (${res.status}) in ${ms}ms — Resend ID: ${resendId}`);
        return true;
      }

      // Non-2xx response
      const errBody = await res.text().catch(() => '(no body)');
      console.warn(`${tag} FAILED attempt ${attempt}/${MAX_ATTEMPTS} (${res.status}) in ${ms}ms: ${errBody.substring(0, 300)}`);

      // 401 = bad API key, don't retry
      if (res.status === 401) {
        console.error(`${tag} FATAL — RESEND_API_KEY is invalid (401). Aborting all retries.`);
        return false;
      }
      // 422 = validation error (bad from address, etc.), don't retry
      if (res.status === 422) {
        console.error(`${tag} FATAL — Resend validation error (422). Check from address and payload. Aborting.`);
        return false;
      }
      // 429 / 5xx = transient, retry
      continue;

    } catch (err) {
      const ms = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} NETWORK ERROR attempt ${attempt}/${MAX_ATTEMPTS} in ${ms}ms: ${msg.substring(0, 200)}`);
      continue;
    }
  }

  console.error(`${tag} EXHAUSTED — all ${MAX_ATTEMPTS} attempts failed for ${payload.to}`);
  return false;
}

/**
 * Safe, non-throwing email dispatch. Always awaits delivery confirmation.
 * Use this from route handlers — it will never throw or crash the request.
 */
export async function safeDispatchEmail(
  env: Env,
  _ctx: ExecutionContext | undefined,
  payload: EmailPayload
): Promise<void> {
  const traceId = payload.traceId || generateTraceId();
  try {
    await sendEmail(env, { ...payload, traceId });
  } catch (e: any) {
    console.error(`[email:dispatch:${traceId}] Unexpected error (swallowed): ${e?.message || String(e)}`);
  }
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
        <img src="${PORTAL_URL}/bmi-logo.png" alt="BMI University" style="height: 72px; width: auto; margin-bottom: 12px; display: block; margin-left: auto; margin-right: auto;" />
        <h1 style="color: #0f172a; margin: 0; font-size: 22px; letter-spacing: 0.5px;">BMI University</h1>
        <p style="color: #475569; margin: 4px 0 0; font-size: 13px;">${subtitle}</p>
      </div>
      <div style="background: #fff; padding: 32px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        ${content}
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
        <p style="color: #94a3b8; font-size: 13px;">
          Questions? Email us at <a href="mailto:${ADMISSIONS_EMAIL}" style="color: #d4af37;">${ADMISSIONS_EMAIL}</a><br>
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
      If you have questions about this decision or would like feedback on strengthening your application, please contact our admissions office at <a href="mailto:${ADMISSIONS_EMAIL}" style="color: #d4af37;">${ADMISSIONS_EMAIL}</a>.
    </p>
    <div style="text-align: center; margin-top: 28px;">
      <a href="mailto:${ADMISSIONS_EMAIL}"
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

export function registrationCompleteEmail(
  firstName: string,
  regNo: string,
  programName: string
): string {
  const content = `
    <h2 style="color: #0f172a;">Congratulations, ${firstName}!</h2>
    <p style="color: #475569; line-height: 1.6;">
      Your registration at BMI University has been successfully completed.
    </p>
    <div style="background:#f8fafc;border-left:4px solid #d4af37;padding:16px;margin:20px 0;border-radius:4px;">
      <p style="margin:0 0 8px;"><strong>Registration Number:</strong> ${regNo || 'Pending'}</p>
      <p style="margin:0;"><strong>Programme:</strong> ${programName || 'N/A'}</p>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      Our systems are currently provisioning your student email, ID card, and enrolling you into the LMS. You will receive separate emails as these become available.
    </p>
    <p style="color: #475569; line-height: 1.6;">
      You can now access your courses, view your timetable, and begin your academic journey.
    </p>
  `;
  return buildEmailLayout('Registration Complete', content);
}

export function courseEnrollmentConfirmationEmail(
  firstName: string,
  courseCount: number,
  programName: string,
  portalUrl: string = PORTAL_URL
): string {
  const content = `
    <h2 style="color: #0f172a;">Hi ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      You have been enrolled in <strong>${courseCount} course${courseCount === 1 ? '' : 's'}</strong> for your ${programName || 'programme'}.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:16px;margin:20px 0;border-radius:4px;">
      <p style="margin:0;color:#15803d;"><strong>Courses enrolled:</strong> ${courseCount} module${courseCount === 1 ? '' : 's'}</p>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      Log in to the student portal to view your timetable, access learning materials, and track your progress.
    </p>
    <a href="${portalUrl}/student/academics"
       style="display: inline-block; background: #22c55e; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 12px;">
      View My Courses
    </a>
  `;
  return buildEmailLayout('Enrollment Confirmed', content);
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

export function registrationProgressEmail(
  firstName: string,
  completedSteps: number,
  totalSteps: number,
  nextStepLabel: string,
  portalUrl: string = PORTAL_URL
): string {
  const progress = Math.round((completedSteps / totalSteps) * 100);
  const isMidway = completedSteps === Math.ceil(totalSteps / 2);
  const isAlmostDone = completedSteps === totalSteps - 1;

  const headline = isAlmostDone
    ? `Almost there, ${firstName}!`
    : isMidway
      ? `Halfway there, ${firstName}!`
      : `Great progress, ${firstName}!`;

  const content = `
    <h2 style="color: #0f172a;">${headline}</h2>
    <p style="color: #475569; line-height: 1.6;">
      You've completed <strong>${completedSteps} of ${totalSteps}</strong> registration steps.
    </p>
    <div style="margin: 24px 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span style="color: #64748b; font-size: 13px; font-weight: 600;">Registration Progress</span>
        <span style="color: #0f172a; font-size: 13px; font-weight: 700;">${progress}%</span>
      </div>
      <div style="background: #e2e8f0; border-radius: 9999px; height: 14px; overflow: hidden;">
        <div style="background: linear-gradient(90deg, #d4af37, #22c55e); height: 100%; width: ${progress}%; border-radius: 9999px;"></div>
      </div>
    </div>
    ${isAlmostDone ? `
    <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #15803d; font-weight: bold;">🎉 Just one more step to go!</p>
      <p style="margin: 8px 0 0; color: #15803d;">Complete <strong>${nextStepLabel}</strong> to finish your registration.</p>
    </div>` : `
    <p style="color: #475569; line-height: 1.6;">
      Your next step is: <strong>${nextStepLabel}</strong>. Log in to continue where you left off.
    </p>`}
    <a href="${portalUrl}/registration"
       style="display: inline-block; background: #d4af37; color: #0f172a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 12px;">
      Continue Registration →
    </a>
  `;
  return buildEmailLayout('Registration Progress', content);
}

export function accountClaimedWelcomeEmail(
  firstName: string,
  portalUrl: string = PORTAL_URL
): string {
  const content = `
    <h2 style="color: #0f172a;">Welcome, ${firstName}!</h2>
    <p style="color: #475569; line-height: 1.6;">
      Your account has been successfully claimed. You now have access to the BMI University Student Portal.
    </p>
    <div style="margin: 24px 0; padding: 20px 24px; background: #f8fafc; border-left: 4px solid #d4af37; border-radius: 4px;">
      <p style="margin: 0 0 8px; color: #0f172a; font-weight: 700; font-size: 15px;">Your Registration Steps:</p>
      <ol style="color: #475569; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li><strong>Upload ID Photo</strong> — Upload your student ID photo for verification</li>
        <li><strong>Complete Orientation</strong> — Complete the online orientation module</li>
        <li><strong>Course Registration</strong> — Auto-enroll in mandatory courses and select your electives</li>
        <li><strong>Pay Tuition</strong> — Pay your programme tuition fee to complete registration</li>
      </ol>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      Log in now at the student portal to begin your onboarding.
    </p>
    <a href="${portalUrl}/dashboard"
       style="display: inline-block; background: #d4af37; color: #0f172a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 12px;">
      Go to Student Portal →
    </a>
    <p style="color: #64748b; font-size: 13px; margin-top: 24px;">
      If you have any questions, contact our admissions office at <a href="mailto:${ADMISSIONS_EMAIL}" style="color: #d4af37;">${ADMISSIONS_EMAIL}</a> or call 704-607-5540.
    </p>
  `;
  return buildEmailLayout('Account Activated', content);
}

export function studentEmailProvisionedEmail(
  firstName: string,
  studentEmail: string,
  mailboxCreated: boolean,
  tempPassword?: string
): string {
  const content = `
    <h2 style="color: #0f172a;">Dear ${firstName},</h2>
    <p style="color: #475569; line-height: 1.6;">
      Your BMI University student email address has been provisioned${!mailboxCreated ? ' (note: mailbox provider not configured; provisioning pending IT setup)' : ''}.
    </p>
    <div style="background: #f8fafc; border-left: 4px solid #d4af37; padding: 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0 0 8px;"><strong>Email:</strong> ${studentEmail}</p>
      ${mailboxCreated && tempPassword
        ? `<p style="margin: 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>`
        : `<p style="margin: 0; color: #92400e;"><em>Your mailbox is being finalized by IT support — you will receive login credentials shortly.</em></p>`
      }
    </div>
    <p style="color: #475569; line-height: 1.6;">
      This email account will be used for all official university communications and services.
    </p>
    ${mailboxCreated ? `
    <div style="background: #fffbeb; padding: 14px; border-radius: 6px; margin: 16px 0;">
      <p style="margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;">
        🔐 <strong>Important:</strong> Please change your temporary password immediately after your first login.
      </p>
    </div>` : ''}
  `;
  return buildEmailLayout('Student Email Account', content);
}

export function adminNewApplicationNoticeEmail(
  applicantName: string,
  applicantEmail: string,
  program: string,
  appId: string,
  createdBy: string
): string {
  const content = `
    <h2 style="color: #0f172a;">New Application Created</h2>
    <p style="color: #475569; line-height: 1.6;">
      An application has been created on behalf of a student by <strong>${createdBy}</strong>.
    </p>
    <div style="background: #f8fafc; border-left: 4px solid #d4af37; padding: 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0 0 8px;"><strong>Applicant:</strong> ${applicantName} (${applicantEmail})</p>
      <p style="margin: 0 0 8px;"><strong>Programme:</strong> ${program}</p>
      <p style="margin: 0;"><strong>Application ID:</strong> ${appId.substring(0, 8).toUpperCase()}...</p>
    </div>
    <p style="color: #475569; line-height: 1.6;">
      The applicant will receive a notification email with instructions to complete their application.
    </p>
    <p style="color: #64748b; font-size: 13px;">Review full application details in the UMS admin dashboard.</p>
  `;
  return buildEmailLayout('Admin: Application Created', content);
}



