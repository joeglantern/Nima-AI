/**
 * Keeping our payments in step with the provider.
 *
 * PaySasa and Paystack send a webhook when a payment succeeds and little
 * else. A wrong PIN, an empty M-Pesa account or a prompt left to time out
 * never arrives on its own, and a success webhook can be late or lost. So
 * every answer comes from reading the payment back from the provider:
 *
 *   - when a signed success webhook says "look at this reference",
 *   - when the buyer's screen polls a checkout that is still waiting,
 *   - and on a timer, for anything still waiting (the reconcile pass).
 *
 * All three go through `confirm`, and `confirm` only credits anyone through
 * `CheckoutService.settle`, whose claim on the payment row makes a second
 * success a no-op. Running them all at once is safe.
 *
 * Refunds work the same way where the provider has a refund API (Paystack):
 * sent from here, and marked done only after the provider's own refund
 * record says processed. Where it has none (PaySasa) the refund is recorded,
 * logged loudly, and sent by a person from the dashboard.
 */

import type { FastifyInstance } from 'fastify';
import type { CheckoutService } from './checkout.js';
import { notify } from './notify.js';
import {
  canVerify,
  type PaymentGateway,
  PaymentGatewayError,
  type VerifiedPayment,
  type VerifyingGateway,
} from './payments/index.js';
import { maskPhone } from './payments/words.js';

/**
 * Written to `refunds.providerRef` when no API can send the refund. The
 * timer skips rows that carry a providerRef, so the row waits for a person
 * instead of being retried every fifteen seconds.
 */
export const BY_HAND = 'BY_HAND';

/** M-Pesa gives a buyer 180 seconds for the PIN. A minute of grace on top. */
const PROMPT_WINDOW_MS = 4 * 60_000;
/** After this a payment the provider still calls pending is closed, and refunded if it ever lands. */
const GIVE_UP_MS = 15 * 60_000;
/** A charge younger than this is still being sent. */
const SETTLING_MS = 10_000;
const REFUND_SWEEP_MS = 10 * 60_000;

export type ConfirmOutcome = 'paid' | 'failed' | 'waiting' | 'ignored' | 'mismatch' | 'late';

export class PaymentSync {
  private lastRefundSweep = 0;

  constructor(
    private readonly app: FastifyInstance,
    private readonly gateway: PaymentGateway,
    private readonly checkout: CheckoutService,
  ) {}

