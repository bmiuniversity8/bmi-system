import { describe, it, expect, vi } from 'vitest';
import { formatE164Phone, sendSMS, safeDispatchSMS, buildApplicationReceivedSMS, buildDecisionReadySMS, buildOfferAcceptedSMS, buildRegistrationConfirmedSMS } from './sms';
import type { Env } from './types';

describe('SMS Notification Subsystem & Resilient Simulator', () => {
  it('correctly formats phone numbers to standard E.164', () => {
    expect(formatE164Phone('+231777123456')).toBe('+231777123456');
    expect(formatE164Phone('0777123456', '+231')).toBe('+231777123456');
    expect(formatE164Phone('00231777123456')).toBe('+231777123456');
    expect(formatE164Phone(' (231) 777-123456 ')).toBe('+231777123456');
    expect(formatE164Phone('invalid-string')).toBeNull();
    expect(formatE164Phone('')).toBeNull();
  });

  it('generates clear, friendly SMS templates', () => {
    const appSMS = buildApplicationReceivedSMS('John Doe', 'APP-2026-001');
    expect(appSMS).toContain('John');
    expect(appSMS).toContain('APP-2026-001');

    const decSMS = buildDecisionReadySMS('Jane Doe');
    expect(decSMS).toContain('Jane');
    expect(decSMS).toContain('/status');

    const offerSMS = buildOfferAcceptedSMS('John Doe', 'BMI-2026-101');
    expect(offerSMS).toContain('BMI-2026-101');

    const regSMS = buildRegistrationConfirmedSMS('John Doe', 'Fall 2026', 15);
    expect(regSMS).toContain('Fall 2026');
    expect(regSMS).toContain('15 credits');
  });

  it('runs safely in Simulator mode when no SMS credentials are provided', async () => {
    const mockEnv: Env = {
      PLATFORM_CONTEXT: { db: {} as any },
    } as any;

    const result = await sendSMS(mockEnv, {
      to: '+231777000111',
      message: 'Test message for applicant',
      templateName: 'test_sms',
    });

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.messageId).toContain('sim_sms_');
  });

  it('rejects invalid phone numbers cleanly without throwing', async () => {
    const mockEnv: Env = {} as any;

    const result = await sendSMS(mockEnv, {
      to: '123',
      message: 'Too short',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid phone format');
  });

  it('executes safeDispatchSMS without unhandled rejections', () => {
    const mockEnv: Env = {} as any;
    const waitUntilMock = vi.fn();
    const ctx = { waitUntil: waitUntilMock } as unknown as ExecutionContext;

    safeDispatchSMS(
      mockEnv,
      {
        to: '+231777000111',
        message: 'Background dispatch test',
      },
      ctx
    );

    expect(waitUntilMock).toHaveBeenCalled();
  });
});
