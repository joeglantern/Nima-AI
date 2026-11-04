/**
 * PaySasa, for M-Pesa in Kenya.
 *
 * What the docs say, and what this file does about it:
 *
 *   - Everything is a checkout session. `POST /checkout/sessions` names one
 *     (`ses_...`) with an amount in cents, a currency and the business it is
 *     for. No money moves at that point. `POST /checkout/sessions/:id/pay`
 *     with `payment_method: "m_pesa"` and a phone pushes the STK prompt.
 *     Those are two calls, so `charge` hands the session id to the caller
 *     between them: if the pay call then times out, the payment can still be
 *     matched to its result.
 *   - The session is the truth. `GET /checkout/sessions/:id` says pending,
 *     processing, paid (the docs also say completed), failed, expired or
 *     cancelled. Nothing is marked paid until that read agrees on the amount
 *     and the currency.
 *   - Webhooks come for `checkout.paid` and `checkout.expired` only. A wrong
 *     PIN or a prompt left to time out sends nothing, so the result of every
 *     payment is read back, either because a webhook said to look or because
 *     the reconcile timer did.
 *   - Webhooks are signed: `x-paysasa-signature` is the hex HMAC SHA256 of
 *     the raw body, keyed with the webhook secret, sometimes prefixed with
 *     `sha256=`. Events carry no id, so the event name and session id are the
 *     replay key.
 *   - Money-moving calls take `X-Idempotency-Key`, keyed per business, and a
 *     replay returns the original answer.
 *   - There is no refund API. A refund is recorded here and sent by a person
 *     from the PaySasa dashboard, then marked done.
 *   - Keys look like `apk_test_xxx.secret` and `apk_live_xxx.secret`. Live
 *     keys need a verified business; until then create and pay answer 403
 *     with `business_unverified` or `owner_kyc_unverified`.
 *
 * Sources: paysasa.com/docs/quickstart, /docs/api/authentication,
 * /docs/api/checkout-sessions, /docs/api/webhooks, /docs/api/idempotency,
 * /docs/api/error-codes, /docs/api/multi-currency, /docs/api (all endpoints).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { describeFailure } from './words.js';

/** Safaricom's ceiling for one M-Pesa payment, in cents. */
const MPESA_MAX_CENTS = 250_000 * 100;
/** The smallest M-Pesa payment, in cents. */
const KES_MIN_CENTS = 1 * 100;

/** What PaySasa says about a session. Read loosely: the docs show two shapes. */
interface PaysasaSession {
  id?: string;
  reference?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  hosted_url?: string;
  expires_at?: string;
  paid_at?: string | null;
  payment_method?: string;
  receipt?: string | null;
  mpesa_receipt?: string | null;
  failure_reason?: string | null;
  last_error?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
}

interface PaysasaBody {
  session?: PaysasaSession;
  error?: string;
  code?: string;
  message?: string;
  status?: string;
  checkout_request_id?: string;
  idempotent_replay?: boolean;
  [key: string]: unknown;
}

export interface PaysasaOptions {
  apiKey: string;
  businessId: string;
  webhookSecret: string | null;
  baseUrl: string;
}

export class PaysasaGateway implements PaymentGateway {
  readonly name = 'PAYSASA' as const;
  readonly provider = 'PAYSASA' as const;
  readonly webhookPath = '/webhooks/paysasa';
  readonly signatureHeader = 'x-paysasa-signature';
  readonly webhookProvider = 'paysasa';
  readonly canRefund = false;
  readonly readsBackAmount = true;
  readonly configured = true;

  private readonly apiKey: string;
  private readonly businessId: string;
  private readonly webhookSecret: string | null;
  private readonly baseUrl: string;

  constructor(options: PaysasaOptions) {
    this.apiKey = options.apiKey;
    this.businessId = options.businessId;
    this.webhookSecret = options.webhookSecret;
    this.baseUrl = options.baseUrl;
  }

  /** True for a live key, which is the only kind that moves real money. */
  get live(): boolean {
    return this.apiKey.startsWith('apk_live_');
  }

  /** True when webhooks can be checked. Without the secret, the timer does the work. */
  get signsWebhooks(): boolean {
    return this.webhookSecret !== null && this.webhookSecret.length > 0;
  }

  /** PaySasa names the session, so there is nothing to know in advance. */
  referenceFor(): null {
    return null;
  }

