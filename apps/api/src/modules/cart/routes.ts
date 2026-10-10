/**
 * The basket.
 *
 * An account is required. A guest can fill a basket in the app and it is
 * kept locally until they sign in, which is the brief's rule: browsing is
 * free, anything that becomes yours needs a name.
 */

import { addToCartSchema, cartSchema, idSchema, updateCartItemSchema } from '@nima/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CartService } from '../../services/cart.js';
import { recordEvent } from '../../services/events.js';

export function cartRoutes(cart: CartService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/cart',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['cart'],
          summary: 'What is in the basket',
          response: { 200: cartSchema },
        },
      },
      async (request) => cart.read(request.requireUser().id),
    );

    app.post(
      '/cart/items',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['cart'],
          summary: 'Add a size to the basket',
          description:
            'Adding the same variant twice increases the quantity. The whole cart ' +
            'comes back, so the app never has to guess what the totals became.',
          body: addToCartSchema,
          response: { 200: cartSchema },
        },
      },
      async (request) => {
        const user = request.requireUser();
        const updated = await cart.add(user.id, request.body.variantId, request.body.quantity);

        const variant = await app.prisma.productVariant.findUnique({
          where: { id: request.body.variantId },
          select: { productId: true, product: { select: { storeId: true } } },
        });

        if (variant) {
          void recordEvent(app, {
            request,
            type: 'ADD_TO_CART',
            entityType: 'product',
            entityId: variant.productId,
            storeId: variant.product.storeId,
            props: { quantity: request.body.quantity },
          });
        }

        return updated;
      },
    );

    app.patch(
      '/cart/items/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['cart'],
          summary: 'Change how many',
          params: z.object({ id: idSchema }),
          body: updateCartItemSchema,
          response: { 200: cartSchema },
        },
      },
      async (request) =>
        cart.setQuantity(request.requireUser().id, request.params.id, request.body.quantity),
    );

    app.delete(
      '/cart/items/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['cart'],
          summary: 'Take something out',
          params: z.object({ id: idSchema }),
          response: { 200: cartSchema },
        },
      },
      async (request) => cart.remove(request.requireUser().id, request.params.id),
    );

    app.get(
      '/cart/count',
      {
        preHandler: app.requireSession,
        schema: {
          tags: ['cart'],
          summary: 'How many things are in the basket',
          description: 'Used for the badge, so it stays cheap.',
          response: { 200: z.object({ count: z.number().int() }) },
        },
      },
      async (request) => {
        const user = request.user;
        if (!user || user.isAnonymous) return { count: 0 };
        return { count: await cart.count(user.id) };
      },
    );
  };
}
