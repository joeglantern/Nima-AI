/**
 * The wardrobe: clothes a person already owns.
 *
 * This is the half of Nima that is not a shop. A stylist who can only
 * suggest things you have to buy is a catalogue, so Ask Nima reads from here
 * and a look can mix what you own with what is for sale.
 *
 * Everything is private by default. A wardrobe is a photograph of the inside
 * of someone's house, and it becomes visible to anyone else only when they
 * change a setting and set an item to public.
 */

import {
  createWardrobeItemSchema,
  idSchema,
  paginationQuerySchema,
  productCategorySchema,
  updateWardrobeItemSchema,
  wardrobeItemSchema,
} from '@nima/contracts';
import type { Prisma } from '@nima/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { wardrobeItem } from '../../lib/presenters.js';

/**
 * Where a garment sits on the body, guessed from its category.
 *
 * The uploader can correct it, and the vision model overwrites it once the
 * photo has been through the media worker. This is only here so an item is
 * usable the second it is uploaded rather than after a round trip.
 */
function slotFor(category: string) {
  switch (category) {
    case 'BOTTOM':
      return 'BOTTOM' as const;
    case 'DRESS':
      return 'FULL_BODY' as const;
    case 'OUTERWEAR':
      return 'OUTERWEAR' as const;
    case 'SHOES':
      return 'SHOES' as const;
    case 'BAG':
      return 'BAG' as const;
    case 'JEWELLERY':
      return 'JEWELLERY' as const;
    case 'EYEWEAR':
      return 'EYEWEAR' as const;
    case 'HEADWEAR':
      return 'HEADWEAR' as const;
    default:
      return 'TOP' as const;
  }
}

export const wardrobeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/wardrobe',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['wardrobe'],
        summary: 'Clothes you own',
        querystring: paginationQuerySchema.extend({
          category: productCategorySchema.optional(),
        }),
        response: {
          200: z.object({
            items: z.array(wardrobeItemSchema),
            nextCursor: z.string().nullable(),
            counts: z.record(z.string(), z.number().int()),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { limit, cursor, category } = request.query;

      const where: Prisma.WardrobeItemWhereInput = {
        userId: user.id,
        ...(category ? { category } : {}),
      };

      const [rows, grouped] = await Promise.all([
        app.prisma.wardrobeItem.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
        // The filter row needs to know which categories have anything in
        // them, so it can show only those rather than ten empty tabs.
        app.prisma.wardrobeItem.groupBy({
          by: ['category'],
          where: { userId: user.id },
          _count: { _all: true },
        }),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: await Promise.all(items.map((row) => wardrobeItem(app.storage, row))),
        nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
        counts: Object.fromEntries(
          grouped.map((entry) => [entry.category, entry._count._all] as const),
        ),
      };
    },
  );

  app.post(
    '/wardrobe',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['wardrobe'],
        summary: 'Add something you own',
        description:
          'The photo is uploaded straight to storage first, through POST /v1/uploads. ' +
          'This records it and queues the cut-out and tagging.',
        body: createWardrobeItemSchema,
        response: { 201: wardrobeItemSchema },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const category = request.body.category ?? 'TOP';

      const created = await app.prisma.wardrobeItem.create({
        data: {
          userId: user.id,
          originalKey: request.body.storageKey,
          label: request.body.label ?? null,
          category,
          slot: request.body.slot ?? slotFor(category),
          visibility: request.body.visibility,
          processing: 'PENDING',
        },
      });

      // Background removal and tagging. If the queue is down the item is
      // still usable, just with the photo as it was taken.
      try {
        await app.queues.media.add('wardrobe', {
          kind: 'WARDROBE_INGEST' as const,
          storageKey: created.originalKey,
          target: { type: 'wardrobeItem' as const, id: created.id },
          userId: user.id,
        });
      } catch (error) {
        app.log.warn({ err: error, itemId: created.id }, 'Could not queue a wardrobe cut-out');
        await app.prisma.wardrobeItem.update({
          where: { id: created.id },
          data: { processing: 'NONE' },
        });
      }

      return reply.status(201).send(await wardrobeItem(app.storage, created));
    },
  );

  app.patch(
    '/wardrobe/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['wardrobe'],
        summary: 'Correct what something is',
        params: z.object({ id: idSchema }),
        body: updateWardrobeItemSchema,
        response: { 200: wardrobeItemSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();

      const existing = await app.prisma.wardrobeItem.findFirst({
        where: { id: request.params.id, userId: user.id },
        select: { id: true },
      });

      if (!existing) throw errors.notFound('That item');

      const updated = await app.prisma.wardrobeItem.update({
        where: { id: existing.id },
        data: {
          ...(request.body.label !== undefined ? { label: request.body.label } : {}),
          ...(request.body.category ? { category: request.body.category } : {}),
          ...(request.body.slot ? { slot: request.body.slot } : {}),
          ...(request.body.colours ? { colours: request.body.colours } : {}),
          ...(request.body.tags ? { tags: request.body.tags } : {}),
          ...(request.body.visibility ? { visibility: request.body.visibility } : {}),
        },
      });

      return wardrobeItem(app.storage, updated);
    },
  );

  app.delete(
    '/wardrobe/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['wardrobe'],
        summary: 'Throw something out',
        description: 'The photograph goes too. Deleting means deleting.',
        params: z.object({ id: idSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const existing = await app.prisma.wardrobeItem.findFirst({
        where: { id: request.params.id, userId: user.id },
        select: { id: true, originalKey: true, cutoutKey: true },
      });

      if (!existing) throw errors.notFound('That item');

      await app.prisma.wardrobeItem.delete({ where: { id: existing.id } });

      // The row is gone either way. A storage error here must not leave a
      // ghost item in the list, so it is logged rather than thrown.
      for (const key of [existing.originalKey, existing.cutoutKey]) {
        if (!key) continue;
        await app.storage.remove(key).catch((error: unknown) => {
          app.log.error({ err: error, key }, 'Could not delete a wardrobe photo');
        });
      }

      return reply.status(204).send(null);
    },
  );
};
