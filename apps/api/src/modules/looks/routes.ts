/**
 * Looks and the social actions on them.
 *
 * Visibility is checked on every read: a private look is visible only to its
 * owner, a followers-only look to accepted followers. Try-on results are
 * created private and stay private until the owner chooses otherwise, which
 * the brief requires.
 */

import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  commentSchema,
  createCommentSchema,
  createLookSchema,
  dismissSchema,
  idSchema,
  lookCardSchema,
  lookDetailSchema,
  okSchema,
  paginationQuerySchema,
  shareLinkSchema,
  updateLookSchema,
} from '@nima/contracts';
import { errors } from '../../lib/errors.js';
import { lookAuthor, lookCard, productCard, publicImage } from '../../lib/presenters.js';
import { recordEvent } from '../../services/events.js';
import { canView } from './visibility.js';

export const lookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/looks/:id',
    {
      schema: {
        tags: ['looks'],
        summary: 'One look, with everything in it',
        params: z.object({ id: idSchema }),
        response: { 200: lookDetailSchema },
      },
    },
    async (request) => {
      const viewerId = request.user?.id ?? null;

      const look = await app.prisma.look.findUnique({
        where: { id: request.params.id },
        include: {
          owner: { include: { profile: true, store: true } },
          _count: { select: { items: true, comments: true } },
          items: {
            orderBy: { position: 'asc' },
            include: {
              product: {
                include: { store: true, images: { take: 1, orderBy: { position: 'asc' } } },
              },
              wardrobeItem: true,
            },
          },
          recreatedFrom: { include: { owner: { include: { profile: true, store: true } } } },
        },
      });

      if (!look) throw errors.notFound('That look');
      if (!(await canView(app, look, viewerId))) throw errors.notFound('That look');

      const [liked, saved] = await Promise.all([
        viewerId
          ? app.prisma.like.findUnique({
              where: { userId_lookId: { userId: viewerId, lookId: look.id } },
            })
          : null,
        viewerId
          ? app.prisma.save.findUnique({
              where: { userId_lookId: { userId: viewerId, lookId: look.id } },
            })
          : null,
      ]);

      void recordEvent(app, {
        request,
        type: 'VIEW',
        entityType: 'look',
        entityId: look.id,
      });

      const shopTotal = look.items.reduce(
        (total, item) => total + (item.product?.priceFromCents ?? 0),
        0,
      );

      return {
        ...lookCard(app.storage, look, {
          likedByMe: Boolean(liked),
          savedByMe: Boolean(saved),
        }),
        items: look.items.map((item) => ({
          id: item.id,
          slot: item.slot as never,
          product: item.product ? productCard(app.storage, item.product) : null,
          wardrobeItem: item.wardrobeItem
            ? {
                id: item.wardrobeItem.id,
                label: item.wardrobeItem.label,
                category: item.wardrobeItem.category as never,
                image: publicImage(
                  app.storage,
                  item.wardrobeItem.cutoutKey ?? item.wardrobeItem.originalKey,
                ),
              }
            : null,
        })),
        shopTotalCents: shopTotal > 0 ? shopTotal : null,
        recreatedFrom: look.recreatedFrom
          ? {
              id: look.recreatedFrom.id,
              author: lookAuthor(app.storage, look.recreatedFrom.owner),
            }
          : null,
        commentCount: look._count.comments,
      };
    },
  );

  app.post(
    '/looks',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['looks'],
        summary: 'Build a look by hand',
        description:
          'Combines products and wardrobe items. Set generateImage to also render it on ' +
          'your photo, which costs credits and returns a job.',
        body: createLookSchema,
        response: { 201: lookCardSchema.extend({ jobId: idSchema.nullable() }) },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const body = request.body;

      for (const item of body.items) {
        const sources = [item.productId, item.wardrobeItemId].filter(Boolean).length;
        if (sources !== 1) {
          throw errors.badRequest('Each item is either a product or something from your wardrobe');
        }
      }

      // Everything referenced must exist and, for wardrobe items, be yours.
      const wardrobeIds = body.items
        .map((item) => item.wardrobeItemId)
        .filter((id): id is string => Boolean(id));

      if (wardrobeIds.length > 0) {
        const owned = await app.prisma.wardrobeItem.count({
          where: { id: { in: wardrobeIds }, userId: user.id },
        });
        if (owned !== wardrobeIds.length) {
          throw errors.forbidden('One of those wardrobe items is not yours');
        }
      }

      const look = await app.prisma.look.create({
        data: {
          ownerId: user.id,
          title: body.title ?? null,
          caption: body.caption ?? null,
          source: 'USER',
          visibility: body.visibility,
          publishedAt: body.visibility === 'PUBLIC' ? new Date() : null,
          items: {
            create: body.items.map((item, index) => ({
              slot: item.slot,
              productId: item.productId ?? null,
              variantId: item.variantId ?? null,
              wardrobeItemId: item.wardrobeItemId ?? null,
              position: index,
            })),
          },
        },
        include: {
          owner: { include: { profile: true, store: true } },
          _count: { select: { items: true } },
        },
      });

      return reply.status(201).send({
        ...lookCard(app.storage, look),
        // Image generation is queued by the try-on module, which owns the
        // credit charge. The app calls POST /tryon with this look id.
        jobId: null,
      });
    },
  );

  app.patch(
    '/looks/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['looks'],
        summary: 'Rename a look or change who can see it',
        params: z.object({ id: idSchema }),
        body: updateLookSchema,
        response: { 200: lookCardSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const existing = await app.prisma.look.findUnique({ where: { id: request.params.id } });

      if (!existing || existing.ownerId !== user.id) throw errors.notFound('That look');

      const becomingPublic =
        request.body.visibility === 'PUBLIC' && existing.visibility !== 'PUBLIC';

      const look = await app.prisma.look.update({
        where: { id: existing.id },
        data: {
          ...request.body,
          ...(becomingPublic ? { publishedAt: new Date() } : {}),
        },
        include: {
          owner: { include: { profile: true, store: true } },
          _count: { select: { items: true } },
        },
      });

      return lookCard(app.storage, look);
    },
  );

  app.delete(
    '/looks/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['looks'],
        summary: 'Delete a look',
        params: z.object({ id: idSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const look = await app.prisma.look.findUnique({ where: { id: request.params.id } });

      if (!look || look.ownerId !== user.id) throw errors.notFound('That look');

      await app.prisma.look.delete({ where: { id: look.id } });
      if (look.coverKey) {
        try {
          await app.storage.remove(look.coverKey);
        } catch (error) {
          request.log.warn({ err: error }, 'Could not delete the look image');
        }
      }

      return reply.status(204).send(null);
    },
  );

  // ------------------------------------------------------- social actions ---

  app.post(
    '/looks/:id/like',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['looks'],
        summary: 'Like, or unlike if already liked',
        params: z.object({ id: idSchema }),
        response: { 200: z.object({ liked: z.boolean(), likeCount: z.number().int() }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const lookId = request.params.id;

      const look = await app.prisma.look.findUnique({ where: { id: lookId } });
      if (!look || !(await canView(app, look, user.id))) throw errors.notFound('That look');

      const existing = await app.prisma.like.findUnique({
        where: { userId_lookId: { userId: user.id, lookId } },
      });

      const liked = await app.prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.like.delete({ where: { id: existing.id } });
          await tx.look.update({ where: { id: lookId }, data: { likeCount: { decrement: 1 } } });
          return false;
        }

        await tx.like.create({ data: { userId: user.id, lookId } });
        await tx.look.update({ where: { id: lookId }, data: { likeCount: { increment: 1 } } });
        return true;
      });

      void recordEvent(app, {
        request,
        type: liked ? 'LIKE' : 'UNLIKE',
        entityType: 'look',
        entityId: lookId,
      });

      const updated = await app.prisma.look.findUnique({
        where: { id: lookId },
        select: { likeCount: true },
      });

      return { liked, likeCount: updated?.likeCount ?? 0 };
    },
  );

  app.post(
    '/looks/:id/save',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['looks'],
        summary: 'Save, or remove from saved',
        params: z.object({ id: idSchema }),
        response: { 200: z.object({ saved: z.boolean() }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const lookId = request.params.id;

      const look = await app.prisma.look.findUnique({ where: { id: lookId } });
      if (!look || !(await canView(app, look, user.id))) throw errors.notFound('That look');

      const existing = await app.prisma.save.findUnique({
        where: { userId_lookId: { userId: user.id, lookId } },
      });

      if (existing) {
        await app.prisma.save.delete({ where: { id: existing.id } });
        await app.prisma.look.update({
          where: { id: lookId },
          data: { saveCount: { decrement: 1 } },
        });
        return { saved: false };
      }

      await app.prisma.save.create({ data: { userId: user.id, lookId } });
      await app.prisma.look.update({ where: { id: lookId }, data: { saveCount: { increment: 1 } } });

      void recordEvent(app, { request, type: 'SAVE', entityType: 'look', entityId: lookId });

      return { saved: true };
    },
  );

  app.post(
    '/looks/:id/not-for-me',
    {
      preHandler: app.requireSession,
      schema: {
        tags: ['looks'],
        summary: 'Not for me',
        description: 'A strong negative signal. The look stops appearing in this feed.',
        params: z.object({ id: idSchema }),
        body: dismissSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();

      await app.prisma.dismissal.upsert({
        where: { userId_lookId: { userId: user.id, lookId: request.params.id } },
        create: {
          userId: user.id,
          lookId: request.params.id,
          reason: request.body.reason ?? null,
        },
        update: { reason: request.body.reason ?? null },
      });

      void recordEvent(app, {
        request,
        type: 'DISMISS',
        entityType: 'look',
        entityId: request.params.id,
        props: { reason: request.body.reason },
      });

      return { ok: true as const };
    },
  );

  app.get(
    '/looks/:id/share-link',
    {
      preHandler: app.requireSession,
      schema: {
        tags: ['looks'],
        summary: 'A link to share, with WhatsApp ready text',
        params: z.object({ id: idSchema }),
        response: { 200: shareLinkSchema },
      },
    },
    async (request) => {
      const look = await app.prisma.look.findUnique({
        where: { id: request.params.id },
        include: { owner: { include: { profile: true } } },
      });

      if (!look) throw errors.notFound('That look');

      const url = `${app.env.API_URL.replace('/api', '')}/l/${look.id}`;
      const who = look.owner?.profile?.displayName;

      return {
        url,
        message: who
          ? `${who} put this look together on Nima. You can try it on yourself: ${url}`
          : `Look what I found on Nima. Try it on yourself: ${url}`,
      };
    },
  );

  // ------------------------------------------------------------ comments ---

  app.get(
    '/looks/:id/comments',
    {
      schema: {
        tags: ['looks'],
        summary: 'Comments on a look',
        params: z.object({ id: idSchema }),
        querystring: paginationQuerySchema,
        response: {
          200: z.object({ items: z.array(commentSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      const viewerId = request.user?.id ?? null;

      const look = await app.prisma.look.findUnique({ where: { id: request.params.id } });
      if (!look || !(await canView(app, look, viewerId))) throw errors.notFound('That look');

      const rows = await app.prisma.comment.findMany({
        where: { lookId: look.id, parentId: null, hiddenAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          author: { include: { profile: true, store: true } },
          _count: { select: { replies: true } },
        },
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: items.map((comment) => ({
          id: comment.id,
          body: comment.body,
          author: lookAuthor(app.storage, comment.author) ?? {
            id: comment.authorId,
            handle: 'someone',
            displayName: 'Someone',
            avatar: null,
            store: null,
          },
          parentId: comment.parentId,
          replyCount: comment._count.replies,
          createdAt: comment.createdAt.toISOString(),
          mine: comment.authorId === viewerId,
        })),
        nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    '/looks/:id/comments',
    {
      preHandler: app.requireAccount,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['looks'],
        summary: 'Write a comment',
        params: z.object({ id: idSchema }),
        body: createCommentSchema,
        response: { 201: commentSchema },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const look = await app.prisma.look.findUnique({ where: { id: request.params.id } });
      if (!look || !(await canView(app, look, user.id))) throw errors.notFound('That look');

      const comment = await app.prisma.comment.create({
        data: {
          lookId: look.id,
          authorId: user.id,
          body: request.body.body.trim(),
          parentId: request.body.parentId ?? null,
        },
        include: {
          author: { include: { profile: true, store: true } },
          _count: { select: { replies: true } },
        },
      });

      if (look.ownerId && look.ownerId !== user.id) {
        await app.prisma.notification.create({
          data: {
            userId: look.ownerId,
            type: 'LOOK_COMMENT',
            title: 'New comment',
            body: `${comment.author.profile?.displayName ?? 'Someone'} commented on your look`,
            data: { lookId: look.id, commentId: comment.id },
          },
        });

        await app.realtime.toUser(look.ownerId, {
          type: 'notification.new',
          id: comment.id,
          kind: 'LOOK_COMMENT',
          title: 'New comment',
          body: `${comment.author.profile?.displayName ?? 'Someone'} commented on your look`,
        });
      }

      return reply.status(201).send({
        id: comment.id,
        body: comment.body,
        author: lookAuthor(app.storage, comment.author) ?? {
          id: user.id,
          handle: 'you',
          displayName: user.name,
          avatar: null,
          store: null,
        },
        parentId: comment.parentId,
        replyCount: 0,
        createdAt: comment.createdAt.toISOString(),
        mine: true,
      });
    },
  );
};
