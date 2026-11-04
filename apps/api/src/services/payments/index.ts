/**
 * Taking money.
 *
 * One interface, several implementations. Everything above this file talks
 * to `PaymentGateway` and never knows whether the shilling came straight
 * from Safaricom, from PaySasa, from Paystack, from a sandbox, or from
 * somewhere we have not integrated yet. When Nima adds cards, or another
 * aggregator, the only folder that changes is this one.
 *
 * M-Pesa is not a card. There is no synchronous "paid" answer: we ask Safaricom
 * to push a prompt to a phone, the person types their PIN somewhere we cannot
 * see, and the result arrives minutes later on a webhook, or never. Every
 * decision here follows from that:
 *
 *   - `charge` returns "we asked", not "they paid".
 *   - Only a confirmed result marks an order paid. That means reading the
 *     payment back from the provider and seeing it agree on the reference,
 *     amount and currency, never a webhook on its own.
 *   - Every request carries an idempotency key, because a retried push that
 *     charges twice is the worst bug this system can have.
 *
 * M-Pesa through Safaricom's own API, paid to Nima's Till, is the provider
 * in use whenever its credentials are set. PaySasa and Paystack are complete
 * implementations kept behind it, used only when it is not configured. Fingo
 * stays only because the test scripts still drive it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '@nima/config';
import { MpesaGateway } from './mpesa.js';
import { PaysasaGateway } from './paysasa.js';
import { PaystackGateway } from './paystack.js';

export interface ChargeRequest {
  amountCents: number;
  /** The number that receives the prompt, in 2547 format. */
  phone: string;
  /** Shown on the M-Pesa message, so keep it short and recognisable. */
  reference: string;
  description: string;
  /** Replaying this key must never take the money twice. */
  idempotencyKey: string;
  /** Where the provider posts the result. PaySasa and Paystack use the dashboard setting instead. */
  callbackUrl: string;
  /** The buyer's email, when there is one. Paystack requires an email on a charge. */
  email?: string | null;
  /**
   * Called as soon as the provider has named the payment and before any
   * money is asked for. The caller writes the name down, so a charge call
   * that times out after that point can still be matched to its result.
   * PaySasa names a session first and pushes the prompt second; Paystack
   * and Fingo never call it.
   */
  onReference?: (providerRef: string) => Promise<void>;
}

export interface ChargeResult {
  /** The provider's own id, used to match the webhook back to the payment. */
  providerRef: string;
  /** PROCESSING means the prompt is on the phone. Nothing is paid yet. */
  status: 'PROCESSING' | 'FAILED';
  /** Written for the buyer: what happened and what to do next. */
  failureReason?: string;
  /** The provider's own words, for the logs. */
  providerMessage?: string | null;
}

/** What Transaction Verify says about a payment, read straight from the provider. */
export interface VerifiedPayment {
  state: 'SUCCEEDED' | 'FAILED' | 'ABANDONED' | 'PENDING' | 'NOT_FOUND';
  /** The reference the provider echoed back. Must equal the one we asked about. */
  reference: string | null;
  amountCents: number | null;
  currency: string | null;
  failureReason: string | null;
  /** The provider's own id for the payment. Paystack needs it to list refunds. */
  providerId: string | null;
  /** A small, safe summary kept on the payment row. No phone numbers. */
  raw: Record<string, unknown> | null;
}

export type RefundState = 'PENDING' | 'PROCESSED' | 'FAILED' | 'NEEDS_ATTENTION';

export interface RefundResult {
  providerRef: string;
  state: RefundState;
}

/**
 * What a signed webhook asked us to look at. It is a prompt to check, not a
 * fact: the money question is answered by `verify`.
 */
export type WebhookNotice =
  | { kind: 'charge'; event: string; reference: string; externalId: string }
  | { kind: 'refund'; event: string; reference: string; externalId: string }
  | { kind: 'other'; event: string; reference: null; externalId: null };

export interface WebhookResult {
  providerRef: string;
  /** The provider's event id, when it gives one, so replays are ignored. */
  externalId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  failureReason: string | null;
  amountCents: number | null;
  /** When the provider says, so a payment in the wrong currency is never credited. */
  currency?: string | null;
}

