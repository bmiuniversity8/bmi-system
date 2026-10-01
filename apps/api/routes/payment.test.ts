import { makeEnv } from './test-helpers';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreatePaymentIntent, handlePaymentWebhook, handleVerifyPayment } from './payment';

describe('Payment routes — handleCreatePaymentIntent (Paystack)', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    // Default user lookup for payer email resolution.
    const db = env.PLATFORM_CONTEXT.db;
    db.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ email: 'student@example.com' }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    });
  });

  it('initializes a Paystack transaction and returns authorizationUrl + merchant', async () => {
    const mockIntent = {
      id: 'BMI-123',
      amount: 50,
      currency: 'ngn',
      status: 'pending',
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
      reference: 'BMI-123',
    };
    env.PLATFORM_CONTEXT.payment.createPaymentIntent.mockResolvedValue(mockIntent);

    const req = new Request('http://localhost/api/payment/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50, reason: 'Document fee' }),
    });
    const res = await handleCreatePaymentIntent(req, env, 'user-123');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    expect(body.data.reference).toBe('BMI-123');
    expect(body.data.merchant).toBe('BEMI TRAINING INSTITUTE');
    const call = env.PLATFORM_CONTEXT.payment.createPaymentIntent.mock.calls[0][0];
    expect(call.amount).toBe(50);
    expect(call.email).toBe('student@example.com');
    expect(call.metadata.merchant).toBe('BEMI TRAINING INSTITUTE');
    expect(call.metadata.userId).toBe('user-123');
  });

  it('returns 400 when amount is missing', async () => {
    const req = new Request('http://localhost/api/payment/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'No amount' }),
    });
    const res = await handleCreatePaymentIntent(req, env, 'user-123');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(env.PLATFORM_CONTEXT.payment.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('returns 400 when no payer email can be resolved', async () => {
    env.PLATFORM_CONTEXT.db.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    });
    const req = new Request('http://localhost/api/payment/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 25, reason: 'Test' }),
    });
    const res = await handleCreatePaymentIntent(req, env, 'user-123');
    expect(res.status).toBe(400);
  });

  it('returns 500 when payment adapter throws', async () => {
    env.PLATFORM_CONTEXT.payment.createPaymentIntent.mockRejectedValue(new Error('Paystack down'));

    const req = new Request('http://localhost/api/payment/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 25, reason: 'Test' }),
    });
    const res = await handleCreatePaymentIntent(req, env, 'user-123');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });

  it('returns 501 when no gateway is configured', async () => {
    env.PLATFORM_CONTEXT.payment.createPaymentIntent.mockRejectedValue(
      new Error('[bootstrap] payment.createPaymentIntent() called, but no real adapter is configured'),
    );
    const req = new Request('http://localhost/api/payment/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 25, reason: 'Test' }),
    });
    const res = await handleCreatePaymentIntent(req, env, 'user-123');
    expect(res.status).toBe(501);
  });
});

describe('Payment routes — handleVerifyPayment', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
  });

  it('returns 400 without a reference', async () => {
    const req = new Request('http://localhost/api/payment/verify');
    const res = await handleVerifyPayment(req, env, 'user-123');
    expect(res.status).toBe(400);
  });

  it('verifies and fulfills a succeeded transaction', async () => {
    env.PLATFORM_CONTEXT.payment.verifyPaymentIntent.mockResolvedValue({
      id: 'BMI-1',
      amount: 100,
      currency: 'ngn',
      status: 'succeeded',
      reference: 'BMI-1',
      metadata: { userId: 'user-123' },
    });
    // No invoice linked -> fulfillment skips invoice writes, clears holds, no user email.
    env.PLATFORM_CONTEXT.db.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    });
    const req = new Request('http://localhost/api/payment/verify/BMI-1');
    const res = await handleVerifyPayment(req, env, 'user-123', 'BMI-1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.verified).toBe(true);
  });

  it('rejects a reference owned by another student', async () => {
    env.PLATFORM_CONTEXT.payment.verifyPaymentIntent.mockResolvedValue({
      id: 'BMI-2',
      amount: 100,
      currency: 'ngn',
      status: 'succeeded',
      reference: 'BMI-2',
      metadata: { userId: 'other-user' },
    });
    const req = new Request('http://localhost/api/payment/verify/BMI-2');
    const res = await handleVerifyPayment(req, env, 'user-123', 'BMI-2');
    expect(res.status).toBe(403);
  });
});

describe('Payment routes — handlePaymentWebhook', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
  });

  it('processes a valid Paystack webhook payload', async () => {
    const mockIntent = { id: 'BMI-webhook-1', amount: 100, currency: 'ngn', status: 'succeeded', metadata: {} };
    env.PLATFORM_CONTEXT.payment.handleWebhook.mockResolvedValue(mockIntent);
    env.PLATFORM_CONTEXT.db.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    });

    const req = new Request('http://localhost/api/payment/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': 'test_sig',
      },
      body: JSON.stringify({ event: 'charge.success', data: { reference: 'BMI-webhook-1' } }),
    });
    const res = await handlePaymentWebhook(req, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.intentId).toBe('BMI-webhook-1');
    expect(env.PLATFORM_CONTEXT.payment.handleWebhook).toHaveBeenCalled();
  });

  it('returns 400 when webhook processing fails', async () => {
    env.PLATFORM_CONTEXT.payment.handleWebhook.mockRejectedValue(new Error('Invalid signature'));

    const req = new Request('http://localhost/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'bad_sig' },
      body: JSON.stringify({ event: 'charge.success' }),
    });
    const res = await handlePaymentWebhook(req, env);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});