  /** A session id. Anything else is a reference from some other system. */
  isOurReference(reference: string): boolean {
    return /^[A-Za-z0-9_.:-]{6,128}$/.test(reference);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const msisdn = toMsisdn(request.phone);

    if (!/^254[17]\d{8}$/.test(msisdn)) {
      return {
        providerRef: `unsent-${request.idempotencyKey}`,
        status: 'FAILED',
        failureReason: 'That does not look like a Kenyan mobile number. Check it and try again.',
      };
    }
    if (request.amountCents > MPESA_MAX_CENTS) {
      return {
        providerRef: `unsent-${request.idempotencyKey}`,
        status: 'FAILED',
        failureReason:
          'M-Pesa takes up to KSh 250,000 in one payment. Take something out and try again.',
      };
    }
    if (request.amountCents < KES_MIN_CENTS) {
      return {
        providerRef: `unsent-${request.idempotencyKey}`,
        status: 'FAILED',
        failureReason: 'M-Pesa payments start at KSh 1. Add something and try again.',
      };
    }

    // One: name the session. Nothing is asked of the phone yet, so a failure
    // here is clean and the checkout can simply be unwound.
    const created = await this.call('POST', '/checkout/sessions', {
      amount: request.amountCents,
      currency: 'KES',
      business_id: this.businessId,
      description: `${request.reference}: ${request.description}`.slice(0, 120),
      allow_methods: ['m_pesa'],
      callback_url: request.callbackUrl,
      metadata: { source: 'nima', idempotencyKey: request.idempotencyKey },
    });

    if (created.status >= 500) {
      throw new PaymentGatewayError('PaySasa did not answer clearly', true, false);
    }
    if (created.status === 401 || created.status === 403) {
      // Our key, or our business, is the problem. Not something a buyer can fix.
      throw new PaymentGatewayError(
        'Payments are not working right now. Try again shortly.',
        false,
        false,
      );
    }
    if (created.status >= 400) {
      return {
        providerRef: `unsent-${request.idempotencyKey}`,
        status: 'FAILED',
        failureReason: describeFailure(created.body.error, created.body.code),
        providerMessage: created.body.error ?? created.body.code ?? null,
      };
    }

    const session = created.body.session ?? (created.body as PaysasaSession);
    const sessionId = typeof session.id === 'string' ? session.id : null;
    if (!sessionId) {
      throw new PaymentGatewayError('PaySasa did not name the session', false, false);
    }

    // The name is known. From here on a timeout is ambiguous: the prompt may
    // already be on the phone, and this id is how the result is found.
    await request.onReference?.(sessionId);

    // Two: push the prompt.
    const paid = await this.call(
      'POST',
      `/checkout/sessions/${encodeURIComponent(sessionId)}/pay`,
      { payment_method: 'm_pesa', phone: msisdn },
      request.idempotencyKey,
    );

    if (paid.status >= 500) {
      throw new PaymentGatewayError('PaySasa did not answer clearly', true, true);
    }
    if (paid.status === 401 || paid.status === 403) {
      throw new PaymentGatewayError(
        'Payments are not working right now. Try again shortly.',
        false,
        true,
      );
    }
    // Already paid, or expired: the session read will say which.
    if (paid.status === 409) return { providerRef: sessionId, status: 'PROCESSING' };
    if (paid.status >= 400) {
      return {
        providerRef: sessionId,
        status: 'FAILED',
        failureReason: describeFailure(paid.body.error, paid.body.code, paid.body.message),
        providerMessage: paid.body.error ?? paid.body.message ?? null,
      };
    }

    const state = String(paid.body.status ?? '').toLowerCase();
    if (state === 'failed') {
      return {
        providerRef: sessionId,
        status: 'FAILED',
        failureReason: describeFailure(paid.body.error, paid.body.message),
        providerMessage: paid.body.message ?? paid.body.error ?? null,
      };
    }

    // pending, processing, sent, or nothing at all: wait, then read it back.
    return {
      providerRef: sessionId,
      status: 'PROCESSING',
      providerMessage: paid.body.checkout_request_id
        ? `checkout_request_id ${paid.body.checkout_request_id}`
        : null,
    };
  }

