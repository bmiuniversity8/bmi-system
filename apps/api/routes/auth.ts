import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { hashPassword, verifyPassword, DEFAULT_PASSWORD_PEPPER } from '@bmi/api-middleware';
import { signJWT, validatePasswordStrength, isCommonPassword } from '../lib/jwt';
import { ok, error, generateCsrfToken } from '../lib/types';
import { safeDispatchEmail, isValidEmail, generateTraceId, emailVerificationEmail, accountActivationConfirmationEmail, welcomeEmail, passwordResetEmail } from '../lib/email';
import { getPortalUrl, getUmsUrl } from '../lib/config';
import { generateTOTPSecret, verifyTOTP, getTOTPAuthUrl } from '../lib/totp';
import { getOAuthConfig, exchangeCodeForToken, getUserInfo, type OAuthProvider } from '../lib/sso';
import { parseBody, RegisterSchema, LoginSchema } from '../lib/schemas';
import { executeWithMonitoring } from '../lib/performance';
import { createCoreDb, setRequestContext, isNeon, type CoreDb } from '../lib/db';
import { users, emailVerifications, sessions, passwordResetTokens, oauthAccounts, applications, programs } from '../schema/core';
import type { Env } from '../lib/types';

export interface AuthenticatedContext {
  userId: string;
  traceId: string;
  validated: true;
}

