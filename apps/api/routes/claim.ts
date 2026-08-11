import { Env, ok, error, typedJson } from '../lib/types';
import { ExecutionContext } from '@cloudflare/workers-types';
import { hashPassword } from '@bmi/api-middleware';
import { validatePasswordStrength, isCommonPassword } from '../lib/jwt';
import { safeDispatchEmail, accountClaimedWelcomeEmail, isValidEmail } from '../lib/email';
import { createCoreDb, setRequestContext, isNeon } from '../lib/db';
import { dispatchPendingJobs } from '../lib/provisioning';
import { users } from '../schema/core';
import { eq, and, gt } from 'drizzle-orm';

interface ClaimBody {
  admissionCode?: string;
  password?: string;
}

export async function handleClaimAccount(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const body = await typedJson<ClaimBody>(req);
  const { admissionCode, password } = body;

  if (!admissionCode || !password) {
    return error('Admission code and password are required', 400);
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) return error(strength.errors[0]);
  if (isCommonPassword(password)) return error('This password is too common. Please choose a stronger password.');

  try {
    const db = createCoreDb(env);
    if (isNeon(db)) {
      await setRequestContext(db, 'anon');
    }

    const user = (await db.select({
      id: users.id,
      first_name: users.first_name,
      email: users.email,
    }).from(users).where(
      and(
        eq(users.admission_code, admissionCode),
        eq(users.account_claimed, 0),
        gt(users.admission_code_expires_at, new Date())
      )
    ).execute())[0];

    if (!user) {
      return error('Invalid or expired admission code, or account already claimed.', 400);
    }

    if (user.email && !isValidEmail(user.email)) {
      console.warn('[claim] Invalid email on file for user', user.id, ':', user.email);
    }

    const hashedPassword = await hashPassword(password, env.PASSWORD_PEPPER, env.PBKDF2_ITERATIONS);

    // ACID: run Drizzle update + application status log row consistently
    try {
      await db.transaction(async (tx) => {
        await tx.update(users)
          .set({
            password_hash: hashedPassword,
            account_claimed: 1,
            admission_code: null,
            admission_code_expires_at: null,
            updated_at: new Date(),
          })
          .where(eq(users.id, user.id));
      });

      if (env.PLATFORM_CONTEXT?.db) {
        const idb = env.PLATFORM_CONTEXT.db;
        await idb.transaction(async (tx) => {
          const appRow = await tx.prepare('SELECT id FROM applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
            .bind(user.id).first<{ id: string }>();
          if (appRow) {
            await tx.prepare(
              `INSERT INTO application_status_logs (id, application_id, changed_by, old_status, new_status, notes, changed_at)
               VALUES (?, ?, ?, NULL, 'account_claimed', 'Student account claimed and activated successfully.', datetime('now'))`
            ).bind(crypto.randomUUID(), appRow.id, user.id).run();
          }
        });
      }
    } catch (txErr) {
      console.error('[claim] DB transaction failed:', txErr);
      throw txErr;
    }

    const runPostClaimTasks = async () => {
      const tasks: Promise<unknown>[] = [];

      tasks.push(
        dispatchPendingJobs(env).catch(e => console.error('[provisioning] Post-claim dispatch failed:', e))
      );

      if (user.email && isValidEmail(user.email)) {
        tasks.push(
          safeDispatchEmail(env, ctx, {
            to: user.email,
            subject: 'Welcome to BMI University — Complete Your Onboarding',
            html: accountClaimedWelcomeEmail(user.first_name!),
            templateName: 'account_claimed_welcome',
            context: { action: 'account_claimed', user_id: user.id },
          })
        );
      }

      await Promise.allSettled(tasks);
    };

    if (ctx) {
      ctx.waitUntil(runPostClaimTasks());
    } else {
      await runPostClaimTasks();
    }

    return ok({ message: 'Account claimed successfully.' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to claim account';
    console.error(e);
    return error(msg, 500);
  }
}
