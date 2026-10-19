/**
 * Checkout.
 *
 * One basket becomes one checkout group, one order per shop, and one M-Pesa
 * prompt. The hard parts are all about the gap between asking for money and
 * being told whether it arrived.
 *
 * **Stock is taken when the order is placed, not when it is paid.** Two people
 * reaching for the last dress at the same time is the normal case on a drop,
 * and whoever gets through checkout first should get it. The decrement is a
 * conditional update, so the database decides the race rather than our code
 * reading a number and hoping it is still true a line later.
 *
 * **Nothing is marked paid here.** `start` returns once Safaricom has pushed
 * a prompt to a phone. The money question is answered on the webhook, which
 * is the only path that moves an order to PAID and the only path that credits
 * a seller.
 *
 * **If the push itself fails, everything is put back.** The orders are
 * cancelled, the stock is returned, and the buyer sees why. An order stuck at
 * PENDING_PAYMENT holding stock nobody can buy is worse than no order.
 */

import { randomBytes } from 'node:crypto';
import type { Prisma } from '@nima/db';
import type { FastifyInstance } from 'fastify';
import { errors } from '../lib/errors.js';
import { primaryImageKey } from './cart.js';
import { notify } from './notify.js';
import { type PaymentGateway, PaymentGatewayError, type WebhookResult } from './payments/index.js';

export interface StartCheckoutInput {
  userId: string;
  deliveryMethod: 'PICKUP_POINT' | 'DOORSTEP';
  pickupPointId?: string;
  recipientName: string;
  recipientPhone: string;
  deliveryNote?: string;
  payerPhone: string;
}

export interface StartCheckoutResult {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  subtotalCents: number;
  deliveryCents: number;
  totalCents: number;
  orderIds: string[];
  instruction: string;
}

/**
 * No I, O, 0 or 1. People read these out over the phone to a shop owner and
 * type them into a support chat, and those four are where it goes wrong.
 */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function orderReference(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `NM${out}`;
}

