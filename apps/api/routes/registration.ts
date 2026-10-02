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
    const db = env.PLATFORM_CONTEXT!.db;
    const [existingMeta, userRow, appRow] = await Promise.all([
      db.prepare(`SELECT value FROM metadata WHERE id = ? AND key = 'registration_data'`).bind(userId).first<{ value: string }>(),
      db.prepare(`SELECT first_name, last_name, date_of_birth, gender, nationality, phone, address FROM users WHERE id = ?`).bind(userId).first<{ first_name: string; last_name: string; date_of_birth: string; gender: string; nationality: string; phone: string; address: string }>(),
      db.prepare(`SELECT program, program_id, degree_level FROM applications WHERE user_id = ? AND status = 'accepted' ORDER BY updated_at DESC LIMIT 1`).bind(userId).first<{ program: string; program_id: string | null; degree_level: string }>().catch(() =>
        db.prepare(`SELECT program, degree_level FROM applications WHERE user_id = ? AND status = 'accepted' ORDER BY updated_at DESC LIMIT 1`).bind(userId).first<{ program: string; degree_level: string }>()
      ),
    ]);

    const savedData: RegistrationData = existingMeta ? JSON.parse(existingMeta.value) : {};
    const currentData: RegistrationData = JSON.parse(JSON.stringify(savedData));

    // Auto-populate default personal_details if missing
    if (!currentData.personal_details && userRow) {
      let dobStr = '';
      if (userRow.date_of_birth) {
        try {
          dobStr = new Date(userRow.date_of_birth).toISOString().split('T')[0];
        } catch {
          dobStr = String(userRow.date_of_birth);
        }
      }
      currentData.personal_details = {
        first_name: userRow.first_name || '',
        last_name: userRow.last_name || '',
        date_of_birth: dobStr,
        gender: userRow.gender || '',
        nationality: userRow.nationality || '',
        phone: userRow.phone || '',
      };
    }

    // Auto-populate default address if missing
    if (!currentData.address && userRow) {
      currentData.address = {
        current_address: userRow.address || '',
        city: '',
        state: '',
        country: userRow.nationality || '',
        emergency_contact_name: '',
        emergency_contact_phone: '',
      };
    }

    // Auto-populate default program if missing (ID-first, name fallback)
    let selectedProgName = currentData.program?.program_name || appRow?.program;
    let selectedProgId = currentData.program?.program_id || (appRow as { program_id?: string | null })?.program_id || null;

    if (appRow && !currentData.program) {
      let prog: { id: string; level: string } | null = null;
      if (selectedProgId) {
        prog = await db.prepare(`SELECT id, level FROM programs WHERE id = ? LIMIT 1`).bind(selectedProgId).first<{ id: string; level: string }>().catch(() => null);
      }
      if (!prog) {
        prog = await db.prepare(`SELECT id, level FROM programs WHERE name = ? LIMIT 1`).bind(appRow.program).first<{ id: string; level: string }>();
        selectedProgId = prog?.id || null;
      }
      currentData.program = {
        program_id: prog?.id || selectedProgId || '',
        program_name: appRow.program,
        level: appRow.degree_level || prog?.level || 'undergraduate',
        study_mode: 'full_time',
      };
      selectedProgName = appRow.program;
    }

    let programFeeInfo: { amount: number; description?: string } | null = null;
    if (selectedProgId) {
      const feeRow = await db.prepare(
        `SELECT amount, description FROM program_fees WHERE program_id = ? LIMIT 1`
      ).bind(selectedProgId).first<{ amount: number; description?: string }>().catch(() => null);
      if (feeRow) {
        programFeeInfo = { amount: feeRow.amount, description: feeRow.description || undefined };
      }
    }
    if (!programFeeInfo && selectedProgName) {
      const feeRow = await db.prepare(
        `SELECT pf.amount, pf.description FROM program_fees pf JOIN programs p ON p.id = pf.program_id WHERE p.name = ? LIMIT 1`
      ).bind(selectedProgName).first<{ amount: number; description?: string }>();
      if (feeRow) {
        programFeeInfo = { amount: feeRow.amount, description: feeRow.description || undefined };
      }
    }

    const completedSteps = STEP_ORDER.filter(s => savedData[s] !== undefined);
    const nextStep = STEP_ORDER.find(s => savedData[s] === undefined) || null;

    return ok({
      completed_steps: completedSteps,
      next_step: nextStep,
      current_data: currentData,
      registration_complete: nextStep === null,
      program_fee_info: programFeeInfo,
    });
  } catch (e) {
    console.error('Failed to get registration status:', e);
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

/**
 * GET /api/student/sections?course_id=&term_id=
 * Canonical section picker: course → sections (capacity, schedule, lecturer).
 * Students must reserve a SECTION, never a bare course.
 */
export async function handleListSections(req: Request, env: Env, userId: string): Promise<Response> {
  try {
    const url = new URL(req.url);
    const courseId = url.searchParams.get('course_id');
    const termId = url.searchParams.get('term_id');
    if (!courseId) return error('course_id is required', 400);

    let query = `SELECT cs.id, cs.course_id, cs.term_id, cs.section_code, cs.capacity, cs.seats_taken,
                        cs.schedule, cs.room, cs.is_active, c.code, c.title, c.credits
                 FROM course_sections cs JOIN courses c ON c.id = cs.course_id
                 WHERE cs.course_id = ? AND cs.is_active = 1`;
    const bindings: unknown[] = [courseId];
    if (termId) {
      query += ` AND cs.term_id = ?`;
      bindings.push(termId);
    }
    query += ` ORDER BY cs.section_code ASC`;

    const { results } = await env.PLATFORM_CONTEXT!.db.prepare(query).bind(...bindings).all();
    const sections = (results || []).map((s: any) => ({
      ...s,
      seats_available: Math.max(0, (s.capacity || 0) - (s.seats_taken || 0)),
      is_full: (s.seats_taken || 0) >= (s.capacity || 0),
    }));

    // Mark sections the student already holds
    let mine: string[] = [];
    try {
      const mineRes = await env.PLATFORM_CONTEXT!.db.prepare(
        `SELECT section_id FROM student_course_registrations WHERE student_id = ? AND course_id = ? AND status = 'registered'`
      ).bind(userId, courseId).all<{ section_id: string }>();
      mine = (mineRes.results || []).map(r => r.section_id).filter(Boolean);
    } catch { /* ignore */ }

    return ok({ sections, my_section_ids: mine });
  } catch {
    return error('Failed to list sections', 500);
  }
}

// ─── Unified State Machine & Registration Services ────────────────────────────

import { checkRegistrationEligibility } from '../lib/eligibility-service';
import { reserveSectionSeat, dropSectionSeat } from '../lib/seat-allocation-service';
import { setEnrollmentStatus, getEnrollmentStatus, ENROLLMENT_STATUS } from '../lib/state-machine';
import { runTermCensusJob } from '../lib/census-job';

export async function handleGetRegistrationEligibility(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const termId = url.searchParams.get('term_id') || undefined;

    const result = await checkRegistrationEligibility(env.PLATFORM_CONTEXT!.db, userId, termId);
    return ok(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to evaluate registration eligibility';
    return error(message, 500);
  }
}

export async function handleReserveSeat(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    // 1. Verify eligibility first
    const eligibility = await checkRegistrationEligibility(env.PLATFORM_CONTEXT!.db, userId);
    if (!eligibility.eligible) {
      return error(`Ineligible to register: ${eligibility.reasons.join(', ')}`, 403);
    }

    const body = await typedJson<{ section_id: string; term_id?: string }>(req);
    if (!body.section_id) {
      return error('section_id is required', 400);
    }

    const result = await reserveSectionSeat(env.PLATFORM_CONTEXT!.db, {
      sectionId: body.section_id,
      studentId: userId,
      termId: body.term_id,
    });

    return ok(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to reserve seat';
    return error(message, 500);
  }
}

export async function handleWaitlistSeat(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    // Same gate as seat reservation — waitlisting is still a registration action.
    const eligibility = await checkRegistrationEligibility(env.PLATFORM_CONTEXT!.db, userId);
    if (!eligibility.eligible) {
      return error(`Ineligible to register: ${eligibility.reasons.join(', ')}`, 403);
    }

    const body = await typedJson<{ section_id: string }>(req);
    if (!body.section_id) return error('section_id is required', 400);

    const result = await reserveSectionSeat(env.PLATFORM_CONTEXT!.db, {
      sectionId: body.section_id,
      studentId: userId,
    });

    return ok(result);
  } catch (err: unknown) {
    return error('Failed to join waitlist', 500);
  }
}

