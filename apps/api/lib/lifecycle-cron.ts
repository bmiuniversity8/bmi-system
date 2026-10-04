import type { Env } from './types';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { runTermCensusJob } from './census-job';
import { dispatchPendingJobs } from './provisioning';
import {
  getEnrollmentStatus,
  ENROLLMENT_STATUS,
  ALLOWED_TRANSITIONS,
} from './state-machine';
import { safeDispatchEmail, isValidEmail, buildEmailLayout } from './email';
import { getPortalUrl } from './config';

export interface LifecycleCronReport {
  census: { run: boolean; enrolledCount?: number; error?: string };
  offerExpiry: {
    checked: number;
    expired: number;
    failed: number;
    remindersSent: number;
    error?: string;
  };
  provisioningRetries: { run: boolean; error?: string };
  reconciliation: {
    run: boolean;
    discrepanciesFound: number;
    details?: Record<string, number>;
    error?: string;
  };
}

/** Enrollment states at or beyond offer acceptance — never lapse these. */
const ACCEPTED_OR_LATER = new Set<string>([
  ENROLLMENT_STATUS.OFFER_ACCEPTED,
  ENROLLMENT_STATUS.PROVISIONING_IN_PROGRESS,
  ENROLLMENT_STATUS.PROVISIONED,
  ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE,
  ENROLLMENT_STATUS.REGISTRATION_IN_PROGRESS,
  ENROLLMENT_STATUS.REGISTERED,
  ENROLLMENT_STATUS.OFFICIALLY_ENROLLED,
]);

