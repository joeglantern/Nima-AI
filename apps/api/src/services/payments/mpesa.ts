/**
 * M-Pesa, straight from Safaricom (the Daraja API), paid to Nima's own Till.
 *
 * What the docs say, and what this file does about it:
 *
 *   - Every call carries an OAuth token from `/oauth/v1/generate`, good for
 *     an hour. Asking for a new one invalidates the last, so one is kept and
 *     reused until a minute before it expires.
 *   - A payment is an STK push: `POST /mpesa/stkpush/v1/processrequest` with
 *     the Till as PartyB and `CustomerBuyGoodsOnline` as the type (PayBill
 *     when there is no Till). Amounts are whole shillings. The answer is a
 *     `CheckoutRequestID`: the prompt is on the phone, nothing is paid yet.
 *   - The result comes to the callback URL once, unsigned, from Safaricom's
 *     published addresses. It cannot be trusted on its own, so the callback
 *     URL carries a secret token and the callback is only a prompt to look.
 *   - The truth is `POST /mpesa/stkpushquery/v1/query`: ResultCode 0 is paid,
 *     4999 ("still under processing") means wait, so does HTTP 500 with
 *     errorCode 500.001.1001, and anything else is a reason. The query does
 *     not say the amount. It does not need to: a CheckoutRequestID is bound
 *     to the amount it was pushed with, and M-Pesa takes exactly that.
 *   - The query is rate limited: 30 a minute, bursts of 3, then HTTP 429
 *     "Spike arrest violation". Queries are spaced here so a busy evening
 *     never trips it, and a 429 is simply "ask again on the next pass".
 *   - There is no idempotency key. A push that times out may still have
 *     reached the phone, and its id is unknown, so the checkout is unwound
 *     and the buyer is told not to enter a PIN. Money that lands anyway
 *     arrives on the callback under an unknown id and is logged for a refund.
 *   - Reversals need an initiator and a security credential that this file
 *     does not have yet, so a refund is recorded and sent by a person from
 *     the M-Pesa business portal.
 *
 * Sources: developer.safaricom.co.ke, APIs: Authorization, M-Pesa Express
 * (Simulate and Query), their result codes and FAQ.
 */

import { timingSafeEqual } from 'node:crypto';
import {
  type ChargeRequest,
  type ChargeResult,
  type PaymentGateway,
  PaymentGatewayError,
  type RefundResult,
  type RefundState,
  toMsisdn,
  type VerifiedPayment,
  type WebhookNotice,
} from './index.js';
import { describeFailure, maskPhone } from './words.js';

/** Safaricom's ceiling for one M-Pesa payment, in cents. */
const MPESA_MAX_CENTS = 250_000 * 100;
/** The smallest M-Pesa payment, in cents. */
const KES_MIN_CENTS = 1 * 100;
/** What a sandbox push asks for, in shillings, whatever the order is worth. */
const SANDBOX_SHILLINGS = 1;
/** Callback details are kept this long for the query that follows. */
const REMEMBER_MS = 60 * 60_000;
/** Safaricom allows 30 queries a minute. Stay under it with room for retries. */
const QUERIES_PER_MINUTE = 24;

export interface MpesaOptions {
  consumerKey: string;
  consumerSecret: string;
  /** The shortcode the app went live with: the Till's store number, or a PayBill. */
  shortcode: string;
  /** The Till number buyers see. Null means PayBill, and the shortcode is the PayBill. */
  till: string | null;
  passkey: string;
  /** The secret that makes a callback URL ours. */
  callbackToken: string;
  baseUrl: string;
  /** True against api.safaricom.co.ke, where real money moves. */
  live: boolean;
}

interface DarajaBody {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string | number;
  ResponseDescription?: string;
  CustomerMessage?: string;
  ResultCode?: string | number;
  ResultDesc?: string;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
  access_token?: string;
  expires_in?: string | number;
}

interface CallbackDetails {
  amountCents: number | null;
  receipt: string | null;
  transactionDate: string | null;
  phone: string | null;
  resultCode: string;
  resultDesc: string | null;
  at: number;
}

/** What each M-Pesa result code means to a buyer. */
function wordsFor(code: string, said: string | null): string {
  switch (code) {
    case '1032':
      return 'The M-Pesa prompt was cancelled. Try again when you are ready.';
    case '1037':
      return 'Your phone could not be reached for the M-Pesa prompt. Check it is on and not in another session, then try again.';
    case '1019':
      return 'The M-Pesa prompt expired before a PIN was entered. Try again and keep your phone close.';
    case '2001':
      return 'The M-Pesa PIN was not accepted. Try again and enter your PIN carefully.';
    case '1':
      return 'There was not enough in that M-Pesa account. Top up or use another number, then try again.';
    case '17':
      return 'M-Pesa does not take the same amount from the same number twice within two minutes. Wait two minutes, then try again.';
    case '1001':
      return 'Your phone is still busy with another M-Pesa request. Finish it or wait a minute, then try again.';
    case '2':
    case '3':
    case '4':
    case '8':
      return 'M-Pesa declined this payment. Check your M-Pesa limits or use another number, then try again.';
    default:
      return describeFailure(said);
  }
}