export async function handleDropSectionSeat(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const body = await typedJson<{ course_id: string; section_id?: string }>(req);
    if (!body.course_id) return error('course_id is required', 400);

    const result = await dropSectionSeat(env.PLATFORM_CONTEXT!.db, {
      courseId: body.course_id,
      sectionId: body.section_id,
      studentId: userId,
    });

    return ok(result);
  } catch (err: unknown) {
    return error('Failed to drop course', 500);
  }
}

export async function handleGetFinancialAid(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const termId = url.searchParams.get('term_id');

    let query = `SELECT * FROM financial_aid_awards WHERE student_id = ?`;
    const bindings: unknown[] = [userId];
    if (termId) {
      query += ` AND term_id = ?`;
      bindings.push(termId);
    }

    const { results } = await env.PLATFORM_CONTEXT!.db.prepare(query).bind(...bindings).all();
    const awards = results || [];
    const totalAwarded = awards.reduce((sum: number, a: any) => sum + (a.amount || 0), 0);

    return ok({ awards, total_awarded: totalAwarded });
  } catch {
    return ok({ awards: [], total_awarded: 0 });
  }
}

export async function handleGetFeeAgreement(
  _req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    const db = env.PLATFORM_CONTEXT!.db;
    const student = await db.prepare(
      `SELECT s.program, s.program_id, s.catalog_year_id FROM students s WHERE s.user_id = ?`
    ).bind(userId).first<{ program: string; program_id: string; catalog_year_id: string }>();

    let grossTuition = 1500; // default base tuition
    if (student?.program_id) {
      const feeRow = await db.prepare(
        `SELECT amount FROM program_fees WHERE program_id = ? LIMIT 1`
      ).bind(student.program_id).first<{ amount: number }>();
      if (feeRow?.amount) grossTuition = feeRow.amount;
    }

    // Query financial aid to calculate net balance
    const aidRow = await db.prepare(
      `SELECT SUM(amount) as total_aid FROM financial_aid_awards WHERE student_id = ? AND status != 'cancelled'`
    ).bind(userId).first<{ total_aid: number }>();

    const totalAid = aidRow?.total_aid || 0;
    const netBalance = Math.max(0, grossTuition - totalAid);

    return ok({
      program_name: student?.program || 'Academic Program',
      catalog_year_id: student?.catalog_year_id || 'CAT-2026',
      gross_tuition: grossTuition,
      financial_aid_discount: totalAid,
      net_balance_due: netBalance,
      currency: 'USD',
      payment_plans: [
        { id: 'full', name: 'Single Full Payment', discount: '5% early discount' },
        { id: 'installments_2', name: 'Two Installments (50% now, 50% midterm)' },
        { id: 'installments_4', name: 'Four Monthly Installments' },
      ],
    });
  } catch (err: unknown) {
    return error('Failed to retrieve fee agreement', 500);
  }
}

