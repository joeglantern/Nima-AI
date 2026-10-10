/**
 * Lookbooks: a set of looks kept together.
 *
 * A holiday, a wedding week, a capsule for the season. The planning fields,
 * `dayIndex` and `occasion`, are what separate this from a folder: a trip is
 * organised by day, and a day is what people actually pack for.
 *
 * An entry points at exactly one thing, a look, a product or something from
 * the wardrobe, which the database enforces with a check constraint rather
 * than trusting this code to get it right.
 */

import {
  addLookbookEntrySchema,
  createLookbookSchema,
  idSchema,
  lookbookEntrySchema,
  lookbookSchema,
  paginationQuerySchema,
} from '@nima/contracts';
import type { Prisma } from '@nima/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { lookbook, lookCard, productCard, wardrobeItem } from '../../lib/presenters.js';

const entryInclude = {
  look: {
    include: {
      owner: { include: { profile: true, store: true } },
      _count: { select: { items: true } },
    },
  },
  wardrobeItem: true,
} satisfies Prisma.LookbookEntryInclude;

export const lookbookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/lookbooks',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['lookbooks'],
        summary: 'Your lookbooks',
        querystring: paginationQuerySchema,
        response: {
          200: z.object({
            items: z.array(lookbookSchema),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { limit, cursor } = request.query;

      const rows = await app.prisma.lookbook.findMany({
        where: { ownerId: user.id },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { _count: { select: { entries: true } } },
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: items.map((row) => lookbook(app.storage, row)),
        nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    '/lookbooks',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['lookbooks'],
        summary: 'Start a lookbook',
        body: createLookbookSchema,
        response: { 201: lookbookSchema },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const created = await app.prisma.lookbook.create({
        data: {
          ownerId: user.id,
          title: request.body.title,
          description: request.body.description ?? null,
          occasion: request.body.occasion ?? null,
          visibility: request.body.visibility,
          startsOn: request.body.startsOn ? new Date(request.body.startsOn) : null,
          endsOn: request.body.endsOn ? new Date(request.body.endsOn) : null,
        },
        include: { _count: { select: { entries: true } } },
      });

      return reply.status(201).send(lookbook(app.storage, created));
    },
  );

  app.get(
    '/lookbooks/:id',
    {
      preHandler: app.requireSession,
      schema: {
        tags: ['lookbooks'],
        summary: 'One lookbook and what is in it',
        params: z.object({ id: idSchema }),
        response: {
          200: z.object({
            lookbook: lookbookSchema,
            entries: z.array(lookbookEntrySchema),
          }),
        },
      },
    },
    async (request) => {
      const viewer = request.user;

      const row = await app.prisma.lookbook.findUnique({
        where: { id: request.params.id },
        include: {
          _count: { select: { entries: true } },
          entries: { orderBy: [{ dayIndex: 'asc' }, { position: 'asc' }], include: entryInclude },
        },
      });

      if (!row) throw errors.notFound('That lookbook');

      // A private lookbook is the owner's alone. Anything else is readable,
      // which is what makes one shareable.
      const mine = viewer?.id === row.ownerId;
      if (!mine && row.visibility === 'PRIVATE') throw errors.notFound('That lookbook');

      // Products are resolved now rather than snapshotted, so a sold out
      // piece shows as sold out instead of as still available.
      const productIds = row.entries
        .map((entry) => entry.productId)
        .filter((id): id is string => Boolean(id));

      const products =
        productIds.length > 0
          ? await app.prisma.product.findMany({
              where: { id: { in: [...new Set(productIds)] } },
              include: { store: true, images: { take: 1, orderBy: { position: 'asc' } } },
            })
          : [];

      const byId = new Map(products.map((product) => [product.id, product]));

      return {
        lookbook: lookbook(app.storage, row),
        entries: await Promise.all(
          row.entries.map(async (entry) => {
            const product = entry.productId ? byId.get(entry.productId) : undefined;

            return {
              id: entry.id,
              dayIndex: entry.dayIndex,
              occasion: entry.occasion,
              note: entry.note,
              position: entry.position,
              look: entry.look ? lookCard(app.storage, entry.look) : null,
              product: product ? productCard(app.storage, product) : null,
              wardrobeItem: entry.wardrobeItem
                ? await wardrobeItem(app.storage, entry.wardrobeItem)
                : null,
            };
          }),
        ),
      };
    },
  );

  app.post(
    '/lookbooks/:id/entries',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['lookbooks'],
        summary: 'Put something in a lookbook',
        params: z.object({ id: idSchema }),
        body: addLookbookEntrySchema,
        response: { 201: z.object({ id: idSchema }) },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const book = await app.prisma.lookbook.findFirst({
        where: { id: request.params.id, ownerId: user.id },
        select: { id: true },
      });

      if (!book) throw errors.notFound('That lookbook');

      // Something you own, or something that is public. Adding a stranger's
      // private look would make it readable through the lookbook.
      if (request.body.lookId) {
        const look = await app.prisma.look.findUnique({
          where: { id: request.body.lookId },
          select: { ownerId: true, visibility: true },
        });

        if (!look || (look.ownerId !== user.id && look.visibility === 'PRIVATE')) {
          throw errors.notFound('That look');
        }
      }

      if (request.body.wardrobeItemId) {
        const owned = await app.prisma.wardrobeItem.findFirst({
          where: { id: request.body.wardrobeItemId, userId: user.id },
          select: { id: true },
        });

        if (!owned) throw errors.notFound('That item');
      }

      const last = await app.prisma.lookbookEntry.findFirst({
        where: { lookbookId: book.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      const entry = await app.prisma.lookbookEntry.create({
        data: {
          lookbookId: book.id,
          lookId: request.body.lookId ?? null,
          productId: request.body.productId ?? null,
          wardrobeItemId: request.body.wardrobeItemId ?? null,
          dayIndex: request.body.dayIndex ?? null,
          occasion: request.body.occasion ?? null,
          note: request.body.note ?? null,
          position: (last?.position ?? -1) + 1,
        },
        select: { id: true },
      });

      // The list is ordered by when a lookbook last changed, and adding
      // something to one is a change.
      await app.prisma.lookbook.update({
        where: { id: book.id },
        data: { updatedAt: new Date() },
      });

      return reply.status(201).send(entry);
    },
  );

  app.delete(
    '/lookbooks/:id/entries/:entryId',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['lookbooks'],
        summary: 'Take something out',
        params: z.object({ id: idSchema, entryId: idSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const entry = await app.prisma.lookbookEntry.findFirst({
        where: {
          id: request.params.entryId,
          lookbookId: request.params.id,
          lookbook: { ownerId: user.id },
        },
        select: { id: true },
      });

      if (!entry) throw errors.notFound('That item');

      await app.prisma.lookbookEntry.delete({ where: { id: entry.id } });
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/lookbooks/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['lookbooks'],
        summary: 'Delete a lookbook',
        description: 'The looks and products in it are not deleted, only the collection.',
        params: z.object({ id: idSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const book = await app.prisma.lookbook.findFirst({
        where: { id: request.params.id, ownerId: user.id },
        select: { id: true },
      });

      if (!book) throw errors.notFound('That lookbook');

      await app.prisma.lookbook.delete({ where: { id: book.id } });
      return reply.status(204).send(null);
    },
  );
};