export class CheckoutService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly gateway: PaymentGateway,
  ) {}

  async start(input: StartCheckoutInput): Promise<StartCheckoutResult> {
    const { app } = this;
    const settings = await app.services.settings.get();

    if (!settings.features.checkout) {
      throw errors.conflict('Checkout is not open yet. You can still save what you like.');
    }

    if (!this.gateway.configured) {
      throw errors.providerUnavailable('Payments are not connected yet');
    }

    if (input.deliveryMethod === 'PICKUP_POINT' && !input.pickupPointId) {
      throw errors.badRequest('Choose where you want to collect this', {
        pickupPointId: ['Pick a collection point'],
      });
    }

    const cart = await app.prisma.cart.findUnique({
      where: { userId: input.userId },
      include: {
        items: {
          orderBy: { addedAt: 'asc' },
          include: {
            variant: true,
            product: {
              include: { store: true, images: { orderBy: { position: 'asc' }, take: 1 } },
            },
          },
        },
      },
    });

    const lines = (cart?.items ?? []).filter(
      (item) => item.product.status === 'ACTIVE' && item.variant.isActive,
    );

    if (lines.length === 0) throw errors.conflict('Your basket is empty');

    const subtotalCents = lines.reduce(
      (total, line) => total + line.variant.priceCents * line.quantity,
      0,
    );

    const deliveryCents = this.deliveryFor(settings, input.deliveryMethod, subtotalCents);
    const totalCents = subtotalCents + deliveryCents;

    // Group into one order per shop, keeping the order the buyer added them.
    const byStore = new Map<string, typeof lines>();
    for (const line of lines) {
      const bucket = byStore.get(line.product.storeId);
      if (bucket) bucket.push(line);
      else byStore.set(line.product.storeId, [line]);
    }

    const pickupPoint = input.pickupPointId ? await this.pickupPoint(input.pickupPointId) : null;

    const idempotencyKey = randomBytes(16).toString('hex');

    const placed = await app.prisma.$transaction(async (tx) => {
      // Take the stock first. Anything that fails here fails the whole
      // checkout, before a payment row exists and before the basket is
      // emptied, so the buyer is exactly where they were.
      for (const line of lines) {
        const taken = await tx.productVariant.updateMany({
          where: { id: line.variantId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });

        if (taken.count !== 1) {
          throw errors.conflict(
            `${line.product.title} sold out while you were checking out. Take it out of your basket and try again.`,
          );
        }
      }

      const group = await tx.checkoutGroup.create({
        data: {
          buyerId: input.userId,
          subtotalCents,
          deliveryCents,
          totalCents,
          status: 'PENDING',
          deliveryMethod: input.deliveryMethod,
          pickupPointId: pickupPoint?.id ?? null,
          pickupPointName: pickupPoint?.name ?? null,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          deliveryNote: input.deliveryNote ?? null,
        },
      });

      const shares = apportion(
        deliveryCents,
        [...byStore.values()].map((bucket) =>
          bucket.reduce((total, line) => total + line.variant.priceCents * line.quantity, 0),
        ),
      );

      const orderIds: string[] = [];
      let index = 0;

      for (const [storeId, bucket] of byStore.entries()) {
        const storeSubtotal = bucket.reduce(
          (total, line) => total + line.variant.priceCents * line.quantity,
          0,
        );
        const storeDelivery = shares[index] ?? 0;
        index += 1;

        const order = await tx.order.create({
          data: {
            reference: orderReference(),
            checkoutGroupId: group.id,
            buyerId: input.userId,
            storeId,
            status: 'PENDING_PAYMENT',
            subtotalCents: storeSubtotal,
            deliveryCents: storeDelivery,
            totalCents: storeSubtotal + storeDelivery,
            // Frozen now. Changing the fee next month must not rewrite what
            // a seller was owed for a sale they already made.
            platformFeeCents: Math.round((storeSubtotal * settings.platformFeeBps) / 10_000),
            items: {
              create: bucket.map((line) => ({
                productId: line.productId,
                variantId: line.variantId,
                titleSnapshot: line.product.title,
                sizeSnapshot: line.variant.size,
                colourSnapshot: line.variant.colour,
                imageSnapshot: primaryImageKey(line.product.images),
                unitPriceCents: line.variant.priceCents,
                quantity: line.quantity,
                totalCents: line.variant.priceCents * line.quantity,
              })),
            },
          },
          select: { id: true },
        });

        orderIds.push(order.id);
      }

      const payment = await tx.payment.create({
        data: {
          checkoutGroupId: group.id,
          provider: 'FINGO',
          method: 'MPESA',
          status: 'PENDING',
          amountCents: totalCents,
          idempotencyKey,
          phone: input.payerPhone,
        },
        select: { id: true },
      });

      // The basket is emptied here rather than on payment, so a buyer who
      // closes the app mid prompt does not pay for the same things twice by
      // starting a second checkout from the same basket.
      if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return { group, orderIds, paymentId: payment.id };
    });

    // Outside the transaction: a slow network call must not hold row locks.
    try {
      const result = await this.gateway.charge({
        amountCents: totalCents,
        phone: input.payerPhone,
        reference: `NIMA ${placed.group.id.slice(-6).toUpperCase()}`,
        description: 'Nima order',
        idempotencyKey,
        callbackUrl: `${app.env.API_URL}/webhooks/fingo`,
      });

      await app.prisma.$transaction([
        app.prisma.payment.update({
          where: { id: placed.paymentId },
          data: { status: 'PROCESSING', providerRef: result.providerRef },
        }),
        app.prisma.checkoutGroup.update({
          where: { id: placed.group.id },
          data: { status: 'PROCESSING' },
        }),
      ]);
    } catch (error) {
      await this.unwind(
        placed.group.id,
        error instanceof PaymentGatewayError ? error.message : 'The payment could not be started',
      );

      app.log.error({ err: error, checkoutId: placed.group.id }, 'Could not start a payment');

      throw error instanceof PaymentGatewayError
        ? errors.providerUnavailable(error.message)
        : errors.internal('The payment could not be started', error);
    }

    return {
      id: placed.group.id,
      status: 'PROCESSING',
      subtotalCents,
      deliveryCents,
      totalCents,
      orderIds: placed.orderIds,
      instruction: `Check ${input.payerPhone} for the M-Pesa prompt and enter your PIN. This page updates on its own.`,
    };
  }

  /**
   * The webhook said something. This is the only place an order becomes paid.
   *
   * Safe to call twice with the same event: a group that has already left
   * PENDING or PROCESSING is left exactly as it is. Providers do retry, and a
   * second success must not pay a seller twice.
   */
  async settle(result: WebhookResult): Promise<{ handled: boolean }> {
    const { app } = this;
    const settings = await app.services.settings.get();

    const payment = await app.prisma.payment.findUnique({
      where: { providerRef: result.providerRef },
      include: { checkoutGroup: { include: { orders: { select: { id: true } } } } },
    });

    if (!payment) {
      app.log.warn({ providerRef: result.providerRef }, 'A webhook referenced an unknown payment');
      return { handled: false };
    }

    const group = payment.checkoutGroup;

    if (group.status !== 'PENDING' && group.status !== 'PROCESSING') {
      return { handled: false };
    }

    // An amount that does not match is never treated as a payment. It is the
    // one signal that something is wrong on the provider's side, and quietly
    // releasing goods against the wrong number is how a shop loses money.
    if (
      result.status === 'SUCCEEDED' &&
      result.amountCents !== null &&
      result.amountCents !== payment.amountCents
    ) {
      app.log.error(
        { providerRef: result.providerRef, expected: payment.amountCents, got: result.amountCents },
        'A payment settled for the wrong amount',
      );

      await this.unwind(group.id, 'The amount paid did not match the order');
      return { handled: true };
    }

    if (result.status !== 'SUCCEEDED') {
      await this.unwind(
        group.id,
        result.failureReason ?? 'The payment was not completed',
        result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      );

      await app.realtime.toUser(group.buyerId, {
        type: 'payment.status',
        checkoutId: group.id,
        status: result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        message: result.failureReason ?? 'The payment was not completed',
      });

      return { handled: true };
    }

    const paidAt = new Date();

    await app.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED' },
      });

      await tx.checkoutGroup.update({
        where: { id: group.id },
        data: { status: 'SUCCEEDED' },
      });

      const orders = await tx.order.findMany({
        where: { checkoutGroupId: group.id },
        select: {
          id: true,
          storeId: true,
          subtotalCents: true,
          platformFeeCents: true,
          reference: true,
        },
      });

      for (const order of orders) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAt },
        });

        // The seller is owed the goods, not the delivery: that money belongs
        // to the courier. `availableAt` stays empty until the order is
        // delivered, because the return window starts from delivery.
        await tx.sellerLedgerEntry.createMany({
          data: [
            {
              storeId: order.storeId,
              orderId: order.id,
              kind: 'SALE',
              amountCents: order.subtotalCents,
              note: `Order ${order.reference}`,
            },
            {
              storeId: order.storeId,
              orderId: order.id,
              kind: 'PLATFORM_FEE',
              amountCents: -order.platformFeeCents,
              note: `Nima fee on ${order.reference}`,
            },
          ],
        });

        await tx.shipment.create({
          data: {
            orderId: order.id,
            provider: 'PICKUP_MTAANI',
            status: 'PENDING',
            pickupPointId: group.pickupPointId,
            pickupPointName: group.pickupPointName,
          },
        });
      }
    });

    await app.realtime.toUser(group.buyerId, {
      type: 'payment.status',
      checkoutId: group.id,
      status: 'SUCCEEDED',
    });

    for (const order of group.orders) {
      await app.realtime.toUser(group.buyerId, {
        type: 'order.updated',
        orderId: order.id,
        status: 'PAID',
      });
    }

    // Each shop hears about its own order, so packing can start.
    const paidOrders = await app.prisma.order.findMany({
      where: { checkoutGroupId: group.id },
      select: {
        id: true,
        reference: true,
        subtotalCents: true,
        store: { select: { ownerId: true } },
        _count: { select: { items: true } },
      },
    });
    for (const paid of paidOrders) {
      await notify(app, {
        userId: paid.store.ownerId,
        type: 'ORDER_PLACED',
        title: 'New order',
        body: `New order ${paid.reference}: ${paid._count.items} ${paid._count.items === 1 ? 'piece' : 'pieces'}, KSh ${Math.round(paid.subtotalCents / 100).toLocaleString('en-KE')}`,
        data: { orderId: paid.id, seller: true },
      });
    }

    app.log.info(
      { checkoutId: group.id, orders: group.orders.length, feeBps: settings.platformFeeBps },
      'An order was paid',
    );

    return { handled: true };
  }

  /**
   * Put everything back.
   *
   * Used when the push could not be sent and when the payment comes back
   * failed. Stock returns to the variant it came from, every order is
   * cancelled with a reason the buyer can read, and the group is closed.
   */
  private async unwind(
    checkoutGroupId: string,
    reason: string,
    status: 'FAILED' | 'CANCELLED' = 'FAILED',
  ): Promise<void> {
    const { app } = this;

    await app.prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({
        where: { checkoutGroupId, status: 'PENDING_PAYMENT' },
        include: { items: { select: { variantId: true, quantity: true } } },
      });

      for (const order of orders) {
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
        });
      }

      await tx.payment.updateMany({
        where: { checkoutGroupId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status, failureReason: reason },
      });

      await tx.checkoutGroup.update({ where: { id: checkoutGroupId }, data: { status } });
    });
  }

  private deliveryFor(
    settings: {
      delivery: { pickupPointCents: number; doorstepCents: number; freeOverCents: number };
    },
    method: 'PICKUP_POINT' | 'DOORSTEP',
    subtotalCents: number,
  ): number {
    const { delivery } = settings;

    if (delivery.freeOverCents > 0 && subtotalCents >= delivery.freeOverCents) return 0;

    return method === 'DOORSTEP' ? delivery.doorstepCents : delivery.pickupPointCents;
  }

  /**
   * Collection points.
   *
   * Until the Pick Up Mtaani key arrives these come from a settings row, so a
   * real list can be loaded without a release and nothing here has to change
   * when the live API is wired in.
   */
  private async pickupPoint(id: string): Promise<{ id: string; name: string } | null> {
    const points = await listPickupPoints(this.app);
    return points.find((point) => point.id === id) ?? null;
  }
}

