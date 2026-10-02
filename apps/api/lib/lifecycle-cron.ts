import type { Env } from './types';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { runTermCensusJob } from './census-job';
import { dispatchPendingJobs } from './provisioning';
import { setEnrollmentStatus, ENROLLMENT_STATUS } from './state-machine';
import { safeDispatchEmail, isValidEmail } from './email';

export interface LifecycleCronReport {
  census: { run: boolean; enrolledCount?: number; error?: string };
  offerExpiry: { checked: number; expired: number; remindersSent: number; error?: string };
  provisioningRetries: { run: boolean; error?: string };
  reconciliation: { run: boolean; discrepanciesFound: number; error?: string };
}

/**
 * Automated Lifecycle Scheduled Jobs.
 * Runs on cron triggers (e.g. nightly) to execute automated census confirmation,
 * offer lapse and expiry reminders, provisioning retry sweeps, and nightly
 * system reconciliation.
 */
export async function runLifecycleCronJobs(
  env: Env,
  ctx?: ExecutionContext
): Promise<LifecycleCronReport> {
  const db = env.PLATFORM_CONTEXT!.db;
  const report: LifecycleCronReport = {
    census: { run: false },
    offerExpiry: { checked: 0, expired: 0, remindersSent: 0 },
    provisioningRetries: { run: false },
    reconciliation: { run: false, discrepanciesFound: 0 },
  };

  // 1. Automated Term Census Job
  try {
    const censusResult = await runTermCensusJob(db, undefined, 'system_cron_census');
    report.census = {
      run: true,
      enrolledCount: censusResult.enrolledCount,
    };
  } catch (err: unknown) {
    report.census = {
      run: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. Offer Expiry Sweep & Reminders
  try {
    const now = new Date();
    const threeDaysFromNow = new Date(Date.now() + 3 * 86400000);

    const decisionsQuery = await db.prepare(
      `SELECT d.id, d.application_id, d.offer_expires_at, d.decision,
              a.user_id, a.program, a.status as app_status, u.email, u.first_name
       FROM admissions_decisions d
       JOIN applications a ON a.id = d.application_id
       JOIN users u ON u.id = a.user_id
       WHERE d.decision IN ('admit', 'conditional')
         AND d.offer_expires_at IS NOT NULL
         AND a.status = 'accepted'`
    ).all<{
      id: string;
      application_id: string;
      offer_expires_at: string;
      decision: string;
      user_id: string;
      program: string;
      app_status: string;
      email: string;
      first_name: string;
    }>();

    const decisions = decisionsQuery?.results || [];
    report.offerExpiry.checked = decisions.length;

    for (const dec of decisions) {
      const expiryDate = new Date(dec.offer_expires_at);

      if (now > expiryDate) {
        // Offer has expired and was not accepted
        await db.transaction(async (tx) => {
          await tx.prepare(
            `UPDATE applications SET status = 'rejected', updated_at = ? WHERE id = ?`
          ).bind(now.toISOString(), dec.application_id).run();

          await tx.prepare(
            `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
             VALUES (?, ?, 'system_offer_expiry', 'accepted', 'rejected', 'Admission offer expired past deadline', ?)`
          ).bind(crypto.randomUUID(), dec.application_id, now.toISOString()).run();
        });

        await setEnrollmentStatus(db, {
          userId: dec.user_id,
          status: ENROLLMENT_STATUS.DENIED,
          changedBy: 'system_offer_expiry',
          reason: 'Admission offer expired past deadline without acceptance',
        });

        report.offerExpiry.expired++;
      } else if (expiryDate <= threeDaysFromNow) {
        // Send impending expiry reminder (once only)
        const reminderKey = `offer_reminder_sent_${dec.application_id}`;
        const sentRow = await db.prepare(
          `SELECT value FROM metadata WHERE id = ? AND key = ?`
        ).bind(dec.user_id, reminderKey).first<{ value: string }>();

        if (!sentRow && isValidEmail(dec.email)) {
          const daysLeft = Math.max(1, Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000));
          const reminderHtml = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #0f172a;">Reminder: Your Admission Offer to BMI University Expires Soon</h2>
              <p>Dear ${dec.first_name},</p>
              <p>This is a reminder that your admission offer for the <strong>${dec.program}</strong> program will expire in <strong>${daysLeft} days</strong> on ${expiryDate.toLocaleDateString()}.</p>
              <p>To secure your seat, please log in to your applicant portal and accept your offer before the deadline.</p>
              <p style="margin-top: 30px;"><a href="https://portal.bmiuniversities.org/status" style="background: #1e3a8a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Accept Your Offer Now</a></p>
            </div>
          `;

          await safeDispatchEmail(env, ctx, {
            to: dec.email,
            subject: `Action Required: Your BMI University Admission Offer Expires in ${daysLeft} Days`,
            html: reminderHtml,
            templateName: 'offer_expiry_reminder',
            context: { application_id: dec.application_id, user_id: dec.user_id },
          });

          await db.prepare(
            `INSERT INTO metadata (id, key, value) VALUES (?, ?, ?) ON CONFLICT(id, key) DO UPDATE SET value=excluded.value`
          ).bind(dec.user_id, reminderKey, now.toISOString()).run().catch(() => {});

          report.offerExpiry.remindersSent++;
        }
      }
    }
  } catch (err: unknown) {
    report.offerExpiry.error = err instanceof Error ? err.message : String(err);
  }

  // 3. Provisioning Retry Sweep
  try {
    await dispatchPendingJobs(env);
    report.provisioningRetries.run = true;
  } catch (err: unknown) {
    report.provisioningRetries = {
      run: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 4. Nightly Reconciliation Job
  try {
    let discrepancies = 0;

    // Check for students with missing person or UID records
    const unprovisionedStudents = await db.prepare(
      `SELECT s.user_id, u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN persons p ON p.id = u.person_id
       WHERE (s.uid IS NULL OR s.uid = '' OR p.uid IS NULL) AND s.status = 'Active'`
    ).all<{ user_id: string; email: string }>();

    const missingUids = unprovisionedStudents?.results || [];
    if (missingUids.length > 0) {
      discrepancies += missingUids.length;
      for (const st of missingUids) {
        await db.prepare(
          `INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details, ip_address, created_at)
           VALUES (?, 'system_reconciliation', 'RECONCILIATION_WARNING', 'student', ?, ?, '127.0.0.1', datetime('now'))`
        ).bind(
          crypto.randomUUID(),
          st.user_id,
          JSON.stringify({ issue: 'Active student missing UID or person link', email: st.email })
        ).run().catch(() => {});
      }
    }

    report.reconciliation = {
      run: true,
      discrepanciesFound: discrepancies,
    };
  } catch (err: unknown) {
    report.reconciliation = {
      run: false,
      discrepanciesFound: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return report;
}
