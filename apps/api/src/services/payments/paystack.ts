/**
 * Paystack, for M-Pesa in Kenya.
 *
 * What the docs say, and what this file does about it:
 *
 *   - A charge is a POST to /charge with `mobile_money: { phone, provider:
 *     'mpesa' }`. The answer is `pay_offline`: the STK prompt is on the phone
 *     and the buyer has 180 seconds to enter a PIN. Nothing is paid yet.
 *   - Paystack only sends a webhook for a successful charge. A wrong PIN, no
 *     funds or a prompt left to time out produce no webhook at all, so the
 *     result of every payment is read with Transaction Verify, either because
 *     the webhook told us to look or because the reconcile timer did.
 *   - Webhooks are signed: `x-paystack-signature` is the hex HMAC SHA512 of
 *     the raw body, keyed with the secret key.
 *   - Amounts are in the currency's subunit. KES has cents, so Nima's
 *     `amountCents` is sent as is.
 *   - References may hold letters, digits, `-`, `.` and `=`. Ours is built
 *     from the payment's idempotency key, so a repeated request reuses the
 *     reference and Paystack refuses to charge it a second time.
 *
 * Sources: paystack.com/docs/payments/payment-channels (Mobile Money, Kenya),
 * /docs/api/charge, /docs/api/transaction, /docs/payments/verify-payments,
 * /docs/payments/webhooks, /docs/api/refund, /docs/payments/refunds,
 * /docs/api (supported currencies), /docs/payments/test-payments.
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

export { describeFailure, maskPhone, redactPayload } from './words.js';

/** Paystack's ceiling for one M-Pesa payment, in cents. */
const MPESA_MAX_CENTS = 150_000 * 100;
/** Paystack's floor for a KES transaction, in cents. */
const KES_MIN_CENTS = 3 * 100;

const REFERENCE_PREFIX = 'nima-';

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

interface PaystackTransaction {
  id?: number;
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  gateway_response?: string | null;
  gateway_response_code?: string | null;
  message?: string | null;
  channel?: string;
  paid_at?: string | null;
  domain?: string;
  display_text?: string;
}

interface PaystackRefund {
  id?: number;
  status?: string;
  amount?: number | string;
  currency?: string;
  transaction?: { id?: number; reference?: string } | number | string;
}