  /**
   * Ask the provider about one reference and act on the answer.
   * Throws when the provider cannot be reached; the next pass tries again.
   */
  async confirm(
    reference: string,
    source: 'webhook' | 'reconcile' | 'poll',
  ): Promise<ConfirmOutcome> {
    const { app } = this;
    const gateway = this.verifying();
    if (!gateway) return 'ignored';

    if (!gateway.isOurReference(reference)) {
      app.log.warn({ reference, source }, 'A payment reference that is not ours');
      return 'ignored';
    }

    const payment = await app.prisma.payment.findUnique({
      where: { providerRef: reference },
      include: { checkoutGroup: { select: { id: true, buyerId: true } } },
    });

    if (!payment || payment.provider !== gateway.provider) {
      app.log.warn({ reference, source }, 'The provider named a payment we do not have');
      return 'ignored';
    }

    const verified = await gateway.verify(reference);

    if (verified.raw) {
      await app.prisma.payment.update({
        where: { id: payment.id },
        data: { raw: verified.raw as never },
      });
    }

    // The answer must be about the payment we asked about.
    if (verified.reference !== null && verified.reference !== reference) {
      app.log.error(
        { reference, got: verified.reference, source },
        'PAYMENT MISMATCH: the provider verified a different reference. Nothing was credited.',
      );
      return 'mismatch';
    }

    const waiting = payment.status === 'PENDING' || payment.status === 'PROCESSING';
    const age = Date.now() - payment.createdAt.getTime();

    if (verified.state === 'SUCCEEDED') {
      if (!this.amountMatches(payment, verified)) {
        app.log.error(
          {
            reference,
            source,
            expected: payment.amountCents,
            got: verified.amountCents,
            expectedCurrency: payment.currency,
            gotCurrency: verified.currency,
          },
          'PAYMENT MISMATCH: the provider says paid, but not the amount or currency we asked for. Nothing was credited. Check it by hand.',
        );
        if (waiting) {
          await this.checkout.settle({
            providerRef: reference,
            externalId: null,
            status: 'SUCCEEDED',
            failureReason: null,
            amountCents: verified.amountCents ?? -1,
            currency: verified.currency,
          });
        }
        return 'mismatch';
      }

      if (waiting) {
        await this.checkout.settle({
          providerRef: reference,
          externalId: null,
          status: 'SUCCEEDED',
          failureReason: null,
          amountCents: verified.amountCents,
          currency: verified.currency,
        });
        app.log.info({ reference, source, provider: gateway.name }, 'A payment was confirmed');
        return 'paid';
      }

      if (payment.status === 'FAILED' || payment.status === 'CANCELLED') {
        return this.lateSuccess(payment.id, reference);
      }

      return 'paid';
    }

    if (!waiting) return 'ignored';

    if (verified.state === 'FAILED') {
      await this.close(
        reference,
        verified.failureReason ?? 'That M-Pesa payment did not go through. Try again.',
      );
      return 'failed';
    }

    if (verified.state === 'ABANDONED' && age > PROMPT_WINDOW_MS) {
      await this.close(
        reference,
        verified.failureReason ??
          'The M-Pesa prompt timed out before a PIN was entered. Try again and keep your phone close.',
      );
      return 'failed';
    }

    if (verified.state === 'NOT_FOUND' && age > PROMPT_WINDOW_MS) {
      await this.close(
        reference,
        'The M-Pesa prompt could not be sent. Check the number and try again.',
      );
      return 'failed';
    }

    if (age > GIVE_UP_MS) {
      app.log.warn({ reference, state: verified.state }, 'Closing a payment that never finished');
      await this.close(
        reference,
        'That M-Pesa payment did not finish in time. If money left your account it will be sent back. Try again.',
      );
      return 'failed';
    }

    return 'waiting';
  }

  /** The buyer's screen is asking. Check now, at most every few seconds. */
  async refreshCheckout(checkoutGroupId: string): Promise<void> {
    const gateway = this.verifying();
    if (!gateway) return;

    const payment = await this.app.prisma.payment.findFirst({
      where: {
        checkoutGroupId,
        provider: gateway.provider,
        status: { in: ['PENDING', 'PROCESSING'] },
        createdAt: { lt: new Date(Date.now() - SETTLING_MS) },
      },
      select: { providerRef: true },
    });
    if (!payment?.providerRef) return;

    const fresh = await this.app.redis.set(`nima:pay:poll:${checkoutGroupId}`, '1', 'EX', 5, 'NX');
    if (!fresh) return;

    try {
      await this.confirm(payment.providerRef, 'poll');
    } catch (error) {
      this.app.log.warn({ err: error, checkoutId: checkoutGroupId }, 'Could not check a payment');
    }
  }

