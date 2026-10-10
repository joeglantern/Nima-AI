/**
 * Checkout and orders.
 *
 * Starting a checkout returns as soon as the M-Pesa prompt is on its way.
 * The result arrives on the WebSocket as `payment.status`, and `GET
 * /v1/checkout/:id` is there for the case the socket dropped while the buyer
 * was in the SIM toolkit, which on a Kenyan network is not rare.
 */

import {
  checkoutSchema,
  deliveryQuoteSchema,
  idSchema,
  orderListQuerySchema,
  orderSchema,
  pickupPointSchema,
  startCheckoutSchema,
} from '@nima/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { order as presentOrder } from '../../lib/presenters.js';
import { type CheckoutService, listPickupPoints, orderInclude } from '../../services/checkout.js';
import { recordEvent } from '../../services/events.js';

export function checkoutRoutes(checkout: CheckoutService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/delivery/pickup-points',
      {
        schema: {
          tags: ['checkout'],
          summary: 'Where an order can be collected',
          querystring: z.object({ county: z.string().optional() }),
          response: { 200: z.object({ items: z.array(pickupPointSchema) }) },
        },
      },
      async (request) => {
        const points = await listPickupPoints(app);

        return {
          items: request.query.county
            ? points.filter(
                (point) => point.county.toLowerCase() === request.query.county?.toLowerCase(),
              )
            : points,
        };
      },
    );

    app.get(
      '/delivery/quote',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['checkout'],
          summary: 'What delivery will cost for this basket',
          querystring: z.object({
            method: z.enum(['PICKUP_POINT', 'DOORSTEP']).default('PICKUP_POINT'),
            pickupPointId: z.string().optional(),
          }),
          response: { 200: deliveryQuoteSchema },
        },
      },
      async (request) => {
        const settings = await app.services.settings.get();
        const { subtotalCents } = await app.services.cart.read(request.requireUser().id);
        const { delivery } = settings;

        const free = delivery.freeOverCents > 0 && subtotalCents >= delivery.freeOverCents;
        const costCents = free
          ? 0
          : request.query.method === 'DOORSTEP'
            ? delivery.doorstepCents
            : delivery.pickupPointCents;

        return {
          method: request.query.method,
          pickupPointId: request.query.pickupPointId ?? null,
          costCents,
          estimate:
            request.query.method === 'DOORSTEP'
              ? 'Two to three days in Nairobi, three to five upcountry'
              : 'Ready to collect in one to two days',
        };
      },
    );

    app.post(
      '/checkout',
      {
        preHandler: app.requireAccount,
        // Starting a checkout takes stock and sends a prompt to a phone.
        // Neither is something to let a loop do.
        config: { rateLimit: { max: 8, timeWindow: '5 minutes' } },
        schema: {
          tags: ['checkout'],
          summary: 'Place the order and send the M-Pesa prompt',
          description:
            'Returns once the prompt is on its way. Nothing is paid yet: watch ' +
            'the socket for `payment.status`, or poll this checkout.',
          body: startCheckoutSchema,
          response: { 200: checkoutSchema },
        },
      },
      async (request) => {
        const user = request.requireUser();

        const result = await checkout.start({
          userId: user.id,
          deliveryMethod: request.body.deliveryMethod,
          pickupPointId: request.body.pickupPointId,
          recipientName: request.body.recipientName,
          recipientPhone: request.body.recipientPhone,
          deliveryNote: request.body.deliveryNote,
          payerPhone: request.body.payerPhone,
        });

        void recordEvent(app, {
          request,
          type: 'BEGIN_CHECKOUT',
          entityType: 'product',
          entityId: result.id,
          props: { totalCents: result.totalCents, orders: result.orderIds.length },
        });

        return result;
      },
    );

    app.get(
      '/checkout/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['checkout'],
          summary: 'How the payment is going',
          params: z.object({ id: idSchema }),
          response: { 200: checkoutSchema },
        },
      },
      async (request) => {
        const user = request.requireUser();

        const group = await app.prisma.checkoutGroup.findFirst({
          where: { id: request.params.id, buyerId: user.id },
          include: {
            orders: { select: { id: true } },
            payments: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        });

        if (!group) throw errors.notFound('That checkout');

        const payment = group.payments[0];

        return {
          id: group.id,
          status: group.status,
          subtotalCents: group.subtotalCents,
          deliveryCents: group.deliveryCents,
          totalCents: group.totalCents,
          orderIds: group.orders.map((entry) => entry.id),
          instruction:
            group.status === 'SUCCEEDED'
              ? 'Paid. The shop is getting your order ready.'
              : group.status === 'PROCESSING' || group.status === 'PENDING'
                ? 'Waiting for the M-Pesa prompt to be completed.'
                : (payment?.failureReason ?? 'That payment did not go through.'),
        };
      },
    );

    app.get(
      '/orders',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['orders'],
          summary: 'Your orders',
          querystring: orderListQuerySchema,
          response: {
            200: z.object({ items: z.array(orderSchema), nextCursor: z.string().nullable() }),
          },
        },
      },
      async (request) => {
        const user = request.requireUser();
        const { limit, cursor, status } = request.query;

        const rows = await app.prisma.order.findMany({
          where: {
            buyerId: user.id,
            ...(status ? { status } : {}),
            // An order that never got paid is not something to show someone.
            // It is a basket that did not work, and the stock is already back.
            NOT: { status: 'CANCELLED', paidAt: null },
          },
          orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: orderInclude,
        });

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;

        return {
          items: items.map((row) => presentOrder(app.storage, row)),
          nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
        };
      },
    );

    app.get(
      '/orders/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['orders'],
          summary: 'One order',
          params: z.object({ id: idSchema }),
          response: { 200: orderSchema },
        },
      },
      async (request) => {
        const user = request.requireUser();

        const row = await app.prisma.order.findFirst({
          where: { id: request.params.id, buyerId: user.id },
          include: orderInclude,
        });

        if (!row) throw errors.notFound('That order');
        return presentOrder(app.storage, row);
      },
    );
  };
}
