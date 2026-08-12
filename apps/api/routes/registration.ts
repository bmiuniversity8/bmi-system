import { Env, ok, error, typedJson } from '../lib/types';
import { ExecutionContext } from '@cloudflare/workers-types';
import {
  safeDispatchEmail,
  isValidEmail,
  documentReadyEmail,
  registrationCompleteEmail,
  courseEnrollmentConfirmationEmail,
  registrationProgressEmail,
} from '../lib/email';
import { runUnifiedProvisioning } from '../lib/unified-provisioner';
import { dispatchPendingJobs } from '../lib/provisioning';
import { getPortalUrl } from '../lib/config';

export type RegStep = 'personal_details' | 'address' | 'program' | 'modules' | 'fees' | 'confirm';

export interface RegistrationData {
  personal_details?: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender: string;
    nationality: string;
    phone: string;
  };
  address?: {
    current_address: string;
    city: string;
    state: string;
    country: string;
    emergency_contact_name: string;
    emergency_contact_phone: string;
  };
  program?: {
    program_id: string;
    program_name: string;
    level: string;
    study_mode: 'full_time' | 'part_time' | 'distance';
  };
  modules?: {
    selected_course_ids: string[];
    total_credits: number;
  };
  fees?: {
    accepted_fee_structure: boolean;
    payment_method: string;
    scholarship_claimed: boolean;
    scholarship_details?: string;
  };
  confirm?: {
    accepted_terms: boolean;
    data_accuracy_confirmed: boolean;
    signed_name: string;
    signed_date: string;
  };
}

const STEP_ORDER: RegStep[] = ['personal_details', 'address', 'program', 'modules', 'fees', 'confirm'];

function validateStep(step: RegStep, data: Record<string, unknown>): string | null {
  switch (step) {
    case 'personal_details':
      if (!data.first_name) return 'First name is required';
      if (!data.last_name) return 'Last name is required';
      if (!data.date_of_birth) return 'Date of birth is required';
      if (!data.gender) return 'Gender is required';
      if (!data.nationality) return 'Nationality is required';
      return null;
    case 'address':
      if (!data.current_address) return 'Current address is required';
      if (!data.emergency_contact_name) return 'Emergency contact name is required';
      if (!data.emergency_contact_phone) return 'Emergency contact phone is required';
      return null;
    case 'program':
      if (!data.program_id) return 'Programme selection is required';
      if (!data.study_mode) return 'Study mode is required';
      return null;
    case 'modules':
      if (!data.selected_course_ids || !Array.isArray(data.selected_course_ids) || data.selected_course_ids.length === 0) {
        return 'At least one module must be selected';
      }
      return null;
    case 'fees':
      if (!data.accepted_fee_structure) return 'You must accept the fee structure';
      if (!data.payment_method) return 'Payment method is required';
      return null;
    case 'confirm':
      if (!data.accepted_terms) return 'You must accept the terms and conditions';
      if (!data.data_accuracy_confirmed) return 'You must confirm data accuracy';
      if (!data.signed_name) return 'Digital signature is required';
      return null;
    default:
      return null;
  }
}

