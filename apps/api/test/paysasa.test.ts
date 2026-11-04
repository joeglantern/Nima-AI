/**
 * The PaySasa pieces that need no database: signatures, the two step charge,
 * what a session read means, and what is kept from a webhook.
 */

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentGatewayError } from '../src/services/payments/index.js';
import { PaysasaGateway } from '../src/services/payments/paysasa.js';

const WEBHOOK_SECRET = 'whsec_unit_secret';
const gateway = new PaysasaGateway({
  apiKey: 'apk_test_unit.secret',
  businessId: 'biz_unit',
  webhookSecret: WEBHOOK_SECRET,
  baseUrl: 'http://127.0.0.1:1/api/v1',
});
const sign = (body: string | Buffer) =>
  createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

type Call = { url: string; init: RequestInit };

/** A fetch that answers each call in turn and remembers what it was asked. */
function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keys', () => {
  it('knows a live key from a test key', () => {
    expect(gateway.live).toBe(false);
    expect(
      new PaysasaGateway({
        apiKey: 'apk_live_x.y',
        businessId: 'biz',
        webhookSecret: null,
        baseUrl: 'http://127.0.0.1:1',
      }).live,
    ).toBe(true);
  });

  it('has no refund API and no reference of its own', () => {
    expect(gateway.canRefund).toBe(false);
    expect(gateway.referenceFor()).toBeNull();
  });
});

describe('webhook signature', () => {
  const body = '{"event":"checkout.paid","data":{"session_id":"ses_abc","amount":150000}}';

  it('accepts the HMAC SHA256 of the exact bytes, with or without the sha256= prefix', () => {
    expect(gateway.verifySignature(Buffer.from(body), sign(body))).toBe(true);
    expect(gateway.verifySignature(body, `sha256=${sign(body)}`)).toBe(true);
    expect(gateway.verifySignature(body, sign(body).toUpperCase())).toBe(true);
  });

  it('refuses a body changed by one byte, or re-serialised', () => {
    expect(gateway.verifySignature(body.replace('150000', '150001'), sign(body))).toBe(false);
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(gateway.verifySignature(pretty, sign(body))).toBe(false);
  });

  it('refuses a missing, short, non hex, wrongly keyed or wrongly hashed signature', () => {
    expect(gateway.verifySignature(body, undefined)).toBe(false);
    expect(gateway.verifySignature(body, '')).toBe(false);
    expect(gateway.verifySignature(body, 'deadbeef')).toBe(false);
    expect(gateway.verifySignature(body, `${sign(body).slice(0, -1)}z`)).toBe(false);
    const wrongKey = createHmac('sha256', 'whsec_other').update(body).digest('hex');
    expect(gateway.verifySignature(body, wrongKey)).toBe(false);
    const sha512 = createHmac('sha512', WEBHOOK_SECRET).update(body).digest('hex');
    expect(gateway.verifySignature(body, sha512)).toBe(false);
  });

  it('refuses everything when there is no webhook secret', () => {
    const unsigned = new PaysasaGateway({
      apiKey: 'apk_test_x.y',
      businessId: 'biz',
      webhookSecret: null,
      baseUrl: 'http://127.0.0.1:1',
    });
    expect(unsigned.signsWebhooks).toBe(false);
    expect(unsigned.verifySignature(body, sign(body))).toBe(false);
  });
});

describe('webhook parsing', () => {
  it('reads checkout.paid as a prompt to read the session back', () => {
    expect(
      gateway.parseWebhook({
        event: 'checkout.paid',
        created_at: '2026-11-04T12:00:00.000Z',
        data: { session_id: 'ses_01', reference: 'CHK-1', amount: 150000, currency: 'KES' },
      }),
    ).toEqual({
      kind: 'charge',
      event: 'checkout.paid',
      reference: 'ses_01',
      externalId: 'checkout.paid:ses_01',
    });
  });

  it('reads checkout.expired the same way, under a different replay key', () => {
    const notice = gateway.parseWebhook({
      event: 'checkout.expired',
      data: { session_id: 'ses_01' },
    });
    expect(notice?.kind).toBe('charge');
    expect(notice?.externalId).toBe('checkout.expired:ses_01');
  });

  it('ignores events it does not act on, and payloads with no session', () => {
    expect(gateway.parseWebhook({ event: 'payout.completed', data: {} })?.kind).toBe('other');
    expect(gateway.parseWebhook({ event: 'checkout.paid', data: {} })).toBeNull();
    expect(gateway.parseWebhook({ data: {} })).toBeNull();
    expect(gateway.parseWebhook('nope')).toBeNull();
  });
});

