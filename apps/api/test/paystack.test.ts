/**
 * The Paystack pieces that need no database: signatures, references, the
 * failure messages buyers see, and what is kept from a webhook.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  describeFailure,
  maskPhone,
  PaystackGateway,
  redactPayload,
} from '../src/services/payments/paystack.js';

const SECRET = 'sk_test_unit_secret';
const gateway = new PaystackGateway(SECRET, 'http://127.0.0.1:1');
const sign = (body: string | Buffer) => createHmac('sha512', SECRET).update(body).digest('hex');

describe('webhook signature', () => {
  const body = '{"event":"charge.success","data":{"reference":"nima-abc","amount":150000}}';

  it('accepts the HMAC SHA512 of the exact bytes', () => {
    expect(gateway.verifySignature(Buffer.from(body), sign(body))).toBe(true);
    expect(gateway.verifySignature(body, sign(body).toUpperCase())).toBe(true);
  });

  it('refuses a body changed by one byte', () => {
    const changed = body.replace('150000', '150001');
    expect(gateway.verifySignature(changed, sign(body))).toBe(false);
  });

  it('refuses re-serialised JSON, which is why the raw bytes are kept', () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(gateway.verifySignature(pretty, sign(body))).toBe(false);
  });

  it('refuses a missing, short, non hex or wrongly keyed signature', () => {
    expect(gateway.verifySignature(body, undefined)).toBe(false);
    expect(gateway.verifySignature(body, '')).toBe(false);
    expect(gateway.verifySignature(body, 'deadbeef')).toBe(false);
    expect(gateway.verifySignature(body, `${sign(body).slice(0, -1)}z`)).toBe(false);
    const wrongKey = createHmac('sha512', 'sk_test_other').update(body).digest('hex');
    expect(gateway.verifySignature(body, wrongKey)).toBe(false);
    const sha256 = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(gateway.verifySignature(body, sha256)).toBe(false);
  });
});

describe('references', () => {
  it('derives the same reference from the same idempotency key', () => {
    const key = 'a3f1c2d4e5f60718293a4b5c6d7e8f90';
    expect(gateway.referenceFor(key)).toBe(gateway.referenceFor(key));
    expect(gateway.referenceFor(key)).toBe(`nima-${key}`);
  });

  it('only uses characters Paystack allows', () => {
    expect(gateway.referenceFor('ab_cd ef/gh=1.2-3')).toMatch(/^[A-Za-z0-9.=-]+$/);
  });

  it('knows its own references', () => {
    expect(gateway.isOurReference('nima-abc')).toBe(true);
    expect(gateway.isOurReference('T1234567')).toBe(false);
  });
});

describe('webhook parsing', () => {
  it('reads a charge.success as a prompt to verify', () => {
    expect(
      gateway.parseWebhook({ event: 'charge.success', data: { id: 99, reference: 'nima-x' } }),
    ).toEqual({
      kind: 'charge',
      event: 'charge.success',
      reference: 'nima-x',
      externalId: 'charge.success:99',
    });
  });

  it('reads refund events by transaction reference', () => {
    const notice = gateway.parseWebhook({
      event: 'refund.processed',
      data: { status: 'processed', transaction_reference: 'nima-x', amount: '10000' },
    });
    expect(notice?.kind).toBe('refund');
    expect(notice?.reference).toBe('nima-x');
  });

  it('ignores events it does not act on', () => {
    expect(gateway.parseWebhook({ event: 'transfer.success', data: {} })?.kind).toBe('other');
    expect(gateway.parseWebhook({ data: {} })).toBeNull();
  });
});

describe('failure messages', () => {
  it.each([
    ['insufficient_funds', 'not enough'],
    ['Insufficient balance', 'not enough'],
    ['invalid_pin', 'PIN was not accepted'],
    ['transaction_timeout', 'timed out'],
    ['abandoned', 'timed out'],
    ['customer_cancellation', 'cancelled'],
    ['Request cancelled by user', 'cancelled'],
    ['Transaction declined', 'declined'],
    ['something new', 'did not go through'],
  ])('%s', (said, expected) => {
    const message = describeFailure(said);
    expect(message).toContain(expected);
    // The house voice: no apology, no exclamation, no dash, a next step.
    expect(message).not.toMatch(/sorry|apolog|!|—/i);
    expect(message).toMatch(/try again|top up|use another/i);
  });
});

describe('privacy', () => {
  it('masks phone numbers in logs and stored payloads', () => {
    expect(maskPhone('254712345678')).toBe('2547******78');
    const kept = redactPayload({
      data: {
        customer: { phone: '+254712345678' },
        authorization: { authorization_code: 'AUTH_x', mobile_money_number: '0712345678' },
        amount: 150000,
      },
    }) as {
      data: { customer: { phone: string }; authorization: Record<string, unknown>; amount: number };
    };
    expect(kept.data.customer.phone).not.toContain('12345');
    expect(kept.data.authorization.authorization_code).toBeUndefined();
    expect(String(kept.data.authorization.mobile_money_number)).not.toContain('12345');
    expect(kept.data.amount).toBe(150000);
  });
});
