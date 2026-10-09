/**
 * For You and Explore.
 *
 * Open to guests. A guest is personalised from their session behaviour, which
 * the app sends as an anonymous id header, so the feed is useful before
 * anyone signs up.
 *
 * The response mixes looks with occasional product shelves and, for signed in
 * users with gaps in their setup, a single prompt card. Prompts are hints,
 * never gates.
 */

import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { feedItemSchema, feedQuerySchema } from '@nima/contracts';
import { decodeCursor, encodeCursor } from '../../lib/pagination.js';
import { lookCard, productCard } from '../../lib/presenters.js';
import { FeedService } from '../../services/feed.js';
import { recordEvent } from '../../services/events.js';

export const feedRoutes: FastifyPluginAsyncZod = async (app) => {
  const feed = new FeedService(app);

  app.get(
    '/feed',
    {
      schema: {
        tags: ['feed'],
        summary: 'For You, Explore or Following',
        description:
          'Works without an account. Send `x-nima-anon-id` so a guest still gets ' +
          'personalisation from what they have looked at in this session.',
        querystring: feedQuerySchema,
        response: {
          200: z.object({
            items: z.array(feedItemSchema),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const { surface, limit, occasion } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const seenIds = cursor ? cursor.key.split(',').filter(Boolean) : [];

      const anonHeader = request.headers['x-nima-anon-id'];
      const anonId = (Array.isArray(anonHeader) ? anonHeader[0] : anonHeader) ?? null;

      const scored = await feed.build(
        { userId: request.user?.id ?? null, anonId },
        { surface, limit, occasion, excludeIds: seenIds },
      );

      const lookIds = scored.map((entry) => entry.look.id);
      const [likes, saves] = await Promise.all([
        request.user
          ? app.prisma.like.findMany({
              where: { userId: request.user.id, lookId: { in: lookIds } },
              select: { lookId: true },
            })
          : [],
        request.user
          ? app.prisma.save.findMany({
              where: { userId: request.user.id, lookId: { in: lookIds } },
              select: { lookId: true },
            })
          : [],
      ]);

      const likedIds = new Set(likes.map((like) => like.lookId));
      const savedIds = new Set(saves.map((save) => save.lookId));

      const items: Array<z.infer<typeof feedItemSchema>> = scored.map((entry) => ({
        kind: 'look' as const,
        look: lookCard(app.storage, entry.look, {
          likedByMe: likedIds.has(entry.look.id),
          savedByMe: savedIds.has(entry.look.id),
        }),
      }));

      // A shelf of new arrivals every eight cards keeps shopping present
      // without turning the feed into a catalogue.
      if (items.length >= 4) {
        const products = await app.prisma.product.findMany({
          where: { status: 'ACTIVE', inStock: true },
          orderBy: { publishedAt: 'desc' },
          take: 10,
          include: { store: true, images: { take: 1, orderBy: { position: 'asc' } } },
        });

        if (products.length >= 4) {
          items.splice(4, 0, {
            kind: 'shelf' as const,
            title: 'New in',
            subtitle: 'Just listed by Nima sellers',
            products: products.map((product) => productCard(app.storage, product)),
          });
        }
      }

      const prompt = await nextPrompt(app, request.user?.id ?? null);
      if (prompt) items.splice(Math.min(2, items.length), 0, prompt);

      // Record impressions so the next page does not repeat them.
      for (const entry of scored) {
        void recordEvent(app, {
          request,
          type: 'VIEW',
          entityType: 'look',
          entityId: entry.look.id,
          props: { surface, reason: entry.reason },
        });
      }

      const nextSeen = [...seenIds, ...lookIds].slice(-120);

      return {
        items,
        nextCursor:
          scored.length === limit ? encodeCursor({ key: nextSeen.join(','), id: 'feed' }) : null,
      };
    },
  );
};

/**
 * One nudge at a time, in the order that unlocks the most value: finish the
 * questionnaire, add a photo, try something on, open a store.
 */
async function nextPrompt(
  app: Parameters<FastifyPluginAsyncZod>[0],
  userId: string | null,
): Promise<z.infer<typeof feedItemSchema> | null> {
  if (!userId) return null;

  const [style, photo, tryOn] = await Promise.all([
    app.prisma.styleProfile.findUnique({ where: { userId }, select: { completedSteps: true } }),
    app.prisma.userPhoto.findFirst({ where: { userId }, select: { id: true } }),
    app.prisma.tryOnJob.findFirst({ where: { userId, status: 'DONE' }, select: { id: true } }),
  ]);

  if (!style || style.completedSteps.length < 3) {
    return {
      kind: 'prompt' as const,
      promptKey: 'questionnaire' as const,
      title: 'Tell Nima what you like',
      body: 'A few quick questions and your feed starts matching your taste.',
      ctaLabel: 'Start',
    };
  }

  if (!photo) {
    return {
      kind: 'prompt' as const,
      promptKey: 'add_photo' as const,
      title: 'Add a photo of yourself',
      body: 'Then you can see any of these looks on you.',
      ctaLabel: 'Add photo',
    };
  }

  if (!tryOn) {
    return {
      kind: 'prompt' as const,
      promptKey: 'first_tryon' as const,
      title: 'Try something on',
      body: 'Pick a look you like and see it on you in about a minute.',
      ctaLabel: 'Show me how',
    };
  }

  return null;
}