export class MpesaGateway implements PaymentGateway {
  readonly name = 'MPESA' as const;
  readonly provider = 'MPESA' as const;
  readonly webhookPath = '/webhooks/till/:token';
  /** There is no signature header. The token in the path plays its part. */
  readonly signatureHeader = 'path token';
  readonly webhookProvider = 'mpesa';
  readonly canRefund = false;
  readonly readsBackAmount = false;
  readonly configured = true;

  private readonly options: MpesaOptions;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;
  private readonly callbacks = new Map<string, CallbackDetails>();
  private queryTimes: number[] = [];

  constructor(options: MpesaOptions) {
    this.options = { ...options, baseUrl: options.baseUrl.replace(/\/+$/, '') };
  }

  get live(): boolean {
    return this.options.live;
  }

  /** The exact URL Safaricom must be given, token and all. */
  callbackUrl(apiUrl: string): string {
    return `${apiUrl.replace(/\/+$/, '')}/webhooks/till/${encodeURIComponent(this.options.callbackToken)}`;
  }

  /** Safaricom names the request, and only once it has answered. */
  referenceFor(): null {
    return null;
  }

  isOurReference(reference: string): boolean {
    return /^ws_CO_[A-Za-z0-9_-]{4,}$/.test(reference);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const msisdn = toMsisdn(request.phone);
    const unsent = `unsent-${request.idempotencyKey}`;

    if (!/^254[17]\d{8}$/.test(msisdn)) {
      return {
        providerRef: unsent,
        status: 'FAILED',
        failureReason: 'That does not look like a Kenyan mobile number. Check it and try again.',
      };
    }
    if (request.amountCents > MPESA_MAX_CENTS) {
      return {
        providerRef: unsent,
        status: 'FAILED',
        failureReason:
          'M-Pesa takes up to KSh 250,000 in one payment. Take something out and try again.',
      };
    }
    if (request.amountCents < KES_MIN_CENTS) {
      return {
        providerRef: unsent,
        status: 'FAILED',
        failureReason: 'M-Pesa payments start at KSh 1. Add something and try again.',
      };
    }
    if (request.amountCents % 100 !== 0) {
      // Prices on Nima are whole shillings. If one ever is not, nobody should
      // be charged a rounded number quietly.
      return {
        providerRef: unsent,
        status: 'FAILED',
        failureReason: 'M-Pesa takes whole shillings only. Tell the shop about this total.',
        providerMessage: `amount ${request.amountCents} cents is not whole shillings`,
      };
    }

    const timestamp = nairobiTimestamp();
    const { status, body } = await this.call('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: this.options.shortcode,
      Password: this.password(timestamp),
      Timestamp: timestamp,
      TransactionType: this.options.till ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      // The sandbox is a real paybill and a real prompt: the PIN moves real
      // money. So until production, the push asks for one shilling whatever
      // the basket says. The payment row keeps the true total for the order.
      Amount: this.live ? request.amountCents / 100 : SANDBOX_SHILLINGS,
      PartyA: msisdn,
      PartyB: this.options.till ?? this.options.shortcode,
      PhoneNumber: msisdn,
      CallBackURL: this.callbackUrl(request.callbackUrl.replace(/\/webhooks\/.*$/, '')),
      AccountReference: request.reference.slice(0, 12),
      TransactionDesc: request.description.slice(0, 13),
    });

    // The subscriber is mid-session: the push was not sent. A clear no.
    if (body.errorCode === '500.001.1001' || /lock subscriber/i.test(body.errorMessage ?? '')) {
      return {
        providerRef: unsent,
        status: 'FAILED',
        failureReason: wordsFor('1001', body.errorMessage ?? null),
        providerMessage: body.errorMessage ?? null,
      };
    }

    if (status >= 500) {
      throw new PaymentGatewayError('M-Pesa is not answering right now. Try again shortly.', true);
    }
    if (status === 401 || status === 403) {
      throw new PaymentGatewayError(
        'Payments are not working right now. Try again shortly.',
        false,
      );
    }
    if (status >= 400) {
      return {
        providerRef: unsent,
        status: 'FAILED',
        failureReason: describeFailure(body.errorMessage, body.errorCode),
        providerMessage: body.errorMessage ?? body.errorCode ?? null,
      };
    }