/** Only these states may be lapsed by the offer-expiry sweep. */
const LAPSABLE_STATES = new Set<string>([
  ENROLLMENT_STATUS.OFFER_EXTENDED,
  ENROLLMENT_STATUS.ADMITTED,
  ENROLLMENT_STATUS.CONDITIONAL,
]);

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function writeReconciliationAudit(
  db: any,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO admin_audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        'system_reconciliation',
        'RECONCILIATION_WARNING',
        targetType,
        targetId,
        JSON.stringify(details),
        '127.0.0.1',
        'lifecycle-cron',
        now,
      )
      .run();
  } catch (err: unknown) {
    // Surface audit-write failures — never swallow silently.
    console.error('[lifecycle-cron][reconciliation] failed to record audit entry', {
      targetType,
      targetId,
      details,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
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
    offerExpiry: { checked: 0, expired: 0, failed: 0, remindersSent: 0 },
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
      try {
        // Skip anyone who already accepted (or progressed beyond) or is provisioned.
        const studentRow = await db
          .prepare(`SELECT user_id FROM students WHERE user_id = ? LIMIT 1`)
          .bind(dec.user_id)
          .first<{ user_id: string }>()
          .catch(() => null);
        if (studentRow) {
          continue;
        }

        let currentStatus: string;
        try {
          const s = await getEnrollmentStatus(db as any, dec.user_id);
          currentStatus = s.status;
        } catch (e: unknown) {
          console.error('[lifecycle-cron][offer-expiry] status lookup failed', {
            user_id: dec.user_id,
            application_id: dec.application_id,
            error: e instanceof Error ? e.message : String(e),
          });
          report.offerExpiry.failed++;
          continue;
        }

        if (ACCEPTED_OR_LATER.has(currentStatus)) {
          continue;
        }

        const expiryDate = new Date(dec.offer_expires_at);

        if (now > expiryDate) {
          // Only lapse offers still in an offer-pending state.
          if (!LAPSABLE_STATES.has(currentStatus)) {
            continue;
          }
          // Validate the transition BEFORE mutating application rows so an
          // invalid move never leaves the application changed without the
          // enrollment status.
          const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
          if (!allowed.includes(ENROLLMENT_STATUS.DENIED)) {
            console.error('[lifecycle-cron][offer-expiry] invalid transition blocked', {
              user_id: dec.user_id,
              application_id: dec.application_id,
              current: currentStatus,
            });
            report.offerExpiry.failed++;
            continue;
          }

          const nowIso = now.toISOString();
          // Atomic: application + app log + enrollment status in one batch.
          // db.batch is atomic on D1 and on Neon (non-interactive txn),
          // unlike db.transaction which is sequential-only on both drivers.
          // Transition was validated above, so the direct enrollment insert
          // cannot split-brain the application row.
          const enrollmentId = crypto.randomUUID();
          const appUpdate = db
            .prepare(
              `UPDATE applications SET status = 'rejected', updated_at = ? WHERE id = ?`
            )
            .bind(nowIso, dec.application_id);
          const appLog = db
            .prepare(
              `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
               VALUES (?, ?, 'system_offer_expiry', 'accepted', 'rejected', 'Admission offer expired past deadline', ?)`
            )
            .bind(crypto.randomUUID(), dec.application_id, nowIso);
          const enrollmentLog = db
            .prepare(
              `INSERT INTO enrollment_status_logs
               (id, user_id, person_id, status, term_id, changed_by, reason, changed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              enrollmentId,
              dec.user_id,
              null,
              ENROLLMENT_STATUS.DENIED,
              null,
              'system_offer_expiry',
              'Admission offer expired past deadline without acceptance',
              nowIso,
            );
          if (typeof (db as any).batch === 'function') {
            await (db as any).batch([appUpdate, appLog, enrollmentLog]);
          } else {
            await db.transaction(async (tx: any) => {
              await tx
                .prepare(
                  `UPDATE applications SET status = 'rejected', updated_at = ? WHERE id = ?`
                )
                .bind(nowIso, dec.application_id)
                .run();

              await tx
                .prepare(
                  `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
                   VALUES (?, ?, 'system_offer_expiry', 'accepted', 'rejected', 'Admission offer expired past deadline', ?)`
                )
                .bind(crypto.randomUUID(), dec.application_id, nowIso)
                .run();

              await tx
                .prepare(
                  `INSERT INTO enrollment_status_logs
                   (id, user_id, person_id, status, term_id, changed_by, reason, changed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  enrollmentId,
                  dec.user_id,
                  null,
                  ENROLLMENT_STATUS.DENIED,
                  null,
                  'system_offer_expiry',
                  'Admission offer expired past deadline without acceptance',
                  nowIso,
                )
                .run();
            });
          }

          report.offerExpiry.expired++;
        } else if (expiryDate <= threeDaysFromNow) {
          // Send impending expiry reminder (once only).
          // Only remind pending offers — accepted/provisioned were skipped above.
          if (!LAPSABLE_STATES.has(currentStatus)) {
            continue;
          }
          const reminderKey = `offer_reminder_sent_${dec.application_id}`;
          const sentRow = await db
            .prepare(`SELECT value FROM metadata WHERE id = ? AND key = ?`)
            .bind(dec.user_id, reminderKey)
            .first<{ value: string }>()
            .catch(() => null);
          if (!sentRow && isValidEmail(dec.email)) {
            const daysLeft = Math.max(
              1,
              Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000)
            );
            const portalUrl = getPortalUrl(env);
            const safeName = escapeHtml(dec.first_name || 'Applicant');
            const safeProgram = escapeHtml(dec.program || 'your program');
            const reminderHtml = buildEmailLayout(
              'Admission Offer Expiring Soon',
              `
              <h2 style="color: #0f172a;">Reminder: Your Admission Offer Expires Soon</h2>
              <p>Dear ${safeName},</p>
              <p>This is a reminder that your admission offer for the <strong>${safeProgram}</strong> program will expire in <strong>${daysLeft} days</strong> on ${escapeHtml(expiryDate.toLocaleDateString())}.</p>
              <p>To secure your seat, please log in to your applicant portal and accept your offer before the deadline.</p>
              <p style="margin-top: 30px;"><a href="${escapeHtml(`${portalUrl}/status`)}" style="background: #1e3a8a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Accept Your Offer Now</a></p>
            `
            );

            await safeDispatchEmail(env, ctx, {
              to: dec.email,
              subject: `Action Required: Your BMI University Admission Offer Expires in ${daysLeft} Days`,
              html: reminderHtml,
              templateName: 'offer_expiry_reminder',
              context: { application_id: dec.application_id, user_id: dec.user_id },
            });

            try {
              await db
                .prepare(
                  `INSERT INTO metadata (id, key, value) VALUES (?, ?, ?) ON CONFLICT(id, key) DO UPDATE SET value=excluded.value`
                )
                .bind(dec.user_id, reminderKey, now.toISOString())
                .run();
            } catch (e: unknown) {
              console.error('[lifecycle-cron][offer-expiry] reminder marker write failed', {
                user_id: dec.user_id,
                application_id: dec.application_id,
                error: e instanceof Error ? e.message : String(e),
              });
            }

            report.offerExpiry.remindersSent++;
          }
        }
      } catch (err: unknown) {
        // One failing student must not stop the rest.
        console.error('[lifecycle-cron][offer-expiry] per-student failure', {
          application_id: dec.application_id,
          user_id: dec.user_id,
          error: err instanceof Error ? err.message : String(err),
        });
        report.offerExpiry.failed++;
        continue;
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
    const details: Record<string, number> = {
      missingUid: 0,
      provisioningStuck: 0,
      provisioningJobsFailed: 0,
      applicationMismatch: 0,
      seatsMismatch: 0,
      orphanDeposits: 0,
    };

    // (a) Active students missing UID or person link.
    try {
      const unprovisionedStudents = await db.prepare(
        `SELECT s.user_id, u.email
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN persons p ON p.id = u.person_id
         WHERE (s.uid IS NULL OR s.uid = '' OR p.uid IS NULL) AND s.status = 'Active'`
      ).all<{ user_id: string; email: string }>();

      const missingUids = unprovisionedStudents?.results || [];
      for (const st of missingUids) {
        try {
          await writeReconciliationAudit(db, 'student', st.user_id, {
            issue: 'Active student missing UID or person link',
            email: st.email,
          });
          discrepancies++;
          details.missingUid++;
        } catch {
          // Audit-write failure already logged inside helper; count it but
          // continue with the remaining students — one bad row must not stop
          // the check.
          discrepancies++;
          details.missingUid++;
          continue;
        }
      }
    } catch (err: unknown) {
      console.error('[lifecycle-cron][reconciliation] missingUid check failed:', err instanceof Error ? err.message : String(err));
    }

    // (b) Students stuck in PROVISIONING_IN_PROGRESS for over an hour.
    // Portable: no rowid, no bare GROUP BY (both fail on Postgres). Fetch
    // distinct candidates, then confirm each one's LATEST log is still stuck.
    try {
      const cutoff = new Date(Date.now() - 3600000).toISOString();
      const stuck = await db.prepare(
        `SELECT DISTINCT user_id FROM enrollment_status_logs
         WHERE status = 'PROVISIONING_IN_PROGRESS' AND changed_at < ?`
      ).bind(cutoff).all<{ user_id: string }>().catch(() => null);
      for (const row of stuck?.results || []) {
        // Confirm still current (latest log is still PROVISIONING_IN_PROGRESS).
        // Portable tiebreaker: changed_at + id (never rowid — SQLite-only).
        const latest = await db.prepare(
          `SELECT status, changed_at FROM enrollment_status_logs WHERE user_id = ? ORDER BY changed_at DESC, id DESC LIMIT 1`
        ).bind(row.user_id).first<{ status: string; changed_at: string }>().catch(() => null);
        // Tolerate mocks/rows without changed_at: the candidate was already
        // older than the cutoff, so a missing timestamp still counts as stuck.
        const since = (latest as any)?.changed_at ?? cutoff;
        if (latest?.status === 'PROVISIONING_IN_PROGRESS' && (!(latest as any)?.changed_at || (latest as any).changed_at < cutoff)) {
          discrepancies++;
          details.provisioningStuck++;
          try {
            await writeReconciliationAudit(db, 'student', row.user_id, {
              issue: 'Stuck in PROVISIONING_IN_PROGRESS for over an hour',
              since,
            });
          } catch { /* logged inside helper */ }
        }
      }
    } catch (err: unknown) {
      console.error('[lifecycle-cron][reconciliation] provisioningStuck check failed:', err instanceof Error ? err.message : String(err));
    }

    // (c) provisioning_jobs that failed or exceeded the attempts threshold.
    try {
      const failedJobs = await db.prepare(
        `SELECT id, status, attempts FROM provisioning_jobs WHERE status = 'failed' OR attempts >= 5`
      ).all<{ id: string; status: string; attempts: number }>().catch(() => null);
      for (const job of failedJobs?.results || []) {
        discrepancies++;
        details.provisioningJobsFailed++;
        try {
          await writeReconciliationAudit(db, 'provisioning_job', job.id, {
            issue: 'Provisioning job failed or exceeded attempts threshold',
            status: job.status,
            attempts: job.attempts,
          });
        } catch { /* logged inside helper */ }
      }
    } catch (err: unknown) {
      console.error('[lifecycle-cron][reconciliation] provisioningJobs check failed:', err instanceof Error ? err.message : String(err));
    }

    // (d) Applications with status accepted whose user has a student row but a
    //     mismatched (terminal/early) enrollment status.
    try {
      const acceptedApps = await db.prepare(
        `SELECT a.id, a.user_id FROM applications a
         JOIN students s ON s.user_id = a.user_id
         WHERE a.status = 'accepted'`
      ).all<{ id: string; user_id: string }>().catch(() => null);
      for (const app of acceptedApps?.results || []) {
        try {
          const s = await getEnrollmentStatus(db as any, app.user_id);
          const mismatched = [
            ENROLLMENT_STATUS.PROSPECT,
            ENROLLMENT_STATUS.APPLICANT_IN_PROGRESS,
            ENROLLMENT_STATUS.APPLICANT_SUBMITTED,
            ENROLLMENT_STATUS.UNDER_REVIEW,
            ENROLLMENT_STATUS.DENIED,
            ENROLLMENT_STATUS.APPLICANT_WITHDRAWN,
            ENROLLMENT_STATUS.WAITLISTED,
          ].includes(s.status as any);
          if (mismatched) {
            discrepancies++;
            details.applicationMismatch++;
            try {
              await writeReconciliationAudit(db, 'application', app.id, {
                issue: 'Accepted application with student row but mismatched enrollment status',
                user_id: app.user_id,
                enrollment_status: s.status,
              });
            } catch { /* logged inside helper */ }
          }
        } catch (e: unknown) {
          console.error('[lifecycle-cron][reconciliation] applicationMismatch lookup failed:', e instanceof Error ? e.message : String(e));
        }
      }
    } catch (err: unknown) {
      console.error('[lifecycle-cron][reconciliation] applicationMismatch check failed:', err instanceof Error ? err.message : String(err));
    }

    // (e) course_sections.seats_taken differing from the count of registered rows.
    // Single aggregated query (no N+1 per-section count).
    try {
      const mismatched = await db.prepare(
        `SELECT cs.id, cs.seats_taken, COUNT(scr.id) AS registered_count
         FROM course_sections cs
         LEFT JOIN student_course_registrations scr
           ON scr.section_id = cs.id AND scr.status = 'registered'
         GROUP BY cs.id, cs.seats_taken
         HAVING cs.seats_taken != COUNT(scr.id)`
      ).all<{ id: string; seats_taken: number; registered_count: number }>().catch(() => null);
      for (const sec of mismatched?.results || []) {
        discrepancies++;
        details.seatsMismatch++;
        try {
          await writeReconciliationAudit(db, 'course_section', sec.id, {
            issue: 'seats_taken differs from registered count',
            seats_taken: sec.seats_taken,
            registered_count: Number(sec.registered_count ?? 0),
          });
        } catch { /* logged inside helper */ }
      }
    } catch (err: unknown) {
      console.error('[lifecycle-cron][reconciliation] seatsMismatch check failed:', err instanceof Error ? err.message : String(err));
    }

    // (f) Deposits whose application has no accepted offer.
    try {
      const orphans = await db.prepare(
        `SELECT ed.id, ed.application_id FROM enrollment_deposits ed
         LEFT JOIN applications a ON a.id = ed.application_id
         WHERE a.id IS NULL OR a.status != 'accepted'`
      ).all<{ id: string; application_id: string }>().catch(() => null);
      for (const dep of orphans?.results || []) {
        discrepancies++;
        details.orphanDeposits++;
        try {
          await writeReconciliationAudit(db, 'enrollment_deposit', dep.id, {
            issue: 'Deposit has no accepted offer',
            application_id: dep.application_id,
          });
        } catch { /* logged inside helper */ }
      }
    } catch (err: unknown) {
      console.error('[lifecycle-cron][reconciliation] orphanDeposits check failed:', err instanceof Error ? err.message : String(err));
    }

    report.reconciliation = {
      run: true,
      discrepanciesFound: discrepancies,
      details,
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