  /** Everything still waiting, checked with the provider. Safe to run on several nodes. */
  async reconcile(): Promise<{ checked: number; refunds: number }> {
    const { app } = this;
    const gateway = this.verifying();
    if (!gateway) return { checked: 0, refunds: 0 };

    const now = Date.now();
    const payments = await app.prisma.payment.findMany({
      where: {
        provider: gateway.provider,
        providerRef: { not: null },
        OR: [
          { status: 'PROCESSING', createdAt: { lt: new Date(now - SETTLING_MS) } },
          // PENDING means the process stopped between saving and sending.
          { status: 'PENDING', createdAt: { lt: new Date(now - 60_000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { providerRef: true, createdAt: true },
    });

    for (const payment of payments) {
      try {
        await this.confirm(payment.providerRef as string, 'reconcile');
      } catch (error) {
        const stuckFor = now - payment.createdAt.getTime();
        app.log[stuckFor > 30 * 60_000 ? 'error' : 'warn'](
          {
            err: error,
            reference: payment.providerRef,
            stuckMinutes: Math.round(stuckFor / 60_000),
          },
          'Could not check a waiting payment with the provider',
        );
      }
    }

    const pending = await app.prisma.refund.findMany({
      where: {
        status: 'PENDING',
        providerRef: null,
        createdAt: { lt: new Date(now - 30_000) },
        payment: { provider: gateway.provider, status: { in: ['SUCCEEDED', 'REFUNDED'] } },
      },
      take: 20,
      select: { id: true },
    });
    for (const refund of pending) await this.sendRefund(refund.id);

    if (now - this.lastRefundSweep > REFUND_SWEEP_MS) {
      this.lastRefundSweep = now;
      await this.sweepRefunds();
    }

    return { checked: payments.length, refunds: pending.length };
  }

  /**
   * Send one refund to the provider. The row is claimed first, so two
   * callers cannot both send it. A clear refusal is marked FAILED and logged
   * loudly for a person to finish from the provider's dashboard.
   *
   * A provider with no refund API (PaySasa) never gets the call. The row is
   * marked BY_HAND so the timer leaves it alone, and one loud log line says
   * exactly what to send and to whom. A person sends it from the dashboard
   * and marks the refund done.
   */
  async sendRefund(refundId: string): Promise<void> {
    const { app } = this;
    const gateway = this.verifying();
    if (!gateway) return;

    const claimed = await app.prisma.refund.updateMany({
      where: { id: refundId, status: 'PENDING', providerRef: null },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) return;

    const refund = await app.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true, order: { select: { reference: true } } },
    });

    const payment = refund.payment;
    if (!payment || payment.provider !== gateway.provider || !payment.providerRef) {
      await app.prisma.refund.update({
        where: { id: refundId },
        data: { status: 'PENDING', providerRef: BY_HAND },
      });
      app.log.error(
        { refundId, orderReference: refund.order.reference, amountCents: refund.amountCents },
        'REFUND BY HAND: this order was not paid through the current provider. Send it yourself, then mark the refund done.',
      );
      return;
    }

    if (!gateway.canRefund) {
      await app.prisma.refund.update({
        where: { id: refundId },
        data: { status: 'PENDING', providerRef: BY_HAND },
      });
      app.log.error(
        {
          refundId,
          orderReference: refund.order.reference,
          amountCents: refund.amountCents,
          phone: maskPhone(payment.phone),
          paymentRef: payment.providerRef,
        },
        `REFUND BY HAND: ${gateway.name} has no refund API. Send KSh ${Math.round(refund.amountCents / 100).toLocaleString('en-KE')} back to the buyer from the ${gateway.name} dashboard, then mark the refund done.`,
      );
      return;
    }

    try {
      const result = await gateway.refund({
        reference: payment.providerRef,
        amountCents: refund.amountCents,
        note: `${refund.order.reference}: ${refund.reason}`,
      });

      await app.prisma.refund.update({
        where: { id: refundId },
        data: { providerRef: result.providerRef },
      });

      app.log.info(
        { refundId, orderReference: refund.order.reference, provider: gateway.name },
        'A refund was sent to the provider',
      );

      if (result.state === 'PROCESSED') await this.markRefunded(refundId);
    } catch (error) {
      if (error instanceof PaymentGatewayError && error.ambiguous) {
        // The provider may have taken it. Left PROCESSING with no id, and
        // linked up later from the provider's own list rather than sent twice.
        app.log.warn({ err: error, refundId }, 'A refund had no clear answer; will check later');
        return;
      }

      await app.prisma.refund.update({ where: { id: refundId }, data: { status: 'FAILED' } });
      app.log.error(
        {
          err: error,
          refundId,
          orderReference: refund.order.reference,
          amountCents: refund.amountCents,
        },
        `REFUND REFUSED by ${gateway.name}. Send it from the ${gateway.name} dashboard.`,
      );
    }
  }

  /** A signed refund webhook: read each refund on that transaction back from the provider. */
  async onRefundWebhook(reference: string): Promise<number> {
    const refunds = await this.app.prisma.refund.findMany({
      where: { status: 'PROCESSING', payment: { providerRef: reference } },
      select: { id: true, providerRef: true },
    });
    for (const refund of refunds) {
      if (refund.providerRef) await this.syncRefund(refund.id, refund.providerRef);
    }
    // How many are still open, so the event can be looked at again.
    return this.app.prisma.refund.count({
      where: { status: 'PROCESSING', payment: { providerRef: reference } },
    });
  }

  private async sweepRefunds(): Promise<void> {
    const gateway = this.verifying();
    if (!gateway?.canRefund) return;

    const refunds = await this.app.prisma.refund.findMany({
      where: { status: 'PROCESSING', payment: { provider: gateway.provider } },
      take: 50,
      select: { id: true, providerRef: true, createdAt: true },
    });

    for (const refund of refunds) {
      try {
        if (refund.providerRef) await this.syncRefund(refund.id, refund.providerRef);
        else if (Date.now() - refund.createdAt.getTime() > 5 * 60_000)
          await this.recoverRefund(refund.id);
      } catch (error) {
        this.app.log.warn(
          { err: error, refundId: refund.id },
          'Could not check a refund with the provider',
        );
      }
    }
  }

  /** The provider's record decides whether a refund is done. */
  private async syncRefund(refundId: string, providerRef: string): Promise<void> {
    const gateway = this.verifying();
    if (!gateway) return;

    const state = await gateway.fetchRefund(providerRef);

    if (state.state === 'PROCESSED') {
      await this.markRefunded(refundId);
    } else if (state.state === 'FAILED') {
      const moved = await this.app.prisma.refund.updateMany({
        where: { id: refundId, status: 'PROCESSING' },
        data: { status: 'FAILED' },
      });
      if (moved.count === 1) {
        this.app.log.error(
          { refundId, providerRef },
          `REFUND FAILED at ${gateway.name}. The money is back in the Nima balance; send it by hand.`,
        );
      }
    } else if (state.state === 'NEEDS_ATTENTION') {
      this.app.log.error(
        { refundId, providerRef },
        `REFUND NEEDS ATTENTION in the ${gateway.name} dashboard: it wants the customer account details.`,
      );
    }
  }

  /** After a timeout on create: find the refund the provider made, or send again. */
  private async recoverRefund(refundId: string): Promise<void> {
    const gateway = this.verifying();
    if (!gateway) return;

    const refund = await this.app.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true },
    });
    const payment = refund.payment;
    if (!payment?.providerRef) return;

    const raw = (payment.raw ?? {}) as { id?: unknown };
    const transactionId =
      raw.id != null ? String(raw.id) : (await gateway.verify(payment.providerRef)).providerId;
    if (!transactionId) return;

    const theirs = await gateway.listRefunds(transactionId);
    const linked = await this.app.prisma.refund.findMany({
      where: { paymentId: payment.id, providerRef: { not: null } },
      select: { providerRef: true },
    });
    const taken = new Set(linked.map((entry) => entry.providerRef));
    const match = theirs.find(
      (entry) => !taken.has(entry.providerRef) && entry.amountCents === refund.amountCents,
    );

    if (match) {
      await this.app.prisma.refund.update({
        where: { id: refundId },
        data: { providerRef: match.providerRef },
      });
      await this.syncRefund(refundId, match.providerRef);
    } else {
      // The provider never got it. Back in the queue to be sent.
      await this.app.prisma.refund.updateMany({
        where: { id: refundId, status: 'PROCESSING', providerRef: null },
        data: { status: 'PENDING' },
      });
    }
  }