    const checkoutRequestId = body.CheckoutRequestID;
    if (String(body.ResponseCode ?? '') !== '0' || !checkoutRequestId) {
      return {
        providerRef: unsent,
        status: 'FAILED',
        failureReason: describeFailure(body.ResponseDescription, body.CustomerMessage),
        providerMessage: body.ResponseDescription ?? null,
      };
    }

    return {
      providerRef: checkoutRequestId,
      status: 'PROCESSING',
      providerMessage: body.CustomerMessage ?? body.ResponseDescription ?? null,
    };
  }

  async verify(reference: string): Promise<VerifiedPayment> {
    // Stay under Safaricom's rate. A payment skipped now is asked about on
    // the next pass, a few seconds later.
    const now = Date.now();
    this.queryTimes = this.queryTimes.filter((at) => at > now - 60_000);
    if (this.queryTimes.length >= QUERIES_PER_MINUTE) {
      throw new PaymentGatewayError('M-Pesa queries are being spaced out', true, true);
    }
    this.queryTimes.push(now);

    const timestamp = nairobiTimestamp();
    const { status, body } = await this.call('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: this.options.shortcode,
      Password: this.password(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: reference,
    });

    const said = body.errorMessage ?? '';
    const remembered = this.callbacks.get(reference) ?? null;
    const empty = {
      reference,
      amountCents: null,
      currency: null,
      failureReason: null,
      providerId: null,
      raw: null,
    };

    if (status !== 200) {
      if (body.errorCode === '500.001.1001' || /being processed/i.test(said)) {
        return { ...empty, state: 'PENDING' };
      }
      if (/invalid checkoutrequestid|not found|does not exist/i.test(said)) {
        return { ...empty, state: 'NOT_FOUND' };
      }
      throw new PaymentGatewayError(
        `Could not check the payment with M-Pesa (${status}${body.errorCode ? ` ${body.errorCode}` : ''}${status === 429 ? ', rate limited' : ''})`,
        true,
        true,
      );
    }

    const code = String(body.ResultCode ?? '');
    const stillOpen =
      code === '4999' || /still under processing|being processed/i.test(body.ResultDesc ?? '');
    const state: VerifiedPayment['state'] =
      code === '0' ? 'SUCCEEDED' : stillOpen || !code ? 'PENDING' : 'FAILED';

    return {
      state,
      reference: body.CheckoutRequestID ?? reference,
      // The query does not say the amount. The callback did, when it came,
      // and the push is bound to the amount it asked for either way.
      // Off production the push asked for one shilling, so the callback's
      // amount says nothing about the order and must not be compared to it.
      amountCents: this.live ? (remembered?.amountCents ?? null) : null,
      currency: this.live && remembered?.amountCents != null ? 'KES' : null,
      failureReason: state === 'FAILED' ? wordsFor(code, body.ResultDesc ?? null) : null,
      providerId: remembered?.receipt ?? null,
      raw: {
        checkoutRequestId: body.CheckoutRequestID ?? reference,
        merchantRequestId: body.MerchantRequestID ?? null,
        resultCode: code || null,
        resultDesc: body.ResultDesc ?? null,
        receipt: remembered?.receipt ?? null,
        amount: remembered?.amountCents != null ? remembered.amountCents / 100 : null,
        transactionDate: remembered?.transactionDate ?? null,
        phone: remembered?.phone ?? null,
      },
    };
  }

  /** No reversal API is wired yet. The refund is recorded and sent by hand. */
  async refund(): Promise<RefundResult> {
    throw new PaymentGatewayError(
      'M-Pesa reversals are not wired yet. Send it from the M-Pesa business portal.',
      false,
    );
  }

  async fetchRefund(): Promise<{ state: RefundState; amountCents: number | null }> {
    throw new PaymentGatewayError('M-Pesa reversals are not wired yet', false);
  }

  async listRefunds(): Promise<Array<{ providerRef: string; amountCents: number | null }>> {
    return [];
  }

  /** The "signature" is the token in the callback path. Constant time. */
  verifySignature(_rawBody: string | Buffer, token: string | undefined): boolean {
    if (!token) return false;
    const given = Buffer.from(token, 'utf8');
    const expected = Buffer.from(this.options.callbackToken, 'utf8');
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  }

  parseWebhook(payload: unknown): WebhookNotice | null {
    if (typeof payload !== 'object' || payload === null) return null;

    const body = payload as { Body?: { stkCallback?: Record<string, unknown> } };
    const callback = body.Body?.stkCallback;
    if (!callback) return { kind: 'other', event: 'unknown', reference: null, externalId: null };

    const reference =
      typeof callback.CheckoutRequestID === 'string' ? callback.CheckoutRequestID : null;
    if (!reference) return null;

    const resultCode = String(callback.ResultCode ?? '');
    const items = Array.isArray((callback.CallbackMetadata as { Item?: unknown[] })?.Item)
      ? ((callback.CallbackMetadata as { Item: Array<{ Name?: string; Value?: unknown }> }).Item ??
        [])
      : [];
    const item = (name: string) => items.find((entry) => entry.Name === name)?.Value;
    const amount = item('Amount');

    this.remember(reference, {
      amountCents: typeof amount === 'number' ? Math.round(amount * 100) : null,
      receipt:
        typeof item('MpesaReceiptNumber') === 'string' ? String(item('MpesaReceiptNumber')) : null,
      transactionDate: item('TransactionDate') != null ? String(item('TransactionDate')) : null,
      phone: item('PhoneNumber') != null ? maskPhone(String(item('PhoneNumber'))) : null,
      resultCode,
      resultDesc: typeof callback.ResultDesc === 'string' ? callback.ResultDesc : null,
      at: Date.now(),
    });

    // Safaricom sends no event id. A request ends once, with one code.
    return {
      kind: 'charge',
      event: `stk.${resultCode || 'unknown'}`,
      reference,
      externalId: `${reference}:${resultCode || 'unknown'}`,
    };
  }

  private remember(reference: string, details: CallbackDetails): void {
    const cutoff = Date.now() - REMEMBER_MS;
    for (const [key, entry] of this.callbacks) {
      if (entry.at < cutoff) this.callbacks.delete(key);
    }
    this.callbacks.set(reference, details);
  }

  private password(timestamp: string): string {
    return Buffer.from(
      `${this.options.shortcode}${this.options.passkey}${timestamp}`,
      'utf8',
    ).toString('base64');
  }

  /** One token at a time, reused until a minute before it expires. */
  private async accessToken(fresh = false): Promise<string> {
    if (!fresh && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!fresh && this.tokenRequest) return this.tokenRequest;

    const basic = Buffer.from(
      `${this.options.consumerKey}:${this.options.consumerSecret}`,
      'utf8',
    ).toString('base64');

    this.tokenRequest = (async () => {
      let response: Response;
      try {
        response = await fetch(
          `${this.options.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
          {
            method: 'GET',
            signal: AbortSignal.timeout(10_000),
            headers: { authorization: `Basic ${basic}`, accept: 'application/json' },
          },
        );
      } catch {
        throw new PaymentGatewayError('Could not reach M-Pesa', true);
      }
      const body = (await response.json().catch(() => ({}))) as DarajaBody;
      if (!response.ok || !body.access_token) {
        throw new PaymentGatewayError(
          response.status === 400 || response.status === 401
            ? 'Payments are not working right now. Try again shortly.'
            : 'M-Pesa is not answering right now. Try again shortly.',
          response.status >= 500,
        );
      }
      const seconds = Number(body.expires_in ?? 3599);
      this.token = {
        value: body.access_token,
        expiresAt:
          Date.now() + Math.max(60, (Number.isFinite(seconds) ? seconds : 3599) - 60) * 1000,
      };
      return body.access_token;
    })().finally(() => {
      this.tokenRequest = null;
    });

    return this.tokenRequest;
  }

  private async call(
    path: string,
    body: Record<string, unknown>,
    retried = false,
  ): Promise<{ status: number; body: DarajaBody }> {
    const token = await this.accessToken(retried);
    let response: Response;

    try {
      response = await fetch(`${this.options.baseUrl}${path}`, {
        method: 'POST',
        // Ten seconds. A buyer is watching a spinner, and the query is retried.
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      // The prompt may or may not have gone out, and its id is unknown.
      throw new PaymentGatewayError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'M-Pesa did not answer in time. If a prompt reached your phone, do not enter your PIN. Start again.'
          : 'Could not reach M-Pesa. Try again shortly.',
        true,
        true,
      );
    }

    // A token Safaricom no longer honours: one fresh token, one more try.
    if (response.status === 401 && !retried) return this.call(path, body, true);

    const parsed = (await response.json().catch(() => ({}))) as DarajaBody;
    return { status: response.status, body: parsed };
  }
}

/** YYYYMMDDHHmmss in Nairobi time, which has no daylight saving. */
export function nairobiTimestamp(now = new Date()): string {
  const shifted = new Date(now.getTime() + 3 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}` +
    `${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}${pad(shifted.getUTCSeconds())}`
  );
}
