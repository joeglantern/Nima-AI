/**
 * Ask Nima endpoints.
 *
 * Posting a message returns immediately. The reply streams over the
 * WebSocket as `stylist.delta` frames, then `stylist.done`, which is what
 * makes it feel like someone typing rather than a form submission.
 */

import {
  askNimaResponseSchema,
  askNimaSchema,
  idSchema,
  paginationQuerySchema,
  stylistMessageSchema,
  stylistThreadSchema,
  suggestedPromptSchema,
} from '@nima/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { productCard } from '../../lib/presenters.js';
import { recordEvent } from '../../services/events.js';
import type { StylistService } from '../../services/stylist/index.js';
import { SUGGESTED_PROMPTS } from '../../services/stylist/prompt.js';

export function stylistRoutes(stylist: StylistService): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/stylist/ask',
      {
        preHandler: app.requireAccount,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['stylist'],
          summary: 'Ask Nima something',
          description:
            'Returns as soon as the question is accepted. Watch the WebSocket for ' +
            '`stylist.delta`, `stylist.tool` and `stylist.done`.',
          body: askNimaSchema,
          response: { 202: askNimaResponseSchema },
        },
      },
      async (request, reply) => {
        const user = request.requireUser();

        const result = await stylist.ask({
          userId: user.id,
          threadId: request.body.threadId,
          message: request.body.message,
          context: request.body.context,
        });

        void recordEvent(app, {
          request,
          type: 'CHAT_MESSAGE',
          entityType: 'thread',
          entityId: result.threadId,
        });

        return reply.status(202).send({
          threadId: result.threadId,
          messageId: result.messageId,
          accepted: true as const,
        });
      },
    );

    app.get(
      '/stylist/threads',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['stylist'],
          summary: 'Past conversations',
          querystring: paginationQuerySchema,
          response: {
            200: z.object({
              items: z.array(stylistThreadSchema),
              nextCursor: z.string().nullable(),
            }),
          },
        },
      },
      async (request) => {
        const user = request.requireUser();
        const { limit, cursor } = request.query;

        const rows = await app.prisma.stylistThread.findMany({
          where: { userId: user.id },
          orderBy: { updatedAt: 'desc' },
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } },
          },
        });

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;

        return {
          items: items.map((thread) => ({
            id: thread.id,
            title: thread.title,
            updatedAt: thread.updatedAt.toISOString(),
            lastMessage: thread.messages[0]?.content.slice(0, 120) ?? null,
          })),
          nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
        };
      },
    );

    app.get(
      '/stylist/threads/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['stylist'],
          summary: 'One conversation',
          params: z.object({ id: idSchema }),
          response: { 200: z.object({ messages: z.array(stylistMessageSchema) }) },
        },
      },
      async (request) => {
        const user = request.requireUser();

        const thread = await app.prisma.stylistThread.findFirst({
          where: { id: request.params.id, userId: user.id },
          include: { messages: { orderBy: { createdAt: 'asc' }, take: 100 } },
        });

        if (!thread) throw errors.notFound('That conversation');

        // Products are stored as ids and resolved now, so a sold out item
        // never shows a stale price in an old conversation.
        const productIds = thread.messages.flatMap((message) => {
          const refs = message.refs as { productIds?: string[] } | null;
          return refs?.productIds ?? [];
        });

        const products =
          productIds.length > 0
            ? await app.prisma.product.findMany({
                where: { id: { in: [...new Set(productIds)] } },
                include: { store: true, images: { take: 1, orderBy: { position: 'asc' } } },
              })
            : [];

        const byId = new Map(products.map((product) => [product.id, product]));

        return {
          messages: thread.messages.map((message) => {
            const refs = message.refs as { productIds?: string[] } | null;

            return {
              id: message.id,
              role: message.role as never,
              content: message.content,
              products: (refs?.productIds ?? [])
                .map((id) => byId.get(id))
                .filter((product): product is NonNullable<typeof product> => Boolean(product))
                .map((product) => productCard(app.storage, product)),
              looks: [],
              createdAt: message.createdAt.toISOString(),
            };
          }),
        };
      },
    );

    app.get(
      '/stylist/prompts',
      {
        schema: {
          tags: ['stylist'],
          summary: 'Opening suggestions',
          response: { 200: z.object({ items: z.array(suggestedPromptSchema) }) },
        },
      },
      async () => ({
        items: SUGGESTED_PROMPTS.map((prompt) => ({
          label: prompt.label,
          message: prompt.message,
          icon: null,
        })),
      }),
    );

    app.delete(
      '/stylist/threads/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['stylist'],
          summary: 'Delete a conversation',
          params: z.object({ id: idSchema }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const user = request.requireUser();

        const thread = await app.prisma.stylistThread.findFirst({
          where: { id: request.params.id, userId: user.id },
          select: { id: true },
        });

        if (!thread) throw errors.notFound('That conversation');

        await app.prisma.stylistThread.delete({ where: { id: thread.id } });
        return reply.status(204).send(null);
      },
    );
  };
}