export interface PaymentGateway {
  readonly name: 'MPESA' | 'PAYSASA' | 'PAYSTACK' | 'FINGO' | 'SANDBOX';
  /** The value written to `payments.provider`. */
  readonly provider: 'MPESA' | 'PAYSASA' | 'PAYSTACK' | 'FINGO' | 'MANUAL';
  /** False when the gateway has no credentials, which gates checkout. */
  readonly configured: boolean;
  /**
   * Our reference for a payment, known before the provider is called, so a
   * result can always be matched even when the charge call timed out. Null
   * when the provider makes up its own.
   */
  referenceFor(idempotencyKey: string): string | null;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** Constant time check over the exact bytes received. */
  verifySignature(rawBody: string | Buffer, signature: string | undefined): boolean;
}

/** A gateway that can be asked for the truth, and may be able to send money back. */
export interface VerifyingGateway extends PaymentGateway {
  readonly name: 'MPESA' | 'PAYSASA' | 'PAYSTACK';
  readonly live: boolean;
  /**
   * True when the read back states the amount and currency, which are then
   * checked against the payment. False for M-Pesa, whose query names only
   * the request: there the push itself fixed the amount, and the callback's
   * amount is checked whenever it came.
   */
  readonly readsBackAmount: boolean;
  /** Where its webhooks arrive, under the API root. */
  readonly webhookPath: string;
  /** The header that carries the signature. */
  readonly signatureHeader: string;
  /** The value written to `webhook_events.provider`. */
  readonly webhookProvider: string;
  /**
   * False when the provider has no refund API. Refunds are still recorded
   * and then sent by a person from the provider's dashboard.
   */
  readonly canRefund: boolean;
  isOurReference(reference: string): boolean;
  verify(reference: string): Promise<VerifiedPayment>;
  parseWebhook(payload: unknown): WebhookNotice | null;
  refund(input: { reference: string; amountCents: number; note: string }): Promise<RefundResult>;
  fetchRefund(providerRef: string): Promise<{ state: RefundState; amountCents: number | null }>;
  listRefunds(
    transactionId: string,
  ): Promise<Array<{ providerRef: string; amountCents: number | null }>>;
}

export function canVerify(gateway: PaymentGateway): gateway is VerifyingGateway {
  return gateway.name === 'MPESA' || gateway.name === 'PAYSASA' || gateway.name === 'PAYSTACK';
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /**
     * True when we cannot tell whether the provider acted: a timeout, a
     * dropped connection, a 5xx. The payment is then left waiting and
     * checked later, never cancelled on the spot, because the prompt may
     * already be on the phone.
     */
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

/**
 * Kenyan numbers arrive written six different ways. Safaricom accepts one.
 */
export function toMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
}

// -------------------------------------------------------------------- fingo ---

interface FingoChargeResponse {
  id?: string;
  reference?: string;
  status?: string;
  message?: string;
}

/**
 * Fingo, the aggregator the previous app used for M-Pesa.
 *
 * Their STK endpoint answers with an acknowledgement and an id. The money
 * question is answered later, on the webhook.
 */