export class PaystackGateway implements PaymentGateway {
  readonly name = 'PAYSTACK' as const;
  readonly provider = 'PAYSTACK' as const;
  readonly webhookPath = '/webhooks/paystack';
  readonly signatureHeader = 'x-paystack-signature';
  readonly webhookProvider = 'paystack';
  readonly canRefund = true;
  readonly readsBackAmount = true;
  readonly configured = true;

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
  ) {}

  /** True for a live key, which is the only kind that moves real money. */
  get live(): boolean {
    return this.secretKey.startsWith('sk_live_');
  }

  referenceFor(idempotencyKey: string): string {
    const safe = idempotencyKey.replace(/[^A-Za-z0-9.=-]/g, '');
    return `${REFERENCE_PREFIX}${safe}`;
  }

  isOurReference(reference: string): boolean {
    return reference.startsWith(REFERENCE_PREFIX);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const reference = this.referenceFor(request.idempotencyKey);
    const msisdn = toMsisdn(request.phone);

    if (!/^254[17]\d{8}$/.test(msisdn)) {
      return {
        providerRef: reference,
        status: 'FAILED',
        failureReason: 'That does not look like a Kenyan mobile number. Check it and try again.',
      };
    }
    if (request.amountCents > MPESA_MAX_CENTS) {
      return {
        providerRef: reference,
        status: 'FAILED',
        failureReason:
          'M-Pesa takes up to KSh 150,000 in one payment. Take something out and try again.',
      };
    }
    if (request.amountCents < KES_MIN_CENTS) {
      return {
        providerRef: reference,
        status: 'FAILED',
        failureReason: 'M-Pesa payments start at KSh 3. Add something and try again.',
      };
    }

    const { status, body } = await this.call<PaystackTransaction>('POST', '/charge', {
      // Paystack wants an email on every charge. Buyers without one get an
      // address that only identifies the payment.
      email: request.email ?? `${reference}@pay.nima.app`,
      amount: request.amountCents,
      currency: 'KES',
      reference,
      mobile_money: { phone: `+${msisdn}`, provider: 'mpesa' },
      metadata: { source: 'nima', description: request.description },
    });

    const message = body.message ?? '';

    if (status >= 500) {
      // Paystack may or may not have sent the prompt. Verify will tell.
      throw new PaymentGatewayError('Paystack did not answer clearly', true, true);
    }

    if (status === 401) {
      throw new PaymentGatewayError(
        'Payments are not working right now. Try again shortly.',
        false,
      );
    }

    if (status >= 400) {
      // The same reference again means we already asked. Not a new charge.
      if (/duplicate/i.test(message)) return { providerRef: reference, status: 'PROCESSING' };

      return {
        providerRef: reference,
        status: 'FAILED',
        failureReason: describeFailure(message, body.data?.gateway_response),
        providerMessage: message || null,
      };
    }

    const data = body.data ?? {};
    const state = (data.status ?? '').toLowerCase();

    if (state === 'failed') {
      return {
        providerRef: reference,
        status: 'FAILED',
        failureReason: describeFailure(
          data.gateway_response_code,
          data.message,
          data.gateway_response,
        ),
        providerMessage: data.gateway_response ?? data.message ?? null,
      };
    }

    // pay_offline is the documented answer. success, pending and ongoing all
    // mean the same thing to us: wait, then verify.
    return { providerRef: reference, status: 'PROCESSING' };
  }

  async verify(reference: string): Promise<VerifiedPayment> {
    const { status, body } = await this.call<PaystackTransaction>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );

    if (status >= 500 || status === 401 || status === 429) {
      throw new PaymentGatewayError('Could not check the payment with Paystack', true, true);
    }

    if (status === 404 || (status === 400 && /not found/i.test(body.message ?? ''))) {
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

    if (status >= 400 || !body.data) {
      throw new PaymentGatewayError(`Paystack refused the verify call (${status})`, true, true);
    }

    const data = body.data;
    const raw = {
      id: data.id ?? null,
      status: data.status ?? null,
      reference: data.reference ?? null,
      amount: data.amount ?? null,
      currency: data.currency ?? null,
      channel: data.channel ?? null,
      gatewayResponse: data.gateway_response ?? null,
      gatewayResponseCode: data.gateway_response_code ?? null,
      paidAt: data.paid_at ?? null,
      domain: data.domain ?? null,
    };

    const txState = (data.status ?? '').toLowerCase();
    const state: VerifiedPayment['state'] =
      txState === 'success'
        ? 'SUCCEEDED'
        : txState === 'failed' || txState === 'reversed'
          ? 'FAILED'
          : txState === 'abandoned'
            ? 'ABANDONED'
            : 'PENDING';

    return {
      state,
      reference: data.reference ?? null,
      amountCents: typeof data.amount === 'number' ? data.amount : null,
      currency: data.currency ?? null,
      failureReason:
        state === 'FAILED' || state === 'ABANDONED'
          ? txState === 'reversed'
            ? 'That payment was reversed by M-Pesa. Try again, or use another number.'
            : describeFailure(
                data.gateway_response_code,
                data.gateway_response,
                data.message,
                state === 'ABANDONED' ? 'abandoned' : null,
              )
          : null,
      providerId: data.id != null ? String(data.id) : null,
      raw,
    };
  }

  async refund(input: {
    reference: string;
    amountCents: number;
    note: string;
  }): Promise<RefundResult> {
    const { status, body } = await this.call<PaystackRefund>('POST', '/refund', {
      transaction: input.reference,
      amount: input.amountCents,
      currency: 'KES',
      merchant_note: input.note.slice(0, 200),
    });

    if (status >= 500) {
      throw new PaymentGatewayError('Paystack did not answer the refund clearly', true, true);
    }
    if (status >= 400 || !body.data?.id) {
      throw new PaymentGatewayError(
        body.message || `Paystack refused the refund (${status})`,
        false,
      );
    }

    return { providerRef: String(body.data.id), state: refundState(body.data.status) };
  }

  async fetchRefund(
    providerRef: string,
  ): Promise<{ state: RefundState; amountCents: number | null }> {
    const { status, body } = await this.call<PaystackRefund>(
      'GET',
      `/refund/${encodeURIComponent(providerRef)}`,
    );
    if (status >= 400 || !body.data) {
      throw new PaymentGatewayError(
        `Could not read the refund from Paystack (${status})`,
        true,
        true,
      );
    }
    return { state: refundState(body.data.status), amountCents: toNumber(body.data.amount) };
  }

  /** Refunds Paystack holds for one transaction, for linking up after a timeout. */
  async listRefunds(
    transactionId: string,
  ): Promise<Array<{ providerRef: string; amountCents: number | null }>> {
    const { status, body } = await this.call<PaystackRefund[]>(
      'GET',
      `/refund?transaction=${encodeURIComponent(transactionId)}&perPage=100`,
    );
    if (status >= 400 || !Array.isArray(body.data)) {
      throw new PaymentGatewayError(`Could not list refunds from Paystack (${status})`, true, true);
    }
    return body.data
      .filter((entry) => entry.id != null)
      .map((entry) => ({ providerRef: String(entry.id), amountCents: toNumber(entry.amount) }));
  }

  verifySignature(rawBody: string | Buffer, signature: string | undefined): boolean {
    if (!signature || !/^[0-9a-f]+$/i.test(signature)) return false;

    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest();
    const given = Buffer.from(signature, 'hex');

    // Same length first, then a constant time compare over the bytes.
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  }

  parseWebhook(payload: unknown): WebhookNotice | null {
    if (typeof payload !== 'object' || payload === null) return null;

    const body = payload as { event?: unknown; data?: Record<string, unknown> };
    const event = typeof body.event === 'string' ? body.event : null;
    const data = body.data ?? {};
    if (!event) return null;

    if (event === 'charge.success') {
      const reference = typeof data.reference === 'string' ? data.reference : null;
      if (!reference) return null;
      const id = data.id != null ? String(data.id) : reference;
      return { kind: 'charge', event, reference, externalId: `${event}:${id}` };
    }

    if (event.startsWith('refund.')) {
      const reference =
        typeof data.transaction_reference === 'string' ? data.transaction_reference : null;
      if (!reference) return null;
      // Refund events carry no id of their own, so the status is part of the
      // key: pending, processing and processed are three different events.
      const status = typeof data.status === 'string' ? data.status : event.slice(7);
      return {
        kind: 'refund',
        event,
        reference,
        externalId: `${event}:${reference}:${status}:${String(data.amount ?? '')}`,
      };
    }

    return { kind: 'other', event, reference: null, externalId: null };
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: PaystackEnvelope<T> }> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        // Ten seconds. A buyer is watching a spinner, and verify is retried.
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      // We cannot tell whether Paystack acted, so this is never a clean failure.
      throw new PaymentGatewayError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'Paystack did not answer in time'
          : 'Could not reach Paystack',
        true,
        true,
      );
    }

    const parsed = (await response.json().catch(() => ({}))) as PaystackEnvelope<T>;
    return { status: response.status, body: parsed };
  }
}

function refundState(status: string | undefined): RefundState {
  const value = (status ?? '').toLowerCase();
  if (value === 'processed') return 'PROCESSED';
  if (value === 'failed') return 'FAILED';
  if (value === 'needs-attention') return 'NEEDS_ATTENTION';
  return 'PENDING';
}

function toNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}