  private async markRefunded(refundId: string): Promise<void> {
    const { app } = this;

    const refund = await app.prisma.$transaction(async (tx) => {
      const moved = await tx.refund.updateMany({
        where: { id: refundId, status: { in: ['PROCESSING', 'PENDING'] } },
        data: { status: 'SUCCEEDED', completedAt: new Date() },
      });
      if (moved.count !== 1) return null;

      const row = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
        include: { order: { select: { id: true, buyerId: true, reference: true } } },
      });
      await tx.order.updateMany({
        where: { id: row.orderId, status: 'CANCELLED' },
        data: { status: 'REFUNDED' },
      });
      return row;
    });
    if (!refund) return;

    await app.realtime.toUser(refund.order.buyerId, {
      type: 'order.updated',
      orderId: refund.order.id,
      status: 'REFUNDED',
    });
    await notify(app, {
      userId: refund.order.buyerId,
      type: 'ORDER_UPDATE',
      title: 'Refund sent',
      body: `KSh ${Math.round(refund.amountCents / 100).toLocaleString('en-KE')} for order ${refund.order.reference} is on its way back to your M-Pesa.`,
      data: { orderId: refund.order.id },
    });
  }

  /**
   * Money arrived for a checkout we had already closed: the buyer has paid
   * and has nothing. Every order in it is refunded in full, once.
   */
  private async lateSuccess(paymentId: string, reference: string): Promise<ConfirmOutcome> {
    const { app } = this;

    const refundIds = await app.prisma.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ['FAILED', 'CANCELLED'] } },
        data: { status: 'REFUNDED', failureReason: 'Paid after the order had closed. Sent back.' },
      });
      if (moved.count !== 1) return [];

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { checkoutGroup: { include: { orders: true } } },
      });

      const ids: string[] = [];
      for (const order of payment.checkoutGroup.orders) {
        const row = await tx.refund.create({
          data: {
            orderId: order.id,
            paymentId,
            amountCents: order.totalCents,
            reason: 'Paid after the order had closed',
          },
          select: { id: true },
        });
        ids.push(row.id);
      }
      return ids;
    });

    if (refundIds.length === 0) return 'paid';

    app.log.error(
      { reference, refunds: refundIds.length },
      'LATE PAYMENT: money arrived for a closed checkout. Refunding it in full.',
    );

    for (const id of refundIds) await this.sendRefund(id);
    return 'late';
  }

  private async close(reference: string, reason: string): Promise<void> {
    await this.checkout.settle({
      providerRef: reference,
      externalId: null,
      status: 'FAILED',
      failureReason: reason,
      amountCents: null,
    });
  }

  private amountMatches(
    payment: { amountCents: number; currency: string },
    verified: VerifiedPayment,
  ): boolean {
    return (
      verified.amountCents !== null &&
      verified.amountCents === payment.amountCents &&
      verified.currency !== null &&
      verified.currency.toUpperCase() === payment.currency.toUpperCase()
    );
  }

  private verifying(): VerifyingGateway | null {
    return canVerify(this.gateway) ? this.gateway : null;
  }
}

/** The reconcile pass on a timer, behind a short lock so nodes take turns. */
export function startPaymentReconcile(
  app: FastifyInstance,
  sync: PaymentSync,
  seconds: number,
): void {
  if (seconds <= 0) return;

  const run = async () => {
    const lock = await app.redis.set(
      'nima:pay:reconcile',
      '1',
      'PX',
      Math.max(1_000, seconds * 1000 - 500),
      'NX',
    );
    if (!lock) return;
    await sync.reconcile();
  };

  const timer = setInterval(() => {
    run().catch((error) => app.log.error({ err: error }, 'The payment reconcile pass failed'));
  }, seconds * 1000);
  timer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}