export class FingoGateway implements PaymentGateway {
  readonly name = 'FINGO' as const;
  readonly provider = 'FINGO' as const;

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl: string,
  ) {}

  get configured(): boolean {
    return true;
  }

  /** Fingo makes its own id, which arrives with the charge answer. */
  referenceFor(): null {
    return null;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    // Ten seconds. A prompt that has not been acknowledged by then is not
    // going to be, and the buyer is watching a spinner.
    const timeout = AbortSignal.timeout(10_000);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/v1/payments/stk`, {
        method: 'POST',
        signal: timeout,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          'idempotency-key': request.idempotencyKey,
        },
        body: JSON.stringify({
          amount: Math.round(request.amountCents / 100),
          currency: 'KES',
          phone: toMsisdn(request.phone),
          reference: request.reference,
          description: request.description,
          callbackUrl: request.callbackUrl,
        }),
      });
    } catch (cause) {
      throw new PaymentGatewayError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'The payment service did not answer in time'
          : 'Could not reach the payment service',
        true,
      );
    }

    const body = (await response.json().catch(() => ({}))) as FingoChargeResponse;

    if (!response.ok) {
      // 4xx is our mistake and will fail again. 5xx is theirs and might not.
      throw new PaymentGatewayError(
        body.message ?? `The payment service refused the request (${response.status})`,
        response.status >= 500,
      );
    }

    const providerRef = body.id ?? body.reference;

    if (!providerRef) {
      throw new PaymentGatewayError('The payment service did not return a reference', false);
    }

    return { providerRef, status: 'PROCESSING' };
  }

  verifySignature(rawBody: string | Buffer, signature: string | undefined): boolean {
    if (!signature) return false;

    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const given = signature.replace(/^sha256=/, '');

    // Both sides must be the same length before a constant time compare.
    if (given.length !== expected.length) return false;

    return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
  }

  parseWebhook(payload: unknown): WebhookResult | null {
    if (typeof payload !== 'object' || payload === null) return null;

    const body = payload as Record<string, unknown>;
    const providerRef =
      typeof body.paymentId === 'string'
        ? body.paymentId
        : typeof body.id === 'string'
          ? body.id
          : null;

    if (!providerRef) return null;

    const raw = typeof body.status === 'string' ? body.status.toUpperCase() : '';
    const status =
      raw === 'SUCCESS' || raw === 'SUCCEEDED' || raw === 'COMPLETED'
        ? ('SUCCEEDED' as const)
        : raw === 'CANCELLED' || raw === 'CANCELED'
          ? ('CANCELLED' as const)
          : ('FAILED' as const);

    return {
      providerRef,
      externalId: typeof body.eventId === 'string' ? body.eventId : null,
      status,
      failureReason: typeof body.message === 'string' ? body.message : null,
      amountCents: typeof body.amount === 'number' ? Math.round(body.amount * 100) : null,
    };
  }
}

// ------------------------------------------------------------------ sandbox ---

/**
 * The gateway used before any provider credentials exist.
 *
 * `configured` is false, and that is the whole protection. `CheckoutService`
 * refuses to start a payment against an unconfigured gateway, and the
 * checkout feature flag is off besides, so no order can be placed that
 * nobody can pay for.
 *
 * What it must never do is pretend. It does not fake a webhook, it does not
 * mark anything paid, and it cannot verify a signature, so nothing can be
 * settled through it either.
 */
class SandboxGateway implements PaymentGateway {
  readonly name = 'SANDBOX' as const;
  readonly provider = 'MANUAL' as const;
  readonly configured = false;

  referenceFor(): null {
    return null;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    return { providerRef: `sandbox_${request.idempotencyKey}`, status: 'PROCESSING' };
  }

  verifySignature(): boolean {
    return false;
  }
}

export function createPaymentGateway(env: Env): PaymentGateway {
  if (
    env.MPESA_CONSUMER_KEY &&
    env.MPESA_CONSUMER_SECRET &&
    env.MPESA_SHORTCODE &&
    env.MPESA_PASSKEY &&
    env.MPESA_CALLBACK_TOKEN
  ) {
    const live = env.MPESA_ENV === 'production';
    return new MpesaGateway({
      consumerKey: env.MPESA_CONSUMER_KEY,
      consumerSecret: env.MPESA_CONSUMER_SECRET,
      shortcode: env.MPESA_SHORTCODE,
      till: env.MPESA_TILL || null,
      passkey: env.MPESA_PASSKEY,
      callbackToken: env.MPESA_CALLBACK_TOKEN,
      baseUrl:
        env.MPESA_BASE_URL ??
        (live ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'),
      live,
    });
  }

  if (env.PAYSASA_API_KEY && env.PAYSASA_BUSINESS_ID) {
    return new PaysasaGateway({
      apiKey: env.PAYSASA_API_KEY,
      businessId: env.PAYSASA_BUSINESS_ID,
      webhookSecret: env.PAYSASA_WEBHOOK_SECRET ?? null,
      baseUrl: env.PAYSASA_BASE_URL.replace(/\/+$/, ''),
    });
  }

  if (env.PAYSTACK_SECRET_KEY) {
    return new PaystackGateway(env.PAYSTACK_SECRET_KEY, env.PAYSTACK_BASE_URL.replace(/\/+$/, ''));
  }

  if (env.FINGO_API_KEY && env.FINGO_WEBHOOK_SECRET) {
    return new FingoGateway(env.FINGO_API_KEY, env.FINGO_WEBHOOK_SECRET, env.FINGO_BASE_URL);
  }

  // Deliberately not a boot failure, even in production. Everything except
  // paying works without a payment provider, and an API that refuses to
  // start cannot serve the shop, the stylist or a single try-on. The gateway
  // reports itself unconfigured instead, which is what actually stops an
  // order being taken.
  return new SandboxGateway();
}