/**
 * Split one amount across several lines so the parts add up to the whole.
 *
 * Proportional to each line, with the rounding remainder put on the largest,
 * because the alternative is a checkout whose orders sum to one shilling less
 * than the buyer was charged and an accountant who cannot close the month.
 */
export function apportion(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  if (amount === 0 || total === 0) return weights.map(() => 0);

  const shares = weights.map((weight) => Math.floor((amount * weight) / total));
  const remainder = amount - shares.reduce((sum, share) => sum + share, 0);

  if (remainder > 0) {
    let largest = 0;
    for (let index = 1; index < weights.length; index += 1) {
      if ((weights[index] ?? 0) > (weights[largest] ?? 0)) largest = index;
    }
    shares[largest] = (shares[largest] ?? 0) + remainder;
  }

  return shares;
}

export interface PickupPoint {
  id: string;
  name: string;
  area: string;
  county: string;
  costCents: number;
  openingHours: string | null;
}

const PICKUP_POINTS_KEY = 'pickup-points';

/**
 * The collection points a buyer can choose from.
 *
 * Stored as a settings row so the list is real data rather than a constant in
 * a bundle, and so it can be replaced wholesale by the Pick Up Mtaani
 * response the day that key exists. The fallback is the handful of Nairobi
 * agents the previous app used, which is enough to test the flow.
 */
