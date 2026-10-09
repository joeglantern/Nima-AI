/**
 * Credits: balance, what things cost, packs to buy, and history.
 *
 * Buying is split by platform. Apple requires in app purchase for digital
 * goods, which is exactly what the previous app was rejected for, so iOS gets
 * product ids and a receipt endpoint while Android and web get an M-Pesa
 * prompt.
 */

import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { creditEntrySchema, creditPackSchema, paginationQuerySchema } from '@nima/contracts';

export const creditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/credits',
    {
      preHandler: app.requireSession,
      schema: {
        tags: ['credits'],
        summary: 'Balance and what it buys',
        response: {
          200: z.object({
            balance: z.number().int(),
            freeWeeklyCredits: z.number().int(),
            nextGrantAt: z.string().nullable(),
            costs: z.record(z.string(), z.number().int()),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const [balance, settings] = await Promise.all([
        app.services.credits.balanceFor(user.id),
        app.services.settings.get(),
      ]);

      return {
        balance: balance.balance,
        freeWeeklyCredits: balance.freeWeeklyCredits,
        nextGrantAt: balance.nextGrantAt?.toISOString() ?? null,
        costs: settings.creditCosts as unknown as Record<string, number>,
      };
    },
  );

  app.get(
    '/credits/packs',
    {
      schema: {
        tags: ['credits'],
        summary: 'Packs available on this platform',
        querystring: z.object({ platform: z.enum(['IOS', 'ANDROID', 'WEB']).default('ANDROID') }),
        response: {
          200: z.object({
            packs: z.array(creditPackSchema),
            /** iOS must use Apple in app purchase for credits. */
            paymentMethod: z.enum(['MPESA', 'IN_APP_PURCHASE']),
            note: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const settings = await app.services.settings.get();
      const isIos = request.query.platform === 'IOS';

      return {
        packs: settings.creditPacks.map((pack) => ({
          key: pack.key,
          credits: pack.credits,
          priceCents: isIos ? (pack.iosPriceCents ?? pack.priceCents) : pack.priceCents,
          bestValue: pack.bestValue,
          productIdIos: pack.productIdIos ?? null,
        })),
        paymentMethod: isIos ? ('IN_APP_PURCHASE' as const) : ('MPESA' as const),
        note: isIos
          ? 'Apple handles the payment inside the App Store.'
          : 'You will get an M-Pesa prompt on your phone.',
      };
    },
  );

  app.get(
    '/credits/history',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['credits'],
        summary: 'Where the credits went',
        querystring: paginationQuerySchema,
        response: {
          200: z.object({
            items: z.array(creditEntrySchema),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { limit, cursor } = request.query;

      const rows = await app.services.credits.history(user.id, limit, cursor);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: page.map((row) => ({
          id: row.id,
          delta: row.delta,
          reason: row.reason,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
};
