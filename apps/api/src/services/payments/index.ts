/**
 * Taking money.
 *
 * One interface, two implementations. Everything above this file talks to
 * `PaymentGateway` and never knows whether the shilling came from Fingo, from
 * a sandbox, or from somewhere we have not integrated yet. When Nima adds
 * cards, or a second aggregator, the only file that changes is this folder.
 *
 * M-Pesa is not a card. There is no synchronous "paid" answer: we ask Safaricom
 * to push a prompt to a phone, the person types their PIN somewhere we cannot
 * see, and the result arrives minutes later on a webhook, or never. Every
 * decision here follows from that:
 *
 *   - `charge` returns "we asked", not "they paid".
 *   - The webhook is the only thing that marks an order paid.
 *   - Every request carries an idempotency key, because a retried push that
 *     charges twice is the worst bug this system can have.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '@nima/config';

export interface ChargeRequest {
  amountCents: number;
  /** The number that receives the prompt, in 2547 format. */
  phone: string;
  /** Shown on the M-Pesa message, so keep it short and recognisable. */
  reference: string;
  description: string;
  /** Replaying this key must never take the money twice. */
  idempotencyKey: string;
  /** Where the provider posts the result. */
  callbackUrl: string;
}

export interface ChargeResult {
  /** The provider's own id, used to match the webhook back to the payment. */
  providerRef: string;
  /** PROCESSING means the prompt is on the phone. Nothing is paid yet. */
  status: 'PROCESSING' | 'FAILED';
  failureReason?: string;
}

export interface WebhookResult {
  providerRef: string;
  /** The provider's event id, when it gives one, so replays are ignored. */
  externalId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  failureReason: string | null;
  amountCents: number | null;
}

export interface PaymentGateway {
  readonly name: 'FINGO' | 'SANDBOX';
  /** False when the gateway has no credentials, which gates checkout. */
  readonly configured: boolean;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** Constant time check over the exact bytes received. */
  verifySignature(rawBody: string, signature: string | undefined): boolean;
  parseWebhook(payload: unknown): WebhookResult | null;
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
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
class FingoGateway implements PaymentGateway {
  readonly name = 'FINGO' as const;

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl: string,
  ) {}

  get configured(): boolean {
    return true;
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

  verifySignature(rawBody: string, signature: string | undefined): boolean {
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
 * The gateway used before Fingo credentials exist.
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
  readonly configured = false;

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    return { providerRef: `sandbox_${request.idempotencyKey}`, status: 'PROCESSING' };
  }

  verifySignature(): boolean {
    return false;
  }

  parseWebhook(): WebhookResult | null {
    return null;
  }
}

export function createPaymentGateway(env: Env): PaymentGateway {
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