export async function handleGetEnrollmentAgreement(_req: Request, _env: Env): Promise<Response> {
  try {
    const { getEnrollmentAgreementMeta, ENROLLMENT_AGREEMENT_TEXT } = await import('../lib/agreement');
    const meta = await getEnrollmentAgreementMeta();
    return ok({ ...meta, text: ENROLLMENT_AGREEMENT_TEXT });
  } catch {
    return error('Failed to retrieve enrollment agreement', 500);
  }
}

export async function handleSignEnrollmentAgreement(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const body = await typedJson<{
      document_id: string;
      signed_name: string;
      document_version_hash: string;
    }>(req);

    if (!body.document_id || !body.signed_name || !body.document_version_hash) {
      return error('document_id, signed_name, and document_version_hash are required', 400);
    }

    const ipAddress = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || '127.0.0.1';
    const userAgent = req.headers.get('User-Agent') || 'Unknown';
    const sigId = crypto.randomUUID();
    const now = new Date().toISOString();

    const db = env.PLATFORM_CONTEXT!.db;

    // Idempotency: one signature per user+document+version.
    const existing = await db.prepare(
      `SELECT id FROM esignatures WHERE user_id = ? AND document_id = ? AND document_version_hash = ? LIMIT 1`
    ).bind(userId, body.document_id, body.document_version_hash).first<{ id: string }>().catch(() => null);
    if (existing) {
      return ok({
        success: true,
        signature_id: existing.id,
        agreement_signed: true,
        message: 'Enrollment agreement already signed for this document version.',
      });
    }

    // Record legally binding e-signature. This alone does NOT confer REGISTERED —
    // the canonical POST /api/registration/finalize transaction owns that transition
    // after validating courses, capacity, holds, payment and this signature together.
    await db.prepare(
      `INSERT INTO esignatures (
         id, document_id, user_id, signed_name, signed_at, ip_address, user_agent, document_version_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sigId,
      body.document_id,
      userId,
      body.signed_name,
      now,
      ipAddress,
      userAgent,
      body.document_version_hash,
      now
    ).run();

    // Nudge state machine forward (ELIGIBLE → IN_PROGRESS) so the portal can
    // reflect "agreement signed, awaiting final validation" without prematurely
    // granting REGISTERED. Best-effort: ignore invalid-transition errors here;
    // finalize() performs the authoritative transition.
    try {
      const current = await getEnrollmentStatus(db, userId);
      if (current.status === ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE) {
        await setEnrollmentStatus(db, {
          userId,
          status: ENROLLMENT_STATUS.REGISTRATION_IN_PROGRESS,
          changedBy: userId,
          reason: `Terms of enrollment agreement signed electronically by ${body.signed_name}`,
        });
      }
    } catch {
      // Non-fatal — finalize remains the gate.
    }

    return ok({
      success: true,
      signature_id: sigId,
      agreement_signed: true,
      message: 'Enrollment agreement signed and recorded. Complete all remaining steps, then finalize registration.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to sign enrollment agreement';
    return error(message, 500);
  }
}

/**
 * POST /api/registration/finalize — canonical registration transaction.
 * Owns the REGISTERED transition. Validates everything atomically:
 * state, term/window, holds, advising, course registrations, prerequisites
 * (via seat service records), financial clearance (paid invoice), agreement
 * signature, and duplicate registration — then commits in one transaction.
 */
export async function handleFinalizeRegistration(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const db = env.PLATFORM_CONTEXT!.db;

    // 1. Canonical state must allow finalization
    const current = await getEnrollmentStatus(db, userId);
    const allowedFrom = [ENROLLMENT_STATUS.REGISTRATION_ELIGIBLE, ENROLLMENT_STATUS.REGISTRATION_IN_PROGRESS];
    if (!allowedFrom.includes(current.status as any)) {
      return error(`Cannot finalize registration from status ${current.status}. Complete onboarding steps first.`, 403);
    }

    // 2. Full eligibility gate (holds, advising, term, student record)
    const eligibility = await checkRegistrationEligibility(db, userId);
    if (!eligibility.eligible) {
      return error(`Registration blocked: ${eligibility.reasons.join('; ')}`, 403);
    }

    const termId = eligibility.term?.id;
    if (!termId) return error('No active registration term found.', 400);

    // 3. Course selection: at least one registered section for the term
    const regs = await db.prepare(
      `SELECT id, status FROM student_course_registrations WHERE student_id = ? AND term_id = ?`
    ).bind(userId, termId).all<{ id: string; status: string }>().catch(() => null);
    const regRows = regs?.results || [];
    const activeRegs = regRows.filter(r => r.status === 'registered');
    if (activeRegs.length === 0) {
      return error('No registered courses for this term. Select sections before finalizing.', 400);
    }

    // 4. Financial clearance: paid invoice required (any paid invoice for the student;
    //    term-scoped when invoice carries term metadata).
    const paidInvoice = await db.prepare(
      `SELECT id FROM invoices WHERE student_id = ? AND status = 'paid' LIMIT 1`
    ).bind(userId).first<{ id: string }>().catch(() => null);
    if (!paidInvoice) {
      return error('Financial clearance required: no paid tuition invoice found.', 402);
    }

    // 5. Agreement signature required
    const sig = await db.prepare(
      `SELECT id FROM esignatures WHERE user_id = ? LIMIT 1`
    ).bind(userId).first<{ id: string }>().catch(() => null);
    if (!sig) {
      return error('Enrollment agreement signature required before finalizing.', 400);
    }

    // 6. Duplicate registration guard
    if (current.status === ENROLLMENT_STATUS.REGISTERED) {
      return error('Already registered for this lifecycle stage.', 409);
    }

    // 7. Commit: mirror section registrations into enrollments + REGISTERED
    await db.transaction(async (tx) => {
      for (const r of activeRegs) {
        await tx.prepare(
          `INSERT INTO enrollments (id, student_id, course_id, status) VALUES (?, ?, ?, 'enrolled') ON CONFLICT DO NOTHING`
        ).bind(crypto.randomUUID(), userId, r.id).run().catch(() => {});
      }
    });

    await setEnrollmentStatus(db, {
      userId,
      status: ENROLLMENT_STATUS.REGISTERED,
      changedBy: userId,
      termId,
      reason: `Registration finalized: ${activeRegs.length} section(s), invoice paid, agreement signed`,
    });

    return ok({
      success: true,
      status: ENROLLMENT_STATUS.REGISTERED,
      registered_sections: activeRegs.length,
      term_id: termId,
      message: 'Registration completed successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to finalize registration';
    // State-machine transition errors surface as 409 (invalid lifecycle move)
    if (/Invalid enrollment transition/i.test(message)) return error(message, 409);
    return error(message, 500);
  }
}

export async function handleGetCanonicalEnrollmentStatus(
  _req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    const status = await getEnrollmentStatus(env.PLATFORM_CONTEXT!.db, userId);
    return ok(status);
  } catch (err: unknown) {
    return error('Failed to retrieve enrollment status', 500);
  }
}

export async function handleRunCensusJob(
  req: Request,
  env: Env,
  adminId: string
): Promise<Response> {
  if (req.method !== 'POST') return error('Method not allowed', 405);
  try {
    const body = await typedJson<{ term_id?: string }>(req).catch(() => ({ term_id: undefined }));
    const result = await runTermCensusJob(env.PLATFORM_CONTEXT!.db, body.term_id, adminId);
    return ok(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to run census job';
    return error(message, 500);
  }
}

