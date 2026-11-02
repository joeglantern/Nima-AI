/**
 * Booth sales.
 *
 * A guest points a phone at a shop's QR at an event and lands on that shop's
 * page. Everything before paying works without an account, because the sign in
 * belongs at the moment someone decides to buy. The result of a payment arrives
 * the usual way: `payment.status` on the socket, or `GET /v1/checkout/:id`.
 */

import { boothPageSchema, checkoutSchema, startBoothCheckoutSchema } from '@nima/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { renderBoothBoard } from '../../lib/booth-board.js';
import { errors } from '../../lib/errors.js';
import { publicImage, storeCard } from '../../lib/presenters.js';
import type { CheckoutService } from '../../services/checkout.js';
import { recordEvent } from '../../services/events.js';

const slugParams = z.object({ slug: z.string().min(2).max(40) });

export function boothRoutes(checkout: CheckoutService): FastifyPluginAsyncZod {
  return async (app) => {
    /** Built from configuration, so a new public address only needs an env change. */
    const boothUrl = (slug: string) =>
      `${app.env.API_URL.replace(/\/+$/, '')}/booth/${encodeURIComponent(slug)}`;

    app.get(
      '/booth/:slug',
      {
        schema: {
          tags: ['booth'],
          summary: 'A shop and its pieces, for the page behind a booth QR',
          params: slugParams,
          response: { 200: boothPageSchema },
        },
      },
      async (request) => {
        const store = await app.prisma.store.findUnique({ where: { slug: request.params.slug } });
        if (!store) throw errors.notFound('That shop');

        const [products, paymentsOpen, lastPayment] = await Promise.all([
          app.prisma.product.findMany({
            where: { storeId: store.id, status: 'ACTIVE' },
            orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
            take: 200,
            include: {
              images: { orderBy: { position: 'asc' }, take: 1 },
              variants: { where: { isActive: true }, orderBy: { priceCents: 'asc' } },
            },
          }),
          checkout.paymentsOpen(),
          request.user && !request.user.isAnonymous
            ? app.prisma.payment.findFirst({
                where: { checkoutGroup: { buyerId: request.user.id }, phone: { not: null } },
                orderBy: { createdAt: 'desc' },
                select: { phone: true },
              })
            : null,
        ]);

        return {
          store: storeCard(app.storage, store),
          paymentsOpen,
          payerPhone: lastPayment?.phone ?? null,
          url: boothUrl(store.slug),
          items: products
            .filter((product) => product.variants.length > 0)
            .map((product) => {
              const first = product.images[0];
              const variants = product.variants.map((variant) => ({
                id: variant.id,
                size: variant.size,
                colour: variant.colour,
                priceCents: variant.priceCents,
                inStock: variant.stock > 0,
              }));

              return {
                id: product.id,
                title: product.title,
                image: first
                  ? publicImage(
                      app.storage,
                      first.processedKey ?? first.originalKey,
                      first.width,
                      first.height,
                    )
                  : null,
                priceFromCents: Math.min(...variants.map((variant) => variant.priceCents)),
                inStock: variants.some((variant) => variant.inStock),
                variants,
              };
            }),
        };
      },
    );

    app.post(
      '/booth/:slug/checkout',
      {
        preHandler: app.requireAccount,
        // Takes stock and sends a prompt to a phone, the same as any checkout.
        config: { rateLimit: { max: 8, timeWindow: '5 minutes' } },
        schema: {
          tags: ['booth'],
          summary: 'Buy from a booth and send the M-Pesa prompt',
          description:
            'Takes the items from the request and leaves the basket alone. No delivery: the ' +
            'buyer collects on the spot. Returns once the prompt is on its way. Nothing is ' +
            'paid yet: watch the socket for `payment.status`, or poll the checkout.',
          params: slugParams,
          body: startBoothCheckoutSchema,
          response: { 200: checkoutSchema },
        },
      },
      async (request) => {
        const user = request.requireUser();

        const result = await checkout.startBooth({
          userId: user.id,
          slug: request.params.slug,
          items: request.body.items,
          payerPhone: request.body.payerPhone,
          idempotencyKey: request.body.idempotencyKey,
        });

        void recordEvent(app, {
          request,
          type: 'BEGIN_CHECKOUT',
          entityType: 'product',
          entityId: result.id,
          props: { totalCents: result.totalCents, orders: result.orderIds.length, booth: true },
        });

        return result;
      },
    );

    /*
     * The board a vendor prints. Public on purpose: it holds nothing that is
     * not already on the booth table, and a plain link saves from any browser.
     */
    app.get(
      '/booth/:slug/board.png',
      {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['booth'],
          summary: 'The printable scan to pay board for a shop, A5 at 300 dpi',
          params: slugParams,
          querystring: z.object({ download: z.enum(['1']).optional() }),
        },
      },
      async (request, reply) => {
        const store = await app.prisma.store.findUnique({
          where: { slug: request.params.slug },
          select: { name: true, slug: true },
        });
        if (!store) throw errors.notFound('That shop');

        const png = await renderBoothBoard({ name: store.name, url: boothUrl(store.slug) });

        reply.type('image/png').header('cache-control', 'public, max-age=300');
        if (request.query.download) {
          reply.header(
            'content-disposition',
            `attachment; filename="nima-booth-${store.slug.replace(/[^a-z0-9-]/gi, '')}.png"`,
          );
        }
        return reply.send(png);
      },
    );
  };
}
