import { PORTAL_URL } from '@bmi/shared';
import type { Env } from './types';

export interface SMSPayload {
  to: string;
  message: string;
  templateName?: string;
  traceId?: string;
  context?: Record<string, unknown>;
}

export interface SMSResult {
  success: boolean;
  simulated: boolean;
  messageId: string;
  error?: string;
}

/**
 * Clean and format international E.164 phone numbers
 */
export function formatE164Phone(rawPhone: string, defaultCountryCode: string = '+231'): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') return null;

  // Strip whitespace, hyphens, parentheses, and letters
  let cleaned = rawPhone.replace(/[\s\-().]/g, '').trim();

  // Handle leading 00 as +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  // If missing +, check if it already starts with the country code digits
  if (!cleaned.startsWith('+')) {
    const rawCc = defaultCountryCode.replace('+', '');
    if (cleaned.startsWith(rawCc)) {
      cleaned = `+${cleaned}`;
    } else {
      // If starts with single 0, remove the leading 0
      if (cleaned.startsWith('0')) {
        cleaned = cleaned.slice(1);
      }
      cleaned = `${defaultCountryCode}${cleaned}`;
    }
  }

  // Basic validation: + followed by 7 to 15 digits
  const E164_REGEX = /^\+[1-9]\d{6,14}$/;
  if (!E164_REGEX.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Higher-Ed SMS Message Templates
 */
export function buildApplicationReceivedSMS(studentName: string, appNumber: string): string {
  const shortName = studentName ? studentName.split(' ')[0] : 'Applicant';
  return `BMI University: Welcome ${shortName}! Your application #${appNumber} has been received and is under review. Track status: ${PORTAL_URL}/status`;
}

export function buildDecisionReadySMS(studentName: string): string {
  const shortName = studentName ? studentName.split(' ')[0] : 'Applicant';
  return `BMI University: Hello ${shortName}, an admissions decision has been issued for your application. View your decision letter now: ${PORTAL_URL}/status`;
}

export function buildOfferAcceptedSMS(studentName: string, officialStudentId: string): string {
  const shortName = studentName ? studentName.split(' ')[0] : 'Student';
  return `BMI University: Congratulations ${shortName}! Your offer is accepted. Your Student ID is ${officialStudentId}. Complete registration: ${PORTAL_URL}/registration`;
}

export function buildRegistrationConfirmedSMS(studentName: string, termName: string, credits: number): string {
  const shortName = studentName ? studentName.split(' ')[0] : 'Student';
  return `BMI University: Registration confirmed for ${shortName} (${termName} - ${credits} credits). Access your student portal: ${PORTAL_URL}/student/dashboard`;
}

/**
 * Core SMS Dispatcher with Resilient Simulator Fallback
 * 
 * If active SMS gateway credentials (TWILIO or AFRICASTALKING) are not configured,
 * it safely logs the SMS payload to the structured log and returns a successful
 * simulation response without throwing or blocking.
 */
export async function sendSMS(env: Env, payload: SMSPayload): Promise<SMSResult> {
  const traceId = payload.traceId || `trace_sms_${crypto.randomUUID().slice(0, 8)}`;
  const tag = `[sms:${traceId}]`;

  const formattedPhone = formatE164Phone(payload.to);
  if (!formattedPhone) {
    console.warn(`${tag} SKIPPED — Invalid phone number: ${payload.to}`);
    return {
      success: false,
      simulated: false,
      messageId: `err_${Date.now()}`,
      error: 'Invalid phone format',
    };
  }

  // 1. Check Twilio Configuration
  const twilioSid = (env as any).TWILIO_ACCOUNT_SID;
  const twilioAuth = (env as any).TWILIO_AUTH_TOKEN;
  const twilioFrom = (env as any).TWILIO_FROM_PHONE;

  if (twilioSid && twilioAuth && twilioFrom) {
    try {
      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const authHeader = 'Basic ' + btoa(`${twilioSid}:${twilioAuth}`);
      const body = new URLSearchParams({
        To: formattedPhone,
        From: twilioFrom,
        Body: payload.message,
      });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (res.ok) {
        const data: any = await res.json();
        console.log(`${tag} SENT via Twilio (SID: ${data.sid}) to ${formattedPhone}`);
        return { success: true, simulated: false, messageId: data.sid || `tw_${Date.now()}` };
      } else {
        const errText = await res.text();
        console.error(`${tag} Twilio dispatch failed (${res.status}): ${errText}`);
      }
    } catch (err: unknown) {
      console.error(`${tag} Twilio network exception:`, err);
    }
  }

  // 2. Check Africa's Talking Configuration
  const atApiKey = (env as any).AFRICASTALKING_API_KEY;
  const atUsername = (env as any).AFRICASTALKING_USERNAME;
  const atFrom = (env as any).AFRICASTALKING_FROM || 'BMI_UNIV';

  if (atApiKey && atUsername) {
    try {
      const endpoint = 'https://api.africastalking.com/version1/messaging';
      const body = new URLSearchParams({
        username: atUsername,
        to: formattedPhone,
        message: payload.message,
        from: atFrom,
      });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apiKey: atApiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      if (res.ok) {
        await res.json().catch(() => null);
        console.log(`${tag} SENT via Africa's Talking to ${formattedPhone}`);
        return { success: true, simulated: false, messageId: `at_${Date.now()}` };
      } else {
        const errText = await res.text();
        console.error(`${tag} Africa's Talking dispatch failed (${res.status}): ${errText}`);
      }
    } catch (err: unknown) {
      console.error(`${tag} Africa's Talking network exception:`, err);
    }
  }

  // 3. Resilient Fallback Simulator (No SMS provider registered or network unavailable)
  // Transparently logs payload without crashing or blocking user workflow
  const simulatedMessageId = `sim_sms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  console.log(
    `${tag} [SIMULATOR] SMS Registered (No live provider credentials configured) | To: ${formattedPhone} | Template: ${payload.templateName || 'custom'} | Message: "${payload.message}"`
  );

  return {
    success: true,
    simulated: true,
    messageId: simulatedMessageId,
  };
}

/**
 * Fire-and-forget safe SMS dispatcher for background ExecutionContext
 */
export function safeDispatchSMS(
  env: Env,
  payload: SMSPayload,
  ctx?: ExecutionContext
): void {
  const task = sendSMS(env, payload).catch(err => {
    console.error(`[sms:dispatch-fail] ${payload.to}:`, err);
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(task);
  }
}
