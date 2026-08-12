import type { IDatabase } from '@bmi/ports';
/**
 * BMI UMS — Provisioning Job Dispatcher
 */

import type { Env } from './types';

import { safeDispatchEmail, buildEmailLayout, invoiceCreatedEmail, lmsEnrollmentEmail, studentEmailProvisionedEmail, isValidEmail } from './email';

export type ProvisioningJobType = 'finance' | 'library' | 'lms' | 'portal' | 'email' | 'id_card';

export interface ProvisioningJob {
  id: string;
  uid: string;
  job_type: ProvisioningJobType;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  attempts: number;
}

export async function enqueueProvisioningJobs(db: IDatabase, uid: string): Promise<void> {
  const jobs: ProvisioningJobType[] = ['finance', 'library', 'lms', 'portal', 'email', 'id_card'];
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const jobType of jobs) {
      await tx.prepare(
        `INSERT INTO provisioning_jobs (id, uid, job_type, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?)`
      ).bind(uid, jobType, now).run();
    }
  });
}

/** Move a failed job to dead status and send ops alert. */
async function deadLetterJob(env: Env, job: ProvisioningJob, lastError: string): Promise<void> {
  await env.PLATFORM_CONTEXT!.db.prepare(
    `UPDATE provisioning_jobs SET status='dead', last_error=?, completed_at=datetime('now') WHERE id=?`
  ).bind(lastError, job.id).run();

  if (env.OPS_ALERT_EMAIL && env.RESEND_API_KEY) {
    await safeDispatchEmail(env, undefined, {
      to: env.OPS_ALERT_EMAIL,
      subject: `[BMI Portal] Provisioning Dead-Letter: ${job.job_type}`,
      html: buildEmailLayout('Provisioning Dead-Letter Alert', `
        <h2 style="color:#dc2626;">⚠ Provisioning Dead-Letter Alert</h2>
        <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;margin:20px 0;border-radius:4px;">
          <p style="margin:0 0 8px;"><strong>Job Type:</strong> ${job.job_type}</p>
          <p style="margin:0 0 8px;"><strong>UID:</strong> ${job.uid}</p>
          <p style="margin:0 0 8px;"><strong>Job ID:</strong> ${job.id}</p>
          <p style="margin:0 0 8px;"><strong>Last Error:</strong> ${lastError}</p>
          <p style="margin:0;"><strong>Time:</strong> ${new Date().toISOString()}</p>
        </div>
        <p style="color:#64748b;font-size:13px;">Review and retry at: Admin → Infrastructure → Provisioning</p>
      `),
      templateName: 'ops_dead_letter_alert',
      context: { action: 'dead_letter', job_type: job.job_type, uid: job.uid },
    }).catch(() => { });
  }
}