export async function handleSaveRegistrationStep(req: Request, env: Env, userId: string, step: string): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    if (!STEP_ORDER.includes(step as RegStep)) {
      return error(`Invalid registration step: ${step}`, 400);
    }

    const body = await typedJson<Record<string, unknown>>(req);
    const validationError = validateStep(step as RegStep, body);
    if (validationError) return error(validationError, 400);

    const existing = await env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT value FROM metadata WHERE id = ? AND key = 'registration_data'`
    ).bind(userId).first<{ value: string }>();

    const currentData: RegistrationData = existing ? JSON.parse(existing.value) : {};
    (currentData as Record<string, unknown>)[step] = body;

    await env.PLATFORM_CONTEXT!.db.prepare(
      `INSERT INTO metadata (id, key, value) VALUES (?, 'registration_data', ?) ON CONFLICT(id, key) DO UPDATE SET value=excluded.value`
    ).bind(userId, JSON.stringify(currentData)).run();

    const completedSteps = STEP_ORDER.filter(s => currentData[s] !== undefined);
    const completedCount = completedSteps.length;
    const totalSteps = STEP_ORDER.length;
    const nextStep = STEP_ORDER.find(s => currentData[s] === undefined);

    // Milestone progress emails: send only at halfway (3/6) and almost done (5/6)
    const STEP_LABELS: Record<string, string> = {
      personal_details: 'Personal Details',
      address: 'Address & Emergency Contact',
      program: 'Programme Selection',
      modules: 'Module Selection',
      fees: 'Fee Acceptance',
      confirm: 'Confirmation & Signature',
    };

    const isMilestone = completedCount === Math.ceil(totalSteps / 2) || completedCount === totalSteps - 1;
    if (isMilestone && nextStep && env.RESEND_API_KEY) {
      const userRow = await env.PLATFORM_CONTEXT!.db.prepare(
        'SELECT email, first_name FROM users WHERE id = ?'
      ).bind(userId).first<{ email: string; first_name: string }>();

      if (userRow?.email && isValidEmail(userRow.email)) {
        // Fire-and-forget: don't block the step save response
        safeDispatchEmail(env, undefined, {
          to: userRow.email,
          subject: completedCount === totalSteps - 1
            ? 'BMI University — Almost Done with Registration!'
            : 'BMI University — Registration Halfway There!',
          html: registrationProgressEmail(
            userRow.first_name,
            completedCount,
            totalSteps,
            STEP_LABELS[nextStep] || nextStep
          ),
          templateName: 'registration_progress',
          context: { action: 'registration_progress', user_id: userId, completed: completedCount, total: totalSteps },
        }).catch(e => console.error('[registration] Progress email failed:', e));
      }
    }

    return ok({
      message: `Step ${step} saved successfully`,
      completed_steps: completedSteps,
      all_completed: STEP_ORDER.every(s => currentData[s] !== undefined),
    });
  } catch {
    return error('Failed to save registration step', 500);
  }
}

export async function handleGetRegistrationStatus(_req: Request, env: Env, userId: string): Promise<Response> {
  try {
    const existing = await env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT value FROM metadata WHERE id = ? AND key = 'registration_data'`
    ).bind(userId).first<{ value: string }>();

    const currentData: RegistrationData = existing ? JSON.parse(existing.value) : {};
    const completedSteps = STEP_ORDER.filter(s => currentData[s] !== undefined);
    const nextStep = STEP_ORDER.find(s => currentData[s] === undefined) || null;

    return ok({
      completed_steps: completedSteps,
      next_step: nextStep,
      current_data: currentData,
      registration_complete: nextStep === null,
    });
  } catch {
    return error('Failed to get registration status', 500);
  }
}