export async function listPickupPoints(app: FastifyInstance): Promise<PickupPoint[]> {
  const row = await app.prisma.appSetting.findUnique({ where: { key: PICKUP_POINTS_KEY } });

  if (Array.isArray(row?.value)) return row.value as unknown as PickupPoint[];

  return FALLBACK_PICKUP_POINTS;
}

const FALLBACK_PICKUP_POINTS: PickupPoint[] = [
  {
    id: 'cbd-moi-avenue',
    name: 'Moi Avenue agent',
    area: 'CBD',
    county: 'Nairobi',
    costCents: 20_000,
    openingHours: 'Mon to Sat, 8am to 7pm',
  },
  {
    id: 'westlands-sarit',
    name: 'Sarit Centre agent',
    area: 'Westlands',
    county: 'Nairobi',
    costCents: 20_000,
    openingHours: 'Daily, 9am to 8pm',
  },
  {
    id: 'kilimani-yaya',
    name: 'Yaya Centre agent',
    area: 'Kilimani',
    county: 'Nairobi',
    costCents: 20_000,
    openingHours: 'Daily, 9am to 8pm',
  },
  {
    id: 'eastleigh-first-avenue',
    name: 'First Avenue agent',
    area: 'Eastleigh',
    county: 'Nairobi',
    costCents: 20_000,
    openingHours: 'Mon to Sat, 8am to 6pm',
  },
  {
    id: 'thika-road-trm',
    name: 'TRM agent',
    area: 'Thika Road',
    county: 'Nairobi',
    costCents: 20_000,
    openingHours: 'Daily, 9am to 8pm',
  },
];

export const orderInclude = {
  store: true,
  items: {
    include: { product: { select: { id: true } } },
  },
  shipment: true,
} satisfies Prisma.OrderInclude;