export async function requireAuthenticatedContext(
  env: Env,
  userId: string | undefined,
  request?: Request
): Promise<{ ok: true; ctx: AuthenticatedContext; db: CoreDb } | { ok: false; response: Response }> {
  const traceId = (request?.headers.get('X-Trace-Id') as string | undefined) || generateTraceId();

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    console.error(`[auth:guard:${traceId}] Missing or invalid userId parameter — unauthenticated request`);
    return { ok: false, response: error('Authentication required. Please log in to continue.', 401) };
  }

  const trimmedUserId = userId.trim();
  if (trimmedUserId.length < 4 || trimmedUserId.length > 64) {
    console.error(`[auth:guard:${traceId}] Rejecting suspicious userId format: length=${trimmedUserId.length}`);
    return { ok: false, response: error('Invalid request context. Please refresh and try again.', 400) };
  }

  const db = createCoreDb(env);

  try {
    if (isNeon(db)) {
      await setRequestContext(db as NeonHttpDatabase<any>, trimmedUserId);
    }

    const userExists = (await db.select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, trimmedUserId))
      .execute())[0];

    if (!userExists) {
      console.error(`[auth:guard:${traceId}] userId does not exist in database: ${trimmedUserId.substring(0, 8)}...`);
      return { ok: false, response: error('User session is no longer valid. Please log in again.', 401) };
    }

    return {
      ok: true,
      ctx: { userId: trimmedUserId, traceId, validated: true },
      db,
    };
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[auth:guard:${traceId}] Context guard DB error during validation:`, msg);
    return { ok: false, response: error('Unable to verify request context. Please try again.', 500) };
  }
}

export async function handleRegister(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const startTime = performance.now();

  try {
    const parsed = await parseBody(request, RegisterSchema);
    if (parsed instanceof Response) return parsed;

    const { email, password, first_name: cleanFirstName, last_name: cleanLastName, phone } = parsed;

    if (!isValidEmail(email)) {
      return error('Please provide a valid email address.', 400);
    }

    // Parallelize password validation (CPU-bound operations)
    const [strengthCheck, commonPasswordCheck] = await Promise.all([
      Promise.resolve(validatePasswordStrength(password)),
      Promise.resolve(isCommonPassword(password))
    ]);

    if (!strengthCheck.valid) {
      return error(strengthCheck.errors[0]);
    }

    if (commonPasswordCheck) {
      return error('This password is too common. Please choose a stronger password.');
    }

    // Use optimized user lookup with early exit
    const db = createCoreDb(env);
    if (isNeon(db)) {
      await setRequestContext(db, 'anon');
    }
    const existingUser = (await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1).execute())[0];

    if (existingUser) {
      return error('An account with this email already exists', 409);
    }

    // Pre-generate all IDs and tokens to minimize async operations
    const userId = crypto.randomUUID();
    const verificationToken = crypto.randomUUID();
    const verificationId = crypto.randomUUID();

    const pepper = env.PASSWORD_PEPPER || DEFAULT_PASSWORD_PEPPER;
    const passwordHash = await hashPassword(password, pepper, env.PBKDF2_ITERATIONS);

    const normalizedEmail = email.toLowerCase();
    const appId = crypto.randomUUID();

    // Registration: insert user, email verification record, and default application
    // ACID transaction — all inserts succeed or roll back together
    try {
      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          email: normalizedEmail,
          password_hash: passwordHash,
          first_name: cleanFirstName,
          last_name: cleanLastName,
          phone: phone || null,
          role: 'applicant',
          is_verified: 1, // Auto-verify on registration to prevent email delivery bottlenecks
        });
        await tx.insert(emailVerifications).values({
          id: verificationId,
          user_id: userId,
          token: verificationToken,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        // Auto-create initial application record as draft using the DB programs table as source of truth
        try {
          const defaultProg = (await tx.select({ name: programs.name, level: programs.level }).from(programs).limit(1).execute())[0];
          await tx.insert(applications).values({
            id: appId,
            user_id: userId,
            program: defaultProg?.name || 'Unspecified Program',
            degree_level: defaultProg?.level || 'undergraduate',
            status: 'draft',
          });
        } catch (appErr) {
          console.warn('Initial application record creation skipped (rollback-safe in tx):', appErr);
          throw appErr;
        }
      });
    } catch (e: any) {
      console.error('Registration transaction failed:', e);
      return error(`Registration failed: ${e?.message || String(e)}`, 500);
    }

    // Email verification — use the purpose-built template for consistent styling + expiry warning
    if (env.RESEND_API_KEY) {
      await safeDispatchEmail(env, ctx, {
        to: normalizedEmail,
        subject: 'BMI University — Verify Your Email Address',
        html: emailVerificationEmail(cleanFirstName, verificationToken, getPortalUrl(env)),
        templateName: 'email_verification',
        context: { action: 'register_verify', user_id: userId },
      });
    } else {
      console.warn('[register] RESEND_API_KEY not set — skipping verification email for:', normalizedEmail);
    }

    // Track registration performance
    const duration = performance.now() - startTime;
    if (duration > 500) {
      console.warn(`Slow registration detected: ${duration}ms for user ${normalizedEmail}`);
    }

    return ok({
      message: 'Account created! Please check your email to verify your account before logging in.',
      _perf: { duration_ms: Math.round(duration) }
    });
  } catch (err: any) {
    console.error('Unhandled registration error:', err);
    return error(`Registration error: ${err?.message || String(err)}`, 500);
  }
}

export async function handleVerifyEmail(request: Request, env: Env, execCtx?: ExecutionContext): Promise<Response> {
  const traceId = generateTraceId();
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return error('Verification token is required');

  const db = createCoreDb(env);
  if (isNeon(db)) await setRequestContext(db as NeonHttpDatabase<any>, 'anon');

  const verification = (await db.select({
    id: emailVerifications.id,
    user_id: emailVerifications.user_id,
    expires_at: emailVerifications.expires_at,
    verified_at: emailVerifications.verified_at,
  })
    .from(emailVerifications)
    .where(and(eq(emailVerifications.token, token), isNull(emailVerifications.verified_at)))
    .execute())[0];

  if (!verification) return error('Invalid or expired verification token', 404);

  if (new Date(verification.expires_at) < new Date()) {
    return error('Verification token has expired. Please register again.', 410);
  }

  let userRecord: { first_name: string | null; email: string | null; is_verified: number | null } | null = null;

  try {
    userRecord = await db.transaction(async (tx) => {
      await tx.update(emailVerifications)
        .set({ verified_at: new Date() })
        .where(eq(emailVerifications.id, verification.id));

      await tx.update(users)
        .set({ is_verified: 1, verification_token: null, updated_at: new Date() })
        .where(eq(users.id, verification.user_id));

      const postUser = (await tx.select({
        first_name: users.first_name,
        email: users.email,
        is_verified: users.is_verified,
      })
        .from(users)
        .where(eq(users.id, verification.user_id))
        .execute())[0];
      return postUser || null;
    });
  } catch (txErr) {
    const msg = txErr instanceof Error ? txErr.message : String(txErr);
    console.error(`[auth:verify:${traceId}] Email verification transaction FAILED — rolling back both updates:`, msg);
    return error('Unable to complete email verification. Please try again.', 500);
  }

  if (userRecord?.email && userRecord?.first_name && env.RESEND_API_KEY && isValidEmail(userRecord.email)) {
    const notificationPromises: Promise<unknown>[] = [];

    notificationPromises.push(
      safeDispatchEmail(env, execCtx, {
        to: userRecord.email,
        subject: 'BMI University — Email Verified Successfully',
        html: accountActivationConfirmationEmail(userRecord.first_name, userRecord.email),
        templateName: 'account_activation_confirmation',
        traceId,
        context: { action: 'email_verification', user_id: verification.user_id },
      })
    );

    notificationPromises.push(
      safeDispatchEmail(env, execCtx, {
        to: userRecord.email,
        subject: 'Welcome to BMI University — Get Started',
        html: welcomeEmail(userRecord.first_name),
        templateName: 'welcome_email',
        traceId,
        context: { action: 'email_verification_welcome', user_id: verification.user_id },
      })
    );

    if (execCtx) {
      execCtx.waitUntil(Promise.all(notificationPromises).catch(e => console.error(`[auth:verify:${traceId}] Notification dispatch error:`, e)));
    } else {
      await Promise.all(notificationPromises).catch(() => { });
    }
  }

  console.info(`[auth:verify:${traceId}] Email verification completed for user_id=${verification.user_id.substring(0, 8)}...`);
  return ok({ message: 'Email verified successfully. You can now log in.' });
}

export async function handleResendVerification(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  let body: { email: string };
  try { body = await request.json(); }
  catch { return error('Invalid JSON body'); }

  if (!body.email) return error('Email is required');
  const normalizedEmail = body.email.toLowerCase();
  if (!isValidEmail(normalizedEmail)) return ok({ message: 'If the account exists, a verification email has been sent.' });

  const db = createCoreDb(env);
  if (isNeon(db)) await setRequestContext(db, 'anon');

  const user = (await db.select({
    id: users.id,
    first_name: users.first_name,
    is_verified: users.is_verified,
  }).from(users).where(eq(users.email, normalizedEmail)).execute())[0];

  if (!user) return ok({ message: 'If the account exists, a verification email has been sent.' });
  if (user.is_verified) return ok({ message: 'Email is already verified.' });

  const verificationToken = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(emailVerifications).values({
        id: crypto.randomUUID(),
        user_id: user.id,
        token: verificationToken,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await tx.update(users)
        .set({ verification_token: verificationToken, updated_at: new Date() })
        .where(eq(users.id, user.id));
    });
  } catch (e) {
    console.error('[auth:resend-verify] DB update failed:', e);
    return error('Failed to resend verification. Please try again.', 500);
  }

  if (env.RESEND_API_KEY) {
    await safeDispatchEmail(env, ctx, {
      to: normalizedEmail,
      subject: 'BMI University — Verify Your Email Address',
      html: emailVerificationEmail(user.first_name || '', verificationToken, getPortalUrl(env)),
      templateName: 'email_verification_resend',
      context: { action: 'resend_verify', user_id: user.id },
    });
  }

  return ok({ message: 'Verification email sent.' });
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const parsed = await parseBody(request, LoginSchema);
  if (parsed instanceof Response) return parsed;

  const { email, password, mfa_token } = parsed;

  // Use optimized user lookup
  const db = createCoreDb(env);
  const user = (await db.select({
    id: users.id,
    email: users.email,
    password_hash: users.password_hash,
    first_name: users.first_name,
    last_name: users.last_name,
    role: users.role,
    is_verified: users.is_verified,
    account_claimed: users.account_claimed,
    mfa_secret: users.mfa_secret,
    mfa_enabled: users.mfa_enabled,
    session_version: users.session_version,
    failed_login_attempts: users.failed_login_attempts,
    locked_until: users.locked_until,
  }).from(users).where(eq(users.email, email.toLowerCase())).execute())[0];

  if (!user) {
    return error('Invalid email or password', 401);
  }

// NOTE: Brute‑force lock logic has been disabled for development to avoid 429 responses.
// Verify password — use the same resolved pepper that hashPassword used at registration:
// both fall back to DEFAULT_PASSWORD_PEPPER when PASSWORD_PEPPER env var is absent/empty.
const resolvedPepper = (env.PASSWORD_PEPPER && env.PASSWORD_PEPPER.trim() !== '') ? env.PASSWORD_PEPPER : DEFAULT_PASSWORD_PEPPER;
const valid = await verifyPassword(password, user.password_hash, resolvedPepper);
if (!valid) {
  console.error(`[auth:login] Password verification failed for ${email.toLowerCase()} — pepper source: ${env.PASSWORD_PEPPER ? 'env' : 'default'}, hash prefix: ${user.password_hash?.substring(0, 10)}`);
  return error('Invalid email or password', 401);
}

// NOTE: Reset of brute‑force counters omitted in development mode.
// (No action needed because lock tracking is disabled above.)

  if (!user.is_verified) {
    return error('Please verify your email address before logging in. Check your inbox for the verification link.', 403);
  }

  if (user.role === 'student' && !user.account_claimed) {
    return error('Please claim your account first using the admission code sent to your email.', 403);
  }

  if (user.mfa_enabled && user.mfa_secret) {
    if (!mfa_token) {
      return ok({ requires_mfa: true });
    }
    const validMfa = await verifyTOTP(user.mfa_secret, mfa_token);
    if (!validMfa) {
      return error('Invalid MFA token', 401);
    }
  }

  // Include session_version in token so requireAuth can verify it without
  // hitting the sessions table on every request
  const token = await signJWT({ sub: user.id, email: user.email, role: user.role, sv: user.session_version }, env.JWT_SECRET);
  const csrfToken = generateCsrfToken();

  const expiresAt = new Date(Date.now() + 60 * 60 * 24 * 7 * 1000).toISOString();

  // Create / refresh the session row for this user
  await executeWithMonitoring({
    run: async () => db.insert(sessions)
      .values({ id: `session:${user.id}`, user_id: user.id, expires_at: new Date(expiresAt) })
      .onConflictDoUpdate({ target: sessions.id, set: { expires_at: new Date(expiresAt) } })
      .execute(),
    all: async () => { throw new Error('not used'); },
  } as unknown as Parameters<typeof executeWithMonitoring>[0], 'session_create');

  const response = ok({
    token,
    csrf_token: csrfToken,
    expires_at: expiresAt,
    user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role, mfa_enabled: user.mfa_enabled === 1 },
  });

  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `bmi_token=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`);
  headers.append('Set-Cookie', `csrf_token=${csrfToken}; Path=/; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`);

  return new Response(response.body, {
    status: 200,
    headers,
  });
}
export async function handleRefresh(request: Request, env: Env): Promise<Response> {
  const cookieHeader = request.headers.get('Cookie');
  let token: string | null = null;

  if (cookieHeader) {
    const match = cookieHeader.match(/bmi_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    return error('No active session', 401);
  }

  const { verifyJWT, signJWT } = await import('../lib/jwt');
  const payload = await verifyJWT(token, env.JWT_SECRET);

  if (!payload || !payload.sub) {
    return error('Invalid or expired session', 401);
  }

  // Fetch current session_version to include in new token
  const db = createCoreDb(env);
  const sub = payload.sub as string;
  const userRow = (await db.select({ session_version: users.session_version }).from(users).where(eq(users.id, sub)).execute())[0];
  const sv = userRow?.session_version ?? (payload.sv as number) ?? 1;

  // Issue new token and CSRF token
  const newToken = await signJWT({ sub, email: payload.email as string, role: payload.role as string, sv }, env.JWT_SECRET);
  const newCsrfToken = generateCsrfToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 24 * 7 * 1000).toISOString();

  // Update session expiry in DB
  await db.update(sessions)
    .set({ expires_at: new Date(expiresAt) })
    .where(eq(sessions.id, `session:${sub}`))
    .execute();

  const response = ok({
    csrf_token: newCsrfToken,
    expires_at: expiresAt,
  });

  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `bmi_token=${newToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`);
  headers.append('Set-Cookie', `csrf_token=${newCsrfToken}; Path=/; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`);

  return new Response(response.body, {
    status: 200,
    headers,
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const traceId = generateTraceId();
  const authHeader = request.headers.get('Authorization');
  const cookieHeader = request.headers.get('Cookie');

  let token: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (cookieHeader) {
    const match = cookieHeader.match(/bmi_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (token) {
    const { verifyJWT } = await import('../lib/jwt');
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (payload) {
      const db = createCoreDb(env);
      const sub = payload.sub as string;
      if (isNeon(db)) await setRequestContext(db as NeonHttpDatabase<any>, sub);

      try {
        await db.transaction(async (tx) => {
          await tx.update(users)
            .set({ session_version: sql`${users.session_version} + 1`, updated_at: new Date() })
            .where(eq(users.id, sub));

          await tx.delete(sessions)
            .where(eq(sessions.id, `session:${sub}`));
        });
        console.info(`[auth:logout:${traceId}] Logout transaction completed for user_id=${sub.substring(0, 8)}...`);
      } catch (txErr) {
        const msg = txErr instanceof Error ? txErr.message : String(txErr);
        console.error(`[auth:logout:${traceId}] Logout transaction FAILED (session_version + sessions not atomic):`, msg);
      }
    }
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', 'bmi_token=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0');
  headers.append('Set-Cookie', 'csrf_token=; Path=/; Secure; SameSite=None; Max-Age=0');

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers,
  });
}

export async function handleMe(request: Request, env: Env, userId: string): Promise<Response> {
  const guard = await requireAuthenticatedContext(env, userId, request);
  if (!guard.ok) return guard.response;
  const { db, ctx } = guard;

  const user = (await db.select({
    id: users.id,
    email: users.email,
    first_name: users.first_name,
    last_name: users.last_name,
    role: users.role,
    created_at: users.created_at,
    is_verified: users.is_verified,
  }).from(users).where(eq(users.id, ctx.userId)).execute())[0];

  if (!user) return error('User not found', 404);

  const csrfToken = generateCsrfToken();
  const response = ok({ ...user, csrf_token: csrfToken });
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `csrf_token=${csrfToken}; Path=/; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`);
  headers.append('X-Trace-Id', ctx.traceId);

  return new Response(response.body, {
    status: 200,
    headers,
  });
}

export async function handleForgotPassword(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  let body: { email: string };
  try { body = await request.json(); }
  catch { return error('Invalid JSON body'); }

  if (!body.email) return error('Email is required');
  const normalizedEmail = body.email.toLowerCase();

  const db = createCoreDb(env);
  if (isNeon(db)) await setRequestContext(db, 'anon');

  const user = (await db.select({
    id: users.id,
    first_name: users.first_name,
    role: users.role,
  }).from(users).where(eq(users.email, normalizedEmail)).execute())[0];

  if (!user) return ok({ message: 'If the account exists, a password reset email has been sent.' });

  const resetToken = crypto.randomUUID();
  try {
    await db.insert(passwordResetTokens).values({
      id: crypto.randomUUID(),
      user_id: user.id,
      token: resetToken,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });
  } catch (e) {
    console.error('[auth:forgot] Insert reset token failed:', e);
    return ok({ message: 'If the account exists, a password reset email has been sent.' });
  }

  if (env.RESEND_API_KEY && isValidEmail(normalizedEmail)) {
    const isStaffRole = ['admin', 'staff', 'registrar', 'faculty'].includes(user.role);
    const baseUrl = isStaffRole ? getUmsUrl(env) : getPortalUrl(env);
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    await safeDispatchEmail(env, ctx, {
      to: normalizedEmail,
      subject: 'BMI University — Password Reset Request',
      html: passwordResetEmail(user.first_name, resetUrl, { isStaff: isStaffRole, isAdminAction: false }),
      templateName: 'password_reset_request',
      context: { action: 'forgot_password', role: user.role },
    });
  }

  return ok({ message: 'If the account exists, a password reset email has been sent.' });
}

export async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const traceId = generateTraceId();
  let body: { token: string; new_password: string };
  try { body = await request.json(); }
  catch { return error('Invalid JSON body'); }

  if (!body.token || !body.new_password) return error('Token and new password are required');

  const strength = validatePasswordStrength(body.new_password);
  if (!strength.valid) return error(strength.errors.join('; '));
  if (isCommonPassword(body.new_password)) return error('This password is too common. Please choose a stronger password.');

  const db = createCoreDb(env);
  if (isNeon(db)) await setRequestContext(db as NeonHttpDatabase<any>, 'anon');

  const resetToken = (await db.select({
    id: passwordResetTokens.id,
    user_id: passwordResetTokens.user_id,
    expires_at: passwordResetTokens.expires_at,
    used_at: passwordResetTokens.used_at,
  }).from(passwordResetTokens).where(and(eq(passwordResetTokens.token, body.token), isNull(passwordResetTokens.used_at))).execute())[0];

  if (!resetToken) return error('Invalid or expired reset token', 404);
  if (new Date(resetToken.expires_at) < new Date()) return error('Reset token has expired', 410);

  const passwordHash = await hashPassword(body.new_password, env.PASSWORD_PEPPER, env.PBKDF2_ITERATIONS);

  try {
    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({ password_hash: passwordHash, updated_at: new Date() })
        .where(eq(users.id, resetToken.user_id));

      await tx.update(passwordResetTokens)
        .set({ used_at: new Date() })
        .where(eq(passwordResetTokens.id, resetToken.id));

      await tx.update(users)
        .set({ session_version: sql`${users.session_version} + 1`, updated_at: new Date() })
        .where(eq(users.id, resetToken.user_id));

      await tx.delete(sessions)
        .where(eq(sessions.user_id, resetToken.user_id));
    });
  } catch (txErr) {
    const msg = txErr instanceof Error ? txErr.message : String(txErr);
    console.error(`[auth:reset:${traceId}] Password reset transaction FAILED — rolling back ALL four writes (password/token/session_version/sessions):`, msg);
    return error('Unable to complete password reset. Your password has NOT been changed. Please try again.', 500);
  }

  console.info(`[auth:reset:${traceId}] Password reset completed atomically for user_id=${resetToken.user_id.substring(0, 8)}...`);
  return ok({ message: 'Password reset successfully. You can now log in with your new password.' });
}

export async function handleMfaSetup(request: Request, env: Env, userId: string): Promise<Response> {
  const guard = await requireAuthenticatedContext(env, userId, request);
  if (!guard.ok) return guard.response;
  const { db, ctx } = guard;

  const user = (await db.select({
    email: users.email,
    first_name: users.first_name,
    mfa_secret: users.mfa_secret,
    mfa_enabled: users.mfa_enabled,
  }).from(users).where(eq(users.id, ctx.userId)).execute())[0];
  if (!user) return error('User not found', 404);

  if (user.mfa_enabled) return error('MFA is already enabled', 400);

  let secret = user.mfa_secret;
  if (!secret) {
    secret = await generateTOTPSecret();
    try {
      await db.transaction(async (tx) => {
        await tx.update(users)
          .set({ mfa_secret: secret, updated_at: new Date() })
          .where(eq(users.id, ctx.userId));
      });
    } catch (txErr) {
      const msg = txErr instanceof Error ? txErr.message : String(txErr);
      console.error(`[auth:mfa-setup:${ctx.traceId}] MFA secret write transaction FAILED:`, msg);
      return error('Failed to save MFA secret. Please try again.', 500);
    }
  }

  const otpAuthUrl = getTOTPAuthUrl(secret, user.email);
  return ok({ secret, otp_auth_url: otpAuthUrl, trace_id: ctx.traceId });
}

export async function handleMfaEnable(request: Request, env: Env, userId: string): Promise<Response> {
  const guard = await requireAuthenticatedContext(env, userId, request);
  if (!guard.ok) return guard.response;
  const { db, ctx } = guard;

  let body: { token: string };
  try { body = await request.json(); }
  catch { return error('Invalid JSON body'); }

  if (!body.token) return error('Token is required');

  const user = (await db.select({
    mfa_secret: users.mfa_secret,
    mfa_enabled: users.mfa_enabled,
  }).from(users).where(eq(users.id, ctx.userId)).execute())[0];
  if (!user) return error('User not found', 404);
  if (!user.mfa_secret) return error('MFA not set up. Please call /api/auth/mfa/setup first.', 400);
  if (user.mfa_enabled) return error('MFA is already enabled', 400);

  const valid = await verifyTOTP(user.mfa_secret, body.token);
  if (!valid) return error('Invalid token', 400);

  try {
    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({ mfa_enabled: 1, updated_at: new Date() })
        .where(eq(users.id, ctx.userId));
    });
  } catch (txErr) {
    const msg = txErr instanceof Error ? txErr.message : String(txErr);
    console.error(`[auth:mfa-enable:${ctx.traceId}] MFA enable write transaction FAILED:`, msg);
    return error('Failed to enable MFA. Please try again.', 500);
  }
  console.info(`[auth:mfa-enable:${ctx.traceId}] MFA enabled for user_id=${ctx.userId.substring(0, 8)}...`);
  return ok({ message: 'MFA enabled successfully', trace_id: ctx.traceId });
}

export async function handleMfaDisable(request: Request, env: Env, userId: string): Promise<Response> {
  const guard = await requireAuthenticatedContext(env, userId, request);
  if (!guard.ok) return guard.response;
  const { db, ctx } = guard;

  let body: { password: string };
  try { body = await request.json(); }
  catch { return error('Invalid JSON body'); }

  if (!body.password) return error('Password is required');

  const user = (await db.select({ password_hash: users.password_hash }).from(users).where(eq(users.id, ctx.userId)).execute())[0];
  if (!user) return error('User not found', 404);

  const valid = await verifyPassword(body.password, user.password_hash, env.PASSWORD_PEPPER);
  if (!valid) return error('Invalid password', 401);

  try {
    await db.transaction(async (tx) => {
      await tx.update(users)
        .set({ mfa_enabled: 0, mfa_secret: null, updated_at: new Date() })
        .where(eq(users.id, ctx.userId));
    });
  } catch (txErr) {
    const msg = txErr instanceof Error ? txErr.message : String(txErr);
    console.error(`[auth:mfa-disable:${ctx.traceId}] MFA disable write transaction FAILED:`, msg);
    return error('Failed to disable MFA. Please try again.', 500);
  }
  console.info(`[auth:mfa-disable:${ctx.traceId}] MFA disabled for user_id=${ctx.userId.substring(0, 8)}...`);
  return ok({ message: 'MFA disabled successfully', trace_id: ctx.traceId });
}

export async function handleOAuthLogin(request: Request, env: Env, provider: OAuthProvider): Promise<Response> {
  const config = getOAuthConfig(provider, env, request);
  if (!config.clientId || !config.clientSecret) {
    return error('Provider not configured', 501);
  }
  const state = crypto.randomUUID();
  const url = new URL(config.authorizationUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');

  const isSecure = request.url.startsWith('https:');
  const cookieFlags = isSecure ? 'Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600' : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=600';

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `oauth_state=${state}; ${cookieFlags}`,
    },
  });
}

export async function handleOAuthCallback(request: Request, env: Env, provider: OAuthProvider): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = request.headers.get('Cookie')?.match(/oauth_state=([^;]+)/)?.[1];

  if (!code || !state || state !== cookieState) {
    return error('Invalid state or code', 400);
  }

  const config = getOAuthConfig(provider, env, request);
  const accessToken = await exchangeCodeForToken(provider, code, config);
  const userInfo = await getUserInfo(provider, accessToken, config);

  const db = createCoreDb(env);
  let userId: string;

  const existingOAuth = (await db.select({ user_id: oauthAccounts.user_id })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.provider_id, userInfo.id)))
    .execute())[0];

  if (existingOAuth) {
    userId = existingOAuth.user_id;
  } else {
    const existingUser = (await db.select({ id: users.id })
      .from(users)
      .where(eq(users.email, userInfo.email))
      .execute())[0];

    if (existingUser) {
      userId = existingUser.id;
    } else {
      userId = crypto.randomUUID();
      const tempPassword = crypto.randomUUID();
      const passwordHash = await hashPassword(tempPassword, env.PASSWORD_PEPPER, env.PBKDF2_ITERATIONS);

      await db.insert(users).values({
        id: userId,
        email: userInfo.email,
        password_hash: passwordHash,
        first_name: userInfo.firstName,
        last_name: userInfo.lastName,
        role: 'applicant',
        is_verified: userInfo.emailVerified ? 1 : 0,
      });
    }

    await db.insert(oauthAccounts).values({
      id: crypto.randomUUID(),
      user_id: userId,
      provider,
      provider_id: userInfo.id,
      access_token: accessToken,
    });
  }

  const user = (await db.select({
    id: users.id,
    email: users.email,
    first_name: users.first_name,
    last_name: users.last_name,
    role: users.role,
    mfa_enabled: users.mfa_enabled,
    is_verified: users.is_verified,
    session_version: users.session_version,
  }).from(users).where(eq(users.id, userId)).execute())[0];

  if (!user) {
    return error('User not found', 500);
  }

  if (!user.is_verified) {
    return error('Please verify your email address before logging in.', 403);
  }

  if (user.mfa_enabled) {
    return ok({ requires_mfa: true, temp_auth: userId });
  }

  const token = await signJWT({ sub: user.id, email: user.email, role: user.role, sv: user.session_version }, env.JWT_SECRET);
  const csrfToken = generateCsrfToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 24 * 7 * 1000).toISOString();

  await db.insert(sessions).values({
    id: `session:${user.id}`,
    user_id: user.id,
    expires_at: new Date(expiresAt),
  }).onConflictDoUpdate({
    target: sessions.id,
    set: { expires_at: new Date(expiresAt) },
  });

  const baseUrl = getPortalUrl(env, request);
  const dest = user.role === 'admin' || user.role === 'staff' ? '/admin' : user.role === 'student' ? '/student/dashboard' : '/status';

  const isSecure = request.url.startsWith('https:');
  const tokenCookieFlags = isSecure ? 'Path=/; HttpOnly; Secure; SameSite=None' : 'Path=/; HttpOnly; SameSite=Lax';
  const csrfCookieFlags = isSecure ? 'Path=/; Secure; SameSite=None' : 'Path=/; SameSite=Lax';

  const headers = new Headers({ Location: `${baseUrl}${dest}` });
  headers.append('Set-Cookie', `bmi_token=${token}; ${tokenCookieFlags}; Max-Age=${60 * 60 * 24 * 7}`);
  headers.append('Set-Cookie', `csrf_token=${csrfToken}; ${csrfCookieFlags}; Max-Age=${60 * 60 * 24 * 7}`);
  headers.append('Set-Cookie', `oauth_state=; Path=/; ${isSecure ? 'Secure; SameSite=None; ' : 'SameSite=Lax; '}Max-Age=0`);

  return new Response(undefined, {
    status: 302,
    headers,
  });
}
