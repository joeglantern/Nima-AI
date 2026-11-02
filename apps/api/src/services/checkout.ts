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

import { createHash, randomBytes } from 'node:crypto';
import type { OrderChannel, Prisma } from '@nima/db';
import type { FastifyInstance } from 'fastify';
import { AppError, errors } from '../lib/errors.js';
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

export interface StartBoothCheckoutInput {
  userId: string;
  /** The shop whose QR was scanned. */
  slug: string;
  items: Array<{ variantId: string; quantity: number }>;
  payerPhone: string;
  /** From the app, one per basket. A repeat gets the first checkout back. */
  idempotencyKey: string;
}

/** One thing being bought, however the buyer got to the point of paying. */
interface OrderLine {
  productId: string;
  variantId: string;
  quantity: number;
  variant: { priceCents: number; size: string | null; colour: string | null };
  product: {
    storeId: string;
    title: string;
    images: Array<{ processedKey: string | null; originalKey: string }>;
  };
}

interface PlaceInput {
  userId: string;
  lines: OrderLine[];
  channel: OrderChannel;
  deliveryCents: number;
  platformFeeBps: number;
  deliveryMethod: 'PICKUP_POINT' | 'DOORSTEP' | 'AT_BOOTH';
  pickupPoint: { id: string; name: string } | null;
  recipientName: string;
  recipientPhone: string;
  deliveryNote: string | null;
  payerPhone: string;
  idempotencyKey: string;
  description: string;
  /** Anything else that must succeed or fail with the order. */
  inTransaction?: (tx: Prisma.TransactionClient) => Promise<void>;
}

function subtotalOf(lines: OrderLine[]): number {
  return lines.reduce((total, line) => total + line.variant.priceCents * line.quantity, 0);
}