async function executeJob(env: Env, job: ProvisioningJob): Promise<void> {
  const ctx = env.PLATFORM_CONTEXT!;
  const uid = job.uid;

  switch (job.job_type) {
    case 'email': {
      const user = await ctx.db.prepare(
        `SELECT u.id, u.first_name, u.last_name, u.email, p.uid
         FROM users u
         JOIN persons p ON u.person_id = p.id
         WHERE p.uid = ?`
      ).bind(uid).first<{ id: string; first_name: string; last_name: string; email: string; uid: string }>();
      if (!user) throw new Error('User not found for email provisioning');

      if (user.email && !isValidEmail(user.email)) {
        console.warn('[provisioning:email] Invalid user.email for user', user.id, ':', user.email);
      }

      const emailLocal = (user.email || 'student' + uid.slice(0, 6)).split('@')[0] || 'student';
      const studentEmail = `${emailLocal}@${env.STUDENT_EMAIL_DOMAIN || 'student.bmi.edu'}`;
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      const tempPassword = Array.from(arr, (byte) => chars[byte % chars.length]).join('') + 'Aa1!';

      // RC-6: ctx.email may be unimplemented or absent — guard before calling createMailbox
      let mailboxCreated = true;
      if (!ctx.email || typeof ctx.email.createMailbox !== 'function') {
        console.info('[provisioning:email] No email mailbox provider available — persisting student_email only');
        mailboxCreated = false;
      } else {
        try {
          await ctx.email.createMailbox(uid, studentEmail, tempPassword);
        } catch (mbErr: unknown) {
          const msg = mbErr instanceof Error ? mbErr.message : String(mbErr);
          const unsupported = /(not implemented|not supported|not available|no.*mailbox|createMailbox)/i.test(msg);
          if (unsupported) {
            console.info('[provisioning:email] Mailbox provider does not support createMailbox; persisting student_email anyway. Reason:', msg);
            mailboxCreated = false;
          } else {
            console.error('[provisioning:email] createMailbox failed:', mbErr);
            throw mbErr;
          }
        }
      }

      await ctx.db.transaction(async (tx) => {
        await tx.prepare(
          `UPDATE users SET student_email = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(studentEmail, user.id).run();

        await tx.prepare(
          `INSERT OR IGNORE INTO lifecycle_events
           (id, uid, application_id, stage, status, idempotency_key, notes)
           VALUES (lower(hex(randomblob(16))), ?, NULL, 'student_email', 'completed', ?, ?)`
        ).bind(uid, `email:${uid}`, mailboxCreated ? 'Student mailbox provisioned' : 'Student email reserved (mailbox pending)').run();
      });

      if (env.RESEND_API_KEY && user.email && isValidEmail(user.email)) {
        await safeDispatchEmail(env, undefined, {
          to: user.email,
          subject: 'BMI University — Your Student Email Account',
          html: studentEmailProvisionedEmail(user.first_name, studentEmail, mailboxCreated, mailboxCreated ? tempPassword : undefined),
          templateName: 'student_email_provisioned',
          context: { action: 'student_email_provisioned', uid, student_email: studentEmail },
        });
      }
      break;
    }

    case 'lms': {
      const student = await ctx.db.prepare(
        `SELECT s.user_id, s.program, p.uid
         FROM students s
         JOIN persons p ON s.user_id = (SELECT id FROM users WHERE person_id = p.id LIMIT 1)
         WHERE p.uid = ?`
      ).bind(uid).first<{ user_id: string; program: string; uid: string }>();
      if (!student) {
        console.warn(`[provisioning] LMS: No student found for uid ${uid} — skipping`);
        return;
      }

      const courses = await ctx.db.prepare(
        `SELECT id FROM courses WHERE program_id = (
           SELECT program_id FROM student_programs WHERE uid = ? AND current_flag = 1 LIMIT 1
         ) LIMIT 5`
      ).bind(uid).all<{ id: string }>();

      const enrolled: string[] = [];
      if (courses?.results?.length) {
        for (const course of courses.results) {
          try {
            // RC-5: ctx.lms is unimplemented in Cloudflare bootstrap — guard gracefully
            if (!ctx.lms || typeof (ctx.lms as any).enrollStudent !== 'function') {
              console.info(`[provisioning:lms] LMS provider not configured — skipping enrollment for course ${course.id}`);
              break;
            }
            await ctx.lms.enrollStudent(student.user_id, course.id);
            enrolled.push(course.id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Unimplemented proxy throws a specific message — skip without dead-lettering
            if (/no real adapter is configured/i.test(msg)) {
              console.info(`[provisioning:lms] LMS adapter not yet wired — skipping (${msg.substring(0, 80)})`);
              break;
            }
            console.warn(`[provisioning] LMS enroll failed for course ${course.id}:`, e);
          }
        }
      }

      await ctx.db.transaction(async (tx) => {
        await tx.prepare(
          `INSERT OR IGNORE INTO lifecycle_events
           (id, uid, application_id, stage, status, idempotency_key, notes)
           VALUES (lower(hex(randomblob(16))), ?, NULL, 'lms_provisioned', 'completed', ?, ?)`
        ).bind(uid, `lms:${uid}`, `Enrolled in ${enrolled.length} course(s)`).run();
      });

      // RC #9: send LMS enrollment notification email
      if (env.RESEND_API_KEY && enrolled.length > 0) {
        const userRec = await ctx.db.prepare(
          `SELECT u.first_name, u.email FROM users u WHERE u.id = ?`
        ).bind(student.user_id).first<{ first_name: string; email: string }>();
        if (userRec && userRec.email && isValidEmail(userRec.email)) {
          await safeDispatchEmail(env, undefined, {
            to: userRec.email,
            subject: 'BMI University — LMS Enrollment Complete',
            html: lmsEnrollmentEmail(userRec.first_name, enrolled.length, student.program),
            templateName: 'lms_enrollment_complete',
            context: { action: 'lms_enrollment', uid, course_count: enrolled.length },
          });
        }
      }
      break;
    }

    case 'finance': {
      const studentRow = await ctx.db.prepare(
        `SELECT s.user_id, s.program, p.uid
         FROM students s
         JOIN persons p ON s.user_id = (SELECT id FROM users WHERE person_id = p.id LIMIT 1)
         WHERE p.uid = ?`
      ).bind(uid).first<{ user_id: string; program: string }>();
      if (!studentRow) throw new Error('Student not found for finance provisioning');

      const invoiceId = crypto.randomUUID().replace(/-/g, '');
      const invoiceAmount = 1000;
      const invoiceDesc = `Tuition fee: ${studentRow.program || 'Program'}`;

      await ctx.db.transaction(async (tx) => {
        await tx.prepare(
          `INSERT INTO invoices (id, student_id, uid, amount, due_date, status, created_at)
           VALUES (?, ?, ?, ?, datetime('now', '+30 days'), 'unpaid', datetime('now'))`
        ).bind(invoiceId, studentRow.user_id, uid, invoiceAmount).run();

        await tx.prepare(
          `INSERT OR IGNORE INTO lifecycle_events
           (id, uid, application_id, stage, status, idempotency_key, notes)
           VALUES (lower(hex(randomblob(16))), ?, NULL, 'invoice_created', 'completed', ?, ?)`
        ).bind(uid, `invoice:${invoiceId}`, `Invoice ${invoiceId.slice(0, 8)} created for ${invoiceDesc}`).run();
      });

      // RC #9: send invoice created notification email
      if (env.RESEND_API_KEY) {
        const userRec = await ctx.db.prepare(
          `SELECT u.first_name, u.email FROM users u WHERE u.id = ?`
        ).bind(studentRow.user_id).first<{ first_name: string; email: string }>();
        if (userRec && userRec.email && isValidEmail(userRec.email)) {
          await safeDispatchEmail(env, undefined, {
            to: userRec.email,
            subject: 'BMI University — Invoice Ready',
            html: invoiceCreatedEmail(userRec.first_name, {
              id: invoiceId,
              amount: invoiceAmount,
              description: invoiceDesc,
              due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }),
            templateName: 'invoice_created',
            context: { action: 'invoice_created', uid, invoice_id: invoiceId },
          });
        }
      }
      break;
    }

    case 'library': {
      await ctx.db.prepare(
        `INSERT OR IGNORE INTO library_members (uid, status, created_at)
         VALUES (?, 'active', datetime('now'))`
      ).bind(uid).run();
      break;
    }

    case 'portal': {
      await ctx.db.prepare(
        `UPDATE provisioning_jobs SET status='completed', completed_at=datetime('now') WHERE id=?`
      ).bind(job.id).run();
      break;
    }

    case 'id_card': {
      const info = await ctx.db.prepare(
        `SELECT u.first_name, u.last_name, s.reg_no, s.program, p.uid
         FROM persons p
         JOIN users u ON u.person_id = p.id
         JOIN students s ON s.user_id = u.id
         WHERE p.uid = ?`
      ).bind(uid).first<{ first_name: string; last_name: string; reg_no: string; program: string; uid: string }>();

      if (info && ctx.document) {
        await ctx.document.generateDocument({
          type: 'id_card',
          userId: uid,
          metadata: {
            name: `${info.first_name} ${info.last_name}`,
            uid: info.uid,
            regNo: info.reg_no,
            program: info.program,
          },
        });
      }
      break;
    }

    default:
      throw new Error(`Unknown provisioning job type: ${job.job_type}`);
  }
}

export async function processProvisioningJob(env: Env, job: ProvisioningJob): Promise<void> {
  const delays = [1000, 4000, 16000];

  await env.PLATFORM_CONTEXT!.db.prepare(`UPDATE provisioning_jobs SET status='processing' WHERE id=?`)
    .bind(job.id).run();

  for (let attempt = job.attempts; attempt < 3; attempt++) {
    if (attempt > job.attempts) {
      await new Promise(r => setTimeout(r, delays[attempt - 1]));
    }

    let lastError = '';
    try {
      await executeJob(env, job);

      await env.PLATFORM_CONTEXT!.db.prepare(
        `UPDATE provisioning_jobs SET status='completed', attempts=?, completed_at=datetime('now') WHERE id=?`
      ).bind(attempt + 1, job.id).run();
      return;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    await env.PLATFORM_CONTEXT!.db.prepare(
      `UPDATE provisioning_jobs SET attempts=?, last_error=?, status='failed' WHERE id=?`
    ).bind(attempt + 1, lastError, job.id).run().catch(() => { });

    if (attempt === 2) {
      await deadLetterJob(env, job, lastError);
    }
  }
}

export async function dispatchPendingJobs(env: Env): Promise<void> {
  const { results } = await env.PLATFORM_CONTEXT!.db.prepare(
    `SELECT * FROM provisioning_jobs WHERE status IN ('pending', 'failed') AND attempts < 3 LIMIT 20`
  ).all<ProvisioningJob>();

  const promises = results.map(job => processProvisioningJob(env, job));
  await Promise.allSettled(promises);
}