export async function handleCompleteRegistration(_req: Request, env: Env, userId: string, ctx?: ExecutionContext): Promise<Response> {
  const db = env.PLATFORM_CONTEXT!.db;
  try {
    const existing = await db.prepare(
      `SELECT value FROM metadata WHERE id = ? AND key = 'registration_data'`
    ).bind(userId).first<{ value: string }>();

    if (!existing) return error('No registration data found', 400);

    const currentData: RegistrationData = JSON.parse(existing.value);
    const missingStep = STEP_ORDER.find(s => currentData[s] === undefined);
    if (missingStep) return error(`Step ${missingStep} is not yet completed`, 400);

    const userRow = await db.prepare(
      `SELECT u.email, u.first_name, u.last_name, s.reg_no, p.uid
       FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN persons p ON u.person_id = p.id
       WHERE u.id = ?`
    ).bind(userId).first<{ email: string; first_name: string; last_name: string; reg_no: string | null; uid: string | null }>();

    if (!userRow) return error('User not found', 404);

    if (userRow.email && !isValidEmail(userRow.email)) {
      console.warn('[registration] Invalid email on file for user', userId, ':', userRow.email);
    }

    const now = new Date().toISOString();
    const programId = currentData.program?.program_id;
    const programName = currentData.program?.program_name || '';

    const result = await runUnifiedProvisioning(db, {
      source: 'portal',
      userId,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      email: userRow.email || undefined,
      programId,
      programName,
      admissionDate: now.split('T')[0],
      existingUid: userRow.uid || undefined,
      existingRegNo: userRow.reg_no || undefined,
    }, env.PLATFORM_CONTEXT!.document);

    const courses = currentData.modules?.selected_course_ids || [];

    // ACID transaction: enrollments + student status update + metadata completion flag
    await db.transaction(async (tx) => {
      await tx.prepare(
        `UPDATE students SET status = 'Active', updated_at = ? WHERE user_id = ?`
      ).bind(now, userId).run();

      for (const courseId of courses) {
        await tx.prepare(
          // ON CONFLICT DO NOTHING is standard SQL (SQLite >= 3.24 / PostgreSQL) — portable across D1 and Neon
          `INSERT INTO enrollments (id, student_id, course_id, status) VALUES (?, ?, ?, 'enrolled') ON CONFLICT DO NOTHING`
        ).bind(crypto.randomUUID(), userId, courseId).run();
      }

      await tx.prepare(
        `UPDATE metadata SET value = ? WHERE id = ? AND key = 'registration_data'`
      ).bind(JSON.stringify({ ...currentData, _completed_at: now }), userId).run();
    });

    const finalRegNo = result.regNo || userRow.reg_no;

    const runPostRegistrationTasks = async () => {
      const tasks: Promise<unknown>[] = [];

      tasks.push(
        dispatchPendingJobs(env).catch(e => console.error('[provisioning] Post-reg dispatch failed:', e))
      );

      if (userRow.email && isValidEmail(userRow.email)) {
        tasks.push(
          safeDispatchEmail(env, ctx, {
            to: userRow.email,
            subject: 'BMI University — Registration Complete',
            html: registrationCompleteEmail(userRow.first_name, finalRegNo || 'Pending', programName),
            templateName: 'registration_complete',
            context: { action: 'registration_complete', user_id: userId, reg_no: finalRegNo },
          })
        );

        if (result.documentsGenerated) {
          tasks.push(
            safeDispatchEmail(env, ctx, {
              to: userRow.email,
              subject: 'BMI University — Your Admission Letter',
              html: documentReadyEmail(userRow.first_name, 'admission_letter'),
              templateName: 'document_ready_admission',
              context: { action: 'document_ready', user_id: userId, doc_type: 'admission_letter' },
            }),
            safeDispatchEmail(env, ctx, {
              to: userRow.email,
              subject: 'BMI University — Your Student ID Card',
              html: documentReadyEmail(userRow.first_name, 'id_card'),
              templateName: 'document_ready_id_card',
              context: { action: 'document_ready', user_id: userId, doc_type: 'id_card' },
            })
          );
        }

        if (courses.length > 0) {
          tasks.push(
            safeDispatchEmail(env, ctx, {
              to: userRow.email,
              subject: 'BMI University — Course Enrollment Confirmation',
              html: courseEnrollmentConfirmationEmail(userRow.first_name, courses.length, programName, getPortalUrl(env)),
              templateName: 'course_enrollment_confirmation',
              context: { action: 'enrollment_confirmation', user_id: userId, course_count: courses.length },
            })
          );
        }
      }

      await Promise.allSettled(tasks);
    };

    if (ctx) {
      ctx.waitUntil(runPostRegistrationTasks());
    } else {
      await runPostRegistrationTasks();
    }

    return ok({ message: 'Registration completed successfully' });
  } catch (e: unknown) {
    console.error('Failed to complete registration:', e);
    return error('Failed to complete registration', 500);
  }
}

export async function handleGetAvailableModules(_req: Request, env: Env, userId: string): Promise<Response> {
  try {
    const progMeta = await env.PLATFORM_CONTEXT!.db.prepare(
      `SELECT value FROM metadata WHERE id = ? AND key = 'registration_data'`
    ).bind(userId).first<{ value: string }>();

    let programId: string | null = null;
    if (progMeta) {
      const data: RegistrationData = JSON.parse(progMeta.value);
      programId = data.program?.program_id || null;
    }

    const { results } = await env.PLATFORM_CONTEXT!.db.prepare(
      programId
        ? `SELECT c.id, c.code, c.name, c.credits, c.level FROM courses c JOIN programs p ON c.program_id = p.id WHERE p.id = ? ORDER BY c.code`
        : `SELECT c.id, c.code, c.name, c.credits, c.level FROM courses c ORDER BY c.code`
    ).bind(...(programId ? [programId] : [])).all();

    return ok(results || []);
  } catch {
    return error('Failed to get modules', 500);
  }
}