  async verify(reference: string): Promise<VerifiedPayment> {
    const { status, body } = await this.call(
      'GET',
      `/checkout/sessions/${encodeURIComponent(reference)}`,
    );

    if (status >= 500 || status === 401 || status === 403 || status === 429) {
      throw new PaymentGatewayError('Could not check the payment with PaySasa', true, true);
    }

    if (status === 404) {
      return {
        state: 'NOT_FOUND',
        reference,
        amountCents: null,
        currency: null,
        failureReason: null,
        providerId: null,
        raw: null,
      };
    }

    const session = body.session ?? (body as PaysasaSession);
    if (status >= 400 || typeof session.id !== 'string') {
      throw new PaymentGatewayError(`PaySasa refused the session read (${status})`, true, true);
    }

    const sessionState = String(session.status ?? '').toLowerCase();
    const state: VerifiedPayment['state'] =
      sessionState === 'paid' ||
      sessionState === 'completed' ||
      sessionState === 'succeeded' ||
      sessionState === 'success'
        ? 'SUCCEEDED'
        : sessionState === 'failed' ||
            sessionState === 'expired' ||
            sessionState === 'cancelled' ||
            sessionState === 'canceled'
          ? 'FAILED'
          : 'PENDING';

    const said = session.failure_reason ?? session.last_error ?? session.message ?? null;
    const amount = toNumber(session.amount);

    return {
      state,
      reference: session.id,
      amountCents: amount,
      currency: session.currency ?? null,
      failureReason:
        state === 'FAILED'
          ? sessionState === 'expired'
            ? 'The M-Pesa prompt expired before it was paid. Try again and keep your phone close.'
            : sessionState === 'cancelled' || sessionState === 'canceled'
              ? 'The M-Pesa payment was cancelled. Try again when you are ready.'
              : describeFailure(said)
          : null,
      providerId: session.id,
      raw: {
        id: session.id,
        paysasaReference: session.reference ?? null,
        status: session.status ?? null,
        amount,
        currency: session.currency ?? null,
        paymentMethod: session.payment_method ?? null,
        receipt: session.mpesa_receipt ?? session.receipt ?? null,
        paidAt: session.paid_at ?? null,
        expiresAt: session.expires_at ?? null,
        hostedUrl: session.hosted_url ?? null,
        said,
      },
    };
  }

  /** PaySasa has no refund API. The refund is recorded and sent by hand. */
  async refund(): Promise<RefundResult> {
    throw new PaymentGatewayError(
      'PaySasa has no refund API. Send it from the PaySasa dashboard.',
      false,
    );
  }

  async fetchRefund(): Promise<{ state: RefundState; amountCents: number | null }> {
    throw new PaymentGatewayError('PaySasa has no refund API', false);
  }

  async listRefunds(): Promise<Array<{ providerRef: string; amountCents: number | null }>> {
    return [];
  }

  verifySignature(rawBody: string | Buffer, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature) return false;

    const given = signature.trim().replace(/^sha256=/i, '');
    if (!/^[0-9a-f]+$/i.test(given)) return false;

    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest();
    const bytes = Buffer.from(given, 'hex');

    // Same length first, then a constant time compare over the bytes.
    if (bytes.length !== expected.length) return false;
    return timingSafeEqual(bytes, expected);
  }

  parseWebhook(payload: unknown): WebhookNotice | null {
    if (typeof payload !== 'object' || payload === null) return null;

    const body = payload as { event?: unknown; data?: Record<string, unknown> };
    const event = typeof body.event === 'string' ? body.event : null;
    const data = body.data ?? {};
    if (!event) return null;

    if (event === 'checkout.paid' || event === 'checkout.expired') {
      const sessionId =
        typeof data.session_id === 'string'
          ? data.session_id
          : typeof data.id === 'string'
            ? data.id
            : null;
      if (!sessionId) return null;
      // No event id from PaySasa, so the event name and the session are the
      // replay key: a session is paid once and expires once.
      return { kind: 'charge', event, reference: sessionId, externalId: `${event}:${sessionId}` };
    }

    return { kind: 'other', event, reference: null, externalId: null };
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<{ status: number; body: PaysasaBody }> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        // Ten seconds. A buyer is watching a spinner, and verify is retried.
        signal: AbortSignal.timeout(10_000),
        headers: {
          'x-api-key': this.apiKey,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      // We cannot tell whether PaySasa acted. The caller decides whether
      // that matters: it does not before the session is named.
      throw new PaymentGatewayError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'PaySasa did not answer in time'
          : 'Could not reach PaySasa',
        true,
        true,
      );
    }

    const parsed = (await response.json().catch(() => ({}))) as PaysasaBody;
    return { status: response.status, body: parsed };
  }
}

function toNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}