describe('charge', () => {
  const request = {
    amountCents: 150000,
    phone: '0712 345 678',
    reference: 'NIMA ABC123',
    description: 'Nima Checkout',
    idempotencyKey: 'key-1',
    callbackUrl: 'https://api.example/webhooks/paysasa',
  };

  it('names a session, hands the id over, then pushes the prompt', async () => {
    const calls = fakeFetch([
      { status: 201, body: { session: { id: 'ses_01', status: 'pending', amount: 150000 } } },
      { status: 200, body: { status: 'processing', checkout_request_id: 'ws_CO_1' } },
    ]);
    const seen: string[] = [];

    const result = await gateway.charge({
      ...request,
      onReference: async (ref) => {
        seen.push(ref);
        expect(calls).toHaveLength(1);
      },
    });

    expect(result).toEqual({
      providerRef: 'ses_01',
      status: 'PROCESSING',
      providerMessage: 'checkout_request_id ws_CO_1',
    });
    expect(seen).toEqual(['ses_01']);

    const [create, pay] = calls;
    expect(create?.url).toBe('http://127.0.0.1:1/api/v1/checkout/sessions');
    const createHeaders = create?.init.headers as Record<string, string>;
    expect(createHeaders['x-api-key']).toBe('apk_test_unit.secret');
    expect(JSON.parse(String(create?.init.body))).toMatchObject({
      amount: 150000,
      currency: 'KES',
      business_id: 'biz_unit',
      allow_methods: ['m_pesa'],
      metadata: { source: 'nima', idempotencyKey: 'key-1' },
    });

    expect(pay?.url).toBe('http://127.0.0.1:1/api/v1/checkout/sessions/ses_01/pay');
    const payHeaders = pay?.init.headers as Record<string, string>;
    expect(payHeaders['x-idempotency-key']).toBe('key-1');
    expect(JSON.parse(String(pay?.init.body))).toEqual({
      payment_method: 'm_pesa',
      phone: '254712345678',
    });
  });

  it('refuses a bad number or amount before calling anyone', async () => {
    const calls = fakeFetch([]);
    const bad = await gateway.charge({ ...request, phone: '12345' });
    expect(bad.status).toBe('FAILED');
    const big = await gateway.charge({ ...request, amountCents: 250_001 * 100 });
    expect(big.failureReason).toContain('250,000');
    expect(calls).toHaveLength(0);
  });

  it('a failure before the session is named is clean, not ambiguous', async () => {
    fakeFetch([{ status: 502, body: {} }]);
    const error = await gateway.charge(request).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect((error as PaymentGatewayError).retryable).toBe(true);
    expect((error as PaymentGatewayError).ambiguous).toBe(false);
  });

  it('a failure after the session is named is ambiguous', async () => {
    fakeFetch([
      { status: 201, body: { session: { id: 'ses_02', status: 'pending' } } },
      { status: 503, body: {} },
    ]);
    const error = await gateway.charge(request).catch((cause: unknown) => cause);
    expect((error as PaymentGatewayError).ambiguous).toBe(true);
  });

  it('an unverified business is our problem, said plainly', async () => {
    fakeFetch([
      {
        status: 403,
        body: { error: 'Business must be verified before checkout', code: 'business_unverified' },
      },
    ]);
    const error = await gateway.charge(request).catch((cause: unknown) => cause);
    expect((error as PaymentGatewayError).message).toContain('not working right now');
    expect((error as PaymentGatewayError).retryable).toBe(false);
  });

  it('a refused prompt reads as words the buyer can act on', async () => {
    fakeFetch([
      { status: 201, body: { session: { id: 'ses_03', status: 'pending' } } },
      { status: 422, body: { error: 'Insufficient balance', code: 'insufficient_funds' } },
    ]);
    const result = await gateway.charge(request);
    expect(result.status).toBe('FAILED');
    expect(result.providerRef).toBe('ses_03');
    expect(result.failureReason).toContain('not enough');
  });
});

describe('verify', () => {
  it.each([
    ['paid', 'SUCCEEDED'],
    ['completed', 'SUCCEEDED'],
    ['pending', 'PENDING'],
    ['processing', 'PENDING'],
    ['failed', 'FAILED'],
    ['expired', 'FAILED'],
    ['cancelled', 'FAILED'],
  ])('%s reads as %s', async (status, expected) => {
    fakeFetch([
      {
        status: 200,
        body: {
          session: {
            id: 'ses_09',
            reference: 'CHK-9',
            status,
            amount: 150000,
            currency: 'KES',
            payment_method: 'm_pesa',
          },
        },
      },
    ]);
    const verified = await gateway.verify('ses_09');
    expect(verified.state).toBe(expected);
    expect(verified.reference).toBe('ses_09');
    expect(verified.amountCents).toBe(150000);
    expect(verified.currency).toBe('KES');
    expect(verified.raw).toMatchObject({ id: 'ses_09', paysasaReference: 'CHK-9', status });
    if (expected === 'FAILED') {
      expect(verified.failureReason).toMatch(/try again/i);
    } else {
      expect(verified.failureReason).toBeNull();
    }
  });

  it('a session PaySasa has never heard of is NOT_FOUND', async () => {
    fakeFetch([{ status: 404, body: { error: 'Session not found' } }]);
    expect((await gateway.verify('ses_nope')).state).toBe('NOT_FOUND');
  });

  it('cannot be read when PaySasa is down, and says so without guessing', async () => {
    fakeFetch([{ status: 500, body: {} }]);
    await expect(gateway.verify('ses_09')).rejects.toBeInstanceOf(PaymentGatewayError);
  });
});