function promptInstruction(phone: string | null): string {
  return `Check ${phone ?? 'your phone'} for the M-Pesa prompt and enter your PIN. This page updates on its own.`;
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

  /** The whole basket, delivered. */
  async start(input: StartCheckoutInput): Promise<StartCheckoutResult> {
    const { app } = this;
    const settings = await this.assertOpen();

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

    const pickupPoint = input.pickupPointId ? await this.pickupPoint(input.pickupPointId) : null;

    return this.place({
      userId: input.userId,
      lines,
      channel: 'ONLINE',
      deliveryCents: this.deliveryFor(settings, input.deliveryMethod, subtotalOf(lines)),
      platformFeeBps: settings.platformFeeBps,
      deliveryMethod: input.deliveryMethod,
      pickupPoint,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      deliveryNote: input.deliveryNote ?? null,
      payerPhone: input.payerPhone,
      idempotencyKey: randomBytes(16).toString('hex'),
      description: 'Nima order',
      // The basket is emptied here rather than on payment, so a buyer who
      // closes the app mid prompt does not pay for the same things twice by
      // starting a second checkout from the same basket.
      inTransaction: async (tx) => {
        if (!cart) return;
        // Two taps at once both read the same basket. The rows lock, so only
        // one of them can delete them all; the other finds them gone and
        // rolls back before anything is charged.
        const cleared = await tx.cartItem.deleteMany({
          where: { id: { in: cart.items.map((item) => item.id) } },
        });
        if (cleared.count !== cart.items.length) {
          throw errors.conflict('This basket is already being paid for. Check your orders.');
        }
      },
    });
  }

  /**
   * Bought at a booth: what they picked, from one shop, collected on the spot.
   *
   * The items come from the request and the buyer's basket is left alone, so
   * nothing they saved for later gets charged or cleared. There is no basket
   * to empty, so a repeat is caught by the key the app sends instead.
   *
   * Vendor reports, event offers and drink redemption attach to orders with
   * `channel: 'BOOTH'`. None of them need to change this path.
   */
  async startBooth(input: StartBoothCheckoutInput): Promise<StartCheckoutResult> {
    const { app } = this;
    const settings = await this.assertOpen();

    const store = await app.prisma.store.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (!store) throw errors.notFound('That shop');

    // Scoped to the buyer, so one person's key can never find another's checkout.
    const idempotencyKey = createHash('sha256')
      .update(`booth:${input.userId}:${input.idempotencyKey}`)
      .digest('hex')
      .slice(0, 32);

    const earlier = await this.replay(idempotencyKey);
    if (earlier) return earlier;

    // The same size listed twice is one line, not two.
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
    }

    const variants = await app.prisma.productVariant.findMany({
      where: { id: { in: [...quantities.keys()] } },
      include: {
        product: { include: { images: { orderBy: { position: 'asc' }, take: 1 } } },
      },
    });

    const lines = [...quantities].map(([variantId, quantity]) => {
      const variant = variants.find((entry) => entry.id === variantId);

      // A sale must land with the shop whose QR was scanned, or the vendor's
      // numbers are wrong and the wrong person is paid.
      if (!variant || variant.product.storeId !== store.id) {
        throw errors.badRequest('That piece is not sold by this shop', {
          items: [`${variantId} is not sold by this shop`],
        });
      }

      if (variant.product.status !== 'ACTIVE' || !variant.isActive) {
        throw errors.conflict(
          `${variant.product.title} is no longer on sale. Take it out of your basket and try again.`,
        );
      }

      return {
        productId: variant.productId,
        variantId,
        quantity,
        variant,
        product: variant.product,
      };
    });

    const buyer = await app.prisma.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { name: true, profile: { select: { displayName: true } } },
    });

    return this.place({
      userId: input.userId,
      lines,
      channel: 'BOOTH',
      deliveryCents: 0,
      platformFeeBps: settings.platformFeeBps,
      deliveryMethod: 'AT_BOOTH',
      pickupPoint: null,
      recipientName: buyer.profile?.displayName ?? buyer.name ?? 'Booth buyer',
      recipientPhone: input.payerPhone,
      deliveryNote: null,
      payerPhone: input.payerPhone,
      idempotencyKey,
      description: 'Nima Checkout',
    });
  }

  /** Whether money can be taken right now. The booth page asks before showing a pay button. */
  async paymentsOpen(): Promise<boolean> {
    const settings = await this.app.services.settings.get();
    return settings.features.checkout && this.gateway.configured;
  }

  private async assertOpen() {
    const settings = await this.app.services.settings.get();

    if (!settings.features.checkout) {
      throw errors.conflict('Checkout is not open yet. You can still save what you like.');
    }

    if (!this.gateway.configured) {
      throw errors.providerUnavailable('Payments are not connected yet');
    }

    return settings;
  }

  /** The checkout a key already started, as the buyer would have seen it. */
  private async replay(idempotencyKey: string): Promise<StartCheckoutResult | null> {
    const payment = await this.app.prisma.payment.findUnique({
      where: { idempotencyKey },
      include: {
        checkoutGroup: { include: { orders: { select: { id: true } } } },
      },
    });
    if (!payment) return null;

    const group = payment.checkoutGroup;

    return {
      id: group.id,
      status: group.status === 'REFUNDED' ? 'SUCCEEDED' : group.status,
      subtotalCents: group.subtotalCents,
      deliveryCents: group.deliveryCents,
      totalCents: group.totalCents,
      orderIds: group.orders.map((order) => order.id),
      instruction:
        group.status === 'FAILED' || group.status === 'CANCELLED'
          ? (payment.failureReason ?? 'That payment did not go through.')
          : promptInstruction(payment.phone),
    };
  }

  /** Takes the stock, writes the orders and the payment, then sends the prompt. */
  private async place(input: PlaceInput): Promise<StartCheckoutResult> {
    const { app } = this;
    const { lines, deliveryCents, idempotencyKey } = input;

    const subtotalCents = subtotalOf(lines);
    const totalCents = subtotalCents + deliveryCents;

    // Group into one order per shop, keeping the order the buyer added them.
    const byStore = new Map<string, OrderLine[]>();
    for (const line of lines) {
      const bucket = byStore.get(line.product.storeId);
      if (bucket) bucket.push(line);
      else byStore.set(line.product.storeId, [line]);
    }

    const placed = await app.prisma
      .$transaction(async (tx) => {
        // Take the stock first. Anything that fails here fails the whole
        // checkout, before a payment row exists and before the basket is
        // emptied, so the buyer is exactly where they were. Always in the same
        // order, so two baskets sharing pieces wait for each other rather
        // than deadlock.
        const byVariant = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
        for (const line of byVariant) {
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
            pickupPointId: input.pickupPoint?.id ?? null,
            pickupPointName: input.pickupPoint?.name ?? null,
            recipientName: input.recipientName,
            recipientPhone: input.recipientPhone,
            deliveryNote: input.deliveryNote,
          },
        });

        const shares = apportion(
          deliveryCents,
          [...byStore.values()].map((bucket) => subtotalOf(bucket)),
        );

        const orderIds: string[] = [];
        let index = 0;

        for (const [storeId, bucket] of byStore.entries()) {
          const storeSubtotal = subtotalOf(bucket);
          const storeDelivery = shares[index] ?? 0;
          index += 1;

          const order = await tx.order.create({
            data: {
              reference: orderReference(),
              checkoutGroupId: group.id,
              buyerId: input.userId,
              storeId,
              channel: input.channel,
              status: 'PENDING_PAYMENT',
              subtotalCents: storeSubtotal,
              deliveryCents: storeDelivery,
              totalCents: storeSubtotal + storeDelivery,
              // Frozen now. Changing the fee next month must not rewrite what
              // a seller was owed for a sale they already made.
              platformFeeCents: Math.round((storeSubtotal * input.platformFeeBps) / 10_000),
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
            provider: this.gateway.provider,
            method: 'MPESA',
            status: 'PENDING',
            amountCents: totalCents,
            idempotencyKey,
            // Known before the provider is called, so a result can always be
            // matched to this row even if the charge call itself times out.
            providerRef: this.gateway.referenceFor(idempotencyKey),
            phone: input.payerPhone,
          },
          select: { id: true },
        });

        await input.inTransaction?.(tx);

        return { group, orderIds, paymentId: payment.id };
      })
      .catch(async (error: unknown) => {
        // Two requests with one key raced, and this one lost: the key is unique,
        // or the winner took the last piece. Everything here has rolled back,
        // so the buyer gets the winner's checkout rather than an error.
        const winner = await this.replay(idempotencyKey);
        if (winner) return winner;
        throw error;
      });

    if (!('group' in placed)) return placed;

    // Outside the transaction: a slow network call must not hold row locks.
    try {
      const buyer = await app.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true },
      });

      const result = await this.gateway.charge({
        amountCents: totalCents,
        phone: input.payerPhone,
        reference: `NIMA ${placed.group.id.slice(-6).toUpperCase()}`,
        description: input.description,
        idempotencyKey,
        callbackUrl: `${app.env.API_URL}/webhooks/${this.gateway.name.toLowerCase()}`,
        email: buyer?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email) ? buyer.email : null,
      });

      // A clear no from the provider: nothing was sent to the phone.
      if (result.status === 'FAILED') {
        const reason = result.failureReason ?? 'That payment did not go through. Try again.';
        await this.unwind(placed.group.id, reason);
        app.log.warn(
          { checkoutId: placed.group.id, provider: result.providerMessage ?? null },
          'The payment provider refused a charge',
        );
        throw errors.conflict(reason);
      }

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
      if (error instanceof AppError) throw error;

      // We cannot tell whether the prompt went out. Cancelling now could
      // strand a buyer who then pays, so the payment waits as PROCESSING and
      // the reconcile pass asks the provider what really happened.
      if (error instanceof PaymentGatewayError && error.ambiguous && this.gateway.referenceFor(idempotencyKey)) {
        app.log.warn(
          { err: error, checkoutId: placed.group.id },
          'The charge call had no clear answer; leaving it for reconcile',
        );
        await app.prisma.$transaction([
          app.prisma.payment.updateMany({
            where: { id: placed.paymentId, status: 'PENDING' },
            data: { status: 'PROCESSING' },
          }),
          app.prisma.checkoutGroup.updateMany({
            where: { id: placed.group.id, status: 'PENDING' },
            data: { status: 'PROCESSING' },
          }),
        ]);
        return {
          id: placed.group.id,
          status: 'PROCESSING',
          subtotalCents,
          deliveryCents,
          totalCents,
          orderIds: placed.orderIds,
          instruction: promptInstruction(input.payerPhone),
        };
      }

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
      instruction: promptInstruction(input.payerPhone),
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
      ((result.amountCents !== null && result.amountCents !== payment.amountCents) ||
        (result.currency != null && result.currency.toUpperCase() !== payment.currency))
    ) {
      app.log.error(
        {
          providerRef: result.providerRef,
          expected: payment.amountCents,
          got: result.amountCents,
          expectedCurrency: payment.currency,
          gotCurrency: result.currency ?? null,
        },
        'PAYMENT MISMATCH: a payment settled for the wrong amount or currency. Nothing was credited. Check it by hand.',
      );

      await this.unwind(
        group.id,
        'The amount paid did not match the order. Contact Nima support with your M-Pesa message.',
      );
      return { handled: true };
    }

    if (result.status !== 'SUCCEEDED') {
      const closed = await this.unwind(
        group.id,
        result.failureReason ?? 'The payment was not completed',
        result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      );
      // Someone else closed it first, and told the buyer.
      if (!closed) return { handled: false };

      await app.realtime.toUser(group.buyerId, {
        type: 'payment.status',
        checkoutId: group.id,
        status: result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        message: result.failureReason ?? 'The payment was not completed',
      });

      return { handled: true };
    }

    const paidAt = new Date();

    const claimed = await app.prisma.$transaction(async (tx) => {
      // The claim. A webhook and the reconcile pass can arrive together; the
      // row lock lets exactly one of them move the payment, and the other
      // finds nothing to do and credits nobody.
      const moved = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'SUCCEEDED' },
      });
      if (moved.count !== 1) return false;

      await tx.checkoutGroup.update({
        where: { id: group.id },
        data: { status: 'SUCCEEDED' },
      });

      const orders = await tx.order.findMany({
        where: { checkoutGroupId: group.id },
        select: {
          id: true,
          storeId: true,
          channel: true,
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

        // A booth sale leaves with the buyer, so there is nothing to book.
        if (order.channel !== 'BOOTH') {
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
      }

      return true;
    });

    if (!claimed) return { handled: false };

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
        channel: true,
        subtotalCents: true,
        store: { select: { ownerId: true } },
        _count: { select: { items: true } },
      },
    });
    for (const paid of paidOrders) {
      const booth = paid.channel === 'BOOTH';

      await notify(app, {
        userId: paid.store.ownerId,
        type: 'ORDER_PLACED',
        title: booth ? 'Paid, hand it over' : 'New order',
        body: `${booth ? 'Paid' : 'New order'} ${paid.reference}: ${paid._count.items} ${paid._count.items === 1 ? 'piece' : 'pieces'}, KSh ${Math.round(paid.subtotalCents / 100).toLocaleString('en-KE')}`,
        data: { orderId: paid.id, seller: true },
      });

      // Straight to the seller's open screen. The notification goes through
      // the worker, and a vendor with a buyer waiting should not depend on it.
      await app.realtime.toUser(paid.store.ownerId, {
        type: 'order.updated',
        orderId: paid.id,
        status: 'PAID',
      });
    }

    app.log.info(
      { checkoutId: group.id, orders: group.orders.length, feeBps: settings.platformFeeBps },
      'An order was paid',
    );

    return { handled: true };
  }

  /**
   * Put everything back. Returns false when someone else already did.
   *
   * Used when the push could not be sent and when the payment comes back
   * failed. Stock returns to the variant it came from, every order is
   * cancelled with a reason the buyer can read, and the group is closed.
   */
  async unwind(
    checkoutGroupId: string,
    reason: string,
    status: 'FAILED' | 'CANCELLED' = 'FAILED',
  ): Promise<boolean> {
    const { app } = this;

    return app.prisma.$transaction(async (tx) => {
      // Claim first. Whoever moves the payment out of waiting does the
      // unwinding; a second caller (a webhook racing the reconcile pass)
      // finds nothing to claim and returns stock to nobody twice.
      const claimed = await tx.payment.updateMany({
        where: { checkoutGroupId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status, failureReason: reason },
      });
      if (claimed.count === 0) return false;

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

      await tx.checkoutGroup.update({ where: { id: checkoutGroupId }, data: { status } });
      return true;
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
