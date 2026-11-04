/**
 * The M-Pesa pieces that need no database: the callback token, the push
 * request, what a query means, and what is kept from a callback.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentGatewayError } from '../src/services/payments/index.js';
import { MpesaGateway, nairobiTimestamp } from '../src/services/payments/mpesa.js';
import { redactPayload } from '../src/services/payments/words.js';

const TOKEN = 'cb_unit_token_0123456789';
const make = () =>
  new MpesaGateway({
    consumerKey: 'ck_unit',
    consumerSecret: 'cs_unit',
    shortcode: '174379',
    till: '5555555',
    passkey: 'passkey_unit',
    callbackToken: TOKEN,
    baseUrl: 'http://127.0.0.1:1/',
    live: false,
  });

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

const token = { status: 200, body: { access_token: 'tok_1', expires_in: '3599' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setup', () => {
  it('is not live against the sandbox, has no refund API and no reference of its own', () => {
    const gateway = make();
    expect(gateway.live).toBe(false);
    expect(gateway.canRefund).toBe(false);
    expect(gateway.readsBackAmount).toBe(false);
    expect(gateway.referenceFor()).toBeNull();
  });

  it('builds the callback URL Safaricom must be given', () => {
    expect(make().callbackUrl('https://api.example/')).toBe(
      `https://api.example/webhooks/till/${TOKEN}`,
    );
  });

  it('writes the timestamp in Nairobi time', () => {
    expect(nairobiTimestamp(new Date('2026-11-04T21:05:09Z'))).toBe('20261105000509');
  });
});

describe('callback token', () => {
  it('accepts the exact token and nothing else', () => {
    const gateway = make();
    expect(gateway.verifySignature('{}', TOKEN)).toBe(true);
    expect(gateway.verifySignature('{}', undefined)).toBe(false);
    expect(gateway.verifySignature('{}', '')).toBe(false);
    expect(gateway.verifySignature('{}', `${TOKEN}x`)).toBe(false);
    expect(gateway.verifySignature('{}', TOKEN.slice(0, -1))).toBe(false);
    expect(gateway.verifySignature('{}', TOKEN.toUpperCase())).toBe(false);
  });
});

describe('callback parsing', () => {
  const paid = {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: 'ws_CO_191220191020363925',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 1500 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'TransactionDate', Value: 20191219102115 },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
      },
    },
  };

  it('reads a result as a prompt to query, keyed by request and code', () => {
    expect(make().parseWebhook(paid)).toEqual({
      kind: 'charge',
      event: 'stk.0',
      reference: 'ws_CO_191220191020363925',
      externalId: 'ws_CO_191220191020363925:0',
    });
  });

  it('reads a cancelled result the same way', () => {
    const notice = make().parseWebhook({
      Body: {
        stkCallback: {
          CheckoutRequestID: 'ws_CO_1',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    });
    expect(notice?.event).toBe('stk.1032');
    expect(notice?.externalId).toBe('ws_CO_1:1032');
  });

  it('ignores bodies that are not an STK callback', () => {
    expect(make().parseWebhook({ Body: {} })?.kind).toBe('other');
    expect(make().parseWebhook({ Body: { stkCallback: { ResultCode: 0 } } })).toBeNull();
    expect(make().parseWebhook('nope')).toBeNull();
  });

  it('masks the numeric phone number before the payload is stored', () => {
    const kept = redactPayload(paid) as typeof paid;
    const items = kept.Body.stkCallback.CallbackMetadata.Item;
    expect(String(items.find((i) => i.Name === 'PhoneNumber')?.Value)).toBe('2547******78');
    expect(items.find((i) => i.Name === 'Amount')?.Value).toBe(1500);
  });

  it('carries the callback amount and receipt into the next query', async () => {
    const gateway = make();
    gateway.parseWebhook(paid);
    fakeFetch([
      token,
      {
        status: 200,
        body: {
          ResponseCode: '0',
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_191220191020363925',
          ResultCode: '0',
          ResultDesc: 'The service request is processed successfully.',
        },
      },
    ]);
    const verified = await gateway.verify('ws_CO_191220191020363925');
    expect(verified.state).toBe('SUCCEEDED');
    expect(verified.amountCents).toBe(150000);
    expect(verified.currency).toBe('KES');
    expect(verified.providerId).toBe('NLJ7RT61SV');
    expect(verified.raw).toMatchObject({ receipt: 'NLJ7RT61SV', phone: '2547******78' });
    expect(JSON.stringify(verified.raw)).not.toContain('12345678');
  });
});

describe('charge', () => {
  const request = {
    amountCents: 150000,
    phone: '0712 345 678',
    reference: 'NIMA ABC123',
    description: 'Nima Checkout',
    idempotencyKey: 'key-1',
    callbackUrl: 'https://api.example/webhooks/mpesa',
  };

  it('signs in once, then pushes the prompt to the Till', async () => {
    const calls = fakeFetch([
      token,
      {
        status: 200,
        body: {
          MerchantRequestID: '1',
          CheckoutRequestID: 'ws_CO_1',
          ResponseCode: '0',
          ResponseDescription: 'Success. Request accepted for processing',
          CustomerMessage: 'Success. Request accepted for processing',
        },
      },
      { status: 200, body: { ResponseCode: '0', CheckoutRequestID: 'ws_CO_2' } },
    ]);
    const gateway = make();
    const result = await gateway.charge(request);

    expect(result).toEqual({
      providerRef: 'ws_CO_1',
      status: 'PROCESSING',
      providerMessage: 'Success. Request accepted for processing',
    });

    const [auth, push] = calls;
    expect(auth?.url).toBe('http://127.0.0.1:1/oauth/v1/generate?grant_type=client_credentials');
    expect((auth?.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('ck_unit:cs_unit').toString('base64')}`,
    );
    expect(push?.url).toBe('http://127.0.0.1:1/mpesa/stkpush/v1/processrequest');
    expect((push?.init.headers as Record<string, string>).authorization).toBe('Bearer tok_1');
    const body = JSON.parse(String(push?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      BusinessShortCode: '174379',
      TransactionType: 'CustomerBuyGoodsOnline',
      Amount: 1500,
      PartyA: '254712345678',
      PartyB: '5555555',
      PhoneNumber: '254712345678',
      CallBackURL: `https://api.example/webhooks/till/${TOKEN}`,
      AccountReference: 'NIMA ABC123',
      TransactionDesc: 'Nima Checkout',
    });
    expect(String(body.Timestamp)).toMatch(/^\d{14}$/);
    expect(Buffer.from(String(body.Password), 'base64').toString('utf8')).toBe(
      `174379passkey_unit${body.Timestamp}`,
    );

    // The token is reused on the next call: three calls, one sign in.
    const again = await gateway.charge({ ...request, idempotencyKey: 'key-2' });
    expect(again.providerRef).toBe('ws_CO_2');
    expect(calls).toHaveLength(3);
  });

  it('uses PayBill when there is no Till', async () => {
    const calls = fakeFetch([
      token,
      { status: 200, body: { ResponseCode: '0', CheckoutRequestID: 'ws_CO_3' } },
    ]);
    const paybill = new MpesaGateway({
      consumerKey: 'k',
      consumerSecret: 's',
      shortcode: '600000',
      till: null,
      passkey: 'p',
      callbackToken: TOKEN,
      baseUrl: 'http://127.0.0.1:1',
      live: true,
    });
    expect(paybill.live).toBe(true);
    await paybill.charge(request);
    const body = JSON.parse(String(calls[1]?.init.body)) as Record<string, unknown>;
    expect(body.TransactionType).toBe('CustomerPayBillOnline');
    expect(body.PartyB).toBe('600000');
  });

  it('refuses a bad number, amount or a total that is not whole shillings before calling anyone', async () => {
    const calls = fakeFetch([]);
    const gateway = make();
    expect((await gateway.charge({ ...request, phone: '12345' })).status).toBe('FAILED');
    expect(
      (await gateway.charge({ ...request, amountCents: 250_001 * 100 })).failureReason,
    ).toContain('250,000');
    expect((await gateway.charge({ ...request, amountCents: 50 })).status).toBe('FAILED');
    expect((await gateway.charge({ ...request, amountCents: 150050 })).failureReason).toContain(
      'whole shillings',
    );
    expect(calls).toHaveLength(0);
  });

  it('a busy phone is a clear no, not an error', async () => {
    fakeFetch([
      token,
      {
        status: 500,
        body: {
          requestId: 'r',
          errorCode: '500.001.1001',
          errorMessage:
            'Unable to lock subscriber, a transaction is already in process for the current subscriber',
        },
      },
    ]);
    const result = await make().charge(request);
    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toContain('still busy');
  });

  it('a bad request is a clear no in plain words', async () => {
    fakeFetch([
      token,
      {
        status: 400,
        body: { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PhoneNumber' },
      },
    ]);
    const result = await make().charge(request);
    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toContain('number');
  });

  it('an expired token is renewed once and the call retried', async () => {
    const calls = fakeFetch([
      token,
      { status: 401, body: { errorCode: '404.001.03', errorMessage: 'Invalid Access Token' } },
      { status: 200, body: { access_token: 'tok_2', expires_in: 3599 } },
      { status: 200, body: { ResponseCode: '0', CheckoutRequestID: 'ws_CO_4' } },
    ]);
    const result = await make().charge(request);
    expect(result.providerRef).toBe('ws_CO_4');
    expect((calls[3]?.init.headers as Record<string, string>).authorization).toBe('Bearer tok_2');
  });

  it('a timeout is ambiguous and tells the buyer not to enter a PIN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('/oauth/')) {
          return new Response(JSON.stringify(token.body), { status: 200 });
        }
        const error = new Error('aborted');
        error.name = 'TimeoutError';
        throw error;
      }),
    );
    const error = await make()
      .charge(request)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect((error as PaymentGatewayError).ambiguous).toBe(true);
    expect((error as PaymentGatewayError).message).toContain('do not enter your PIN');
  });
});

describe('verify', () => {
  it.each([
    ['0', 'SUCCEEDED', null],
    ['1032', 'FAILED', 'cancelled'],
    ['1037', 'FAILED', 'could not be reached'],
    ['1019', 'FAILED', 'expired'],
    ['2001', 'FAILED', 'PIN'],
    ['1', 'FAILED', 'not enough'],
    ['17', 'FAILED', 'two minutes'],
    ['9999', 'FAILED', 'try again'],
  ])('ResultCode %s reads as %s', async (code, expected, words) => {
    fakeFetch([
      token,
      {
        status: 200,
        body: {
          ResponseCode: '0',
          CheckoutRequestID: 'ws_CO_9',
          ResultCode: code,
          ResultDesc: 'whatever Safaricom says',
        },
      },
    ]);
    const verified = await make().verify('ws_CO_9');
    expect(verified.state).toBe(expected);
    expect(verified.reference).toBe('ws_CO_9');
    expect(verified.amountCents).toBeNull();
    if (words) expect(verified.failureReason?.toLowerCase()).toContain(words.toLowerCase());
    else expect(verified.failureReason).toBeNull();
  });

  it('still being processed is PENDING, not an error', async () => {
    fakeFetch([
      token,
      {
        status: 500,
        body: { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' },
      },
    ]);
    expect((await make().verify('ws_CO_9')).state).toBe('PENDING');
  });

  it('a request Safaricom does not know is NOT_FOUND', async () => {
    fakeFetch([
      token,
      {
        status: 400,
        body: { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid CheckoutRequestID' },
      },
    ]);
    expect((await make().verify('ws_CO_nope')).state).toBe('NOT_FOUND');
  });

  it('cannot be read when Safaricom is down, and says so without guessing', async () => {
    fakeFetch([token, { status: 503, body: {} }]);
    await expect(make().verify('ws_CO_9')).rejects.toBeInstanceOf(PaymentGatewayError);
  });
});
