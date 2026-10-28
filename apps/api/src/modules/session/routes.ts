/**
 * Session: who am I, and what does the app need to boot.
 *
 * The app calls GET /v1/session/bootstrap once on launch. It returns the
 * viewer (guest or signed in), their credit balance, the feature flags and
 * the copy that must not be hard coded in the app, in one request. One round
 * trip on a slow connection matters more than tidy endpoint boundaries.
 */

import { sessionUserSchema } from '@nima/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { completionOf } from '../profile/completion.js';

const fitNotice = {
  title: 'This is a picture, not a fitting',
  body: "Nima shows you how something looks, not how it will fit. Check the seller's size guide before you buy.",
};

export const sessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/session/bootstrap',
    {
      schema: {
        tags: ['session'],
        summary: 'Everything the app needs on launch',
        description:
          'Works without a session. A visitor with no account gets `user: null` and can still browse.',
        response: {
          200: z.object({
            user: sessionUserSchema.nullable(),
            credits: z.object({
              balance: z.number().int(),
              freeWeeklyCredits: z.number().int(),
              nextGrantAt: z.string().nullable(),
            }),
            costs: z.record(z.string(), z.number().int()),
            features: z.object({
              checkout: z.boolean(),
              sellerDashboard: z.boolean(),
              directMessages: z.boolean(),
              ghostMannequin: z.boolean(),
              promotions: z.boolean(),
              /** Off until an image provider is set up, so nobody waits on a job that cannot run. */
              tryOn: z.boolean(),
            }),
            /** Only buttons for ways in that are set up get shown. */
            signIn: z.object({ google: z.boolean(), apple: z.boolean(), email: z.boolean() }),
            fitNotice: z.object({ title: z.string(), body: z.string() }),
          }),
        },
      },
    },
    async (request) => {
      const settings = await app.services.settings.get();

      const features = { ...settings.features, tryOn: Boolean(app.env.GEMINI_API_KEY) };

      const signIn = {
        google: Boolean(app.env.GOOGLE_CLIENT_ID && app.env.GOOGLE_CLIENT_SECRET),
        apple: Boolean(app.env.APPLE_CLIENT_ID && app.env.APPLE_CLIENT_SECRET),
        email: true,
      };

      if (!request.user) {
        return {
          user: null,
          credits: {
            balance: 0,
            freeWeeklyCredits: settings.freeWeeklyCredits,
            nextGrantAt: null,
          },
          costs: settings.creditCosts as unknown as Record<string, number>,
          features,
          signIn,
          fitNotice,
        };
      }

      const userId = request.user.id;

      const [balance, profile, styleProfile, store] = await Promise.all([
        app.services.credits.balanceFor(userId),
        app.prisma.profile.findUnique({ where: { userId } }),
        app.prisma.styleProfile.findUnique({ where: { userId } }),
        app.prisma.store.findUnique({ where: { ownerId: userId }, select: { id: true } }),
      ]);

      return {
        user: {
          id: userId,
          // The name they chose for their profile wins over whatever the
          // sign in provider had, which for an email code is nothing.
          name: profile?.displayName?.trim() || request.user.name?.trim() || '',
          email: request.user.email,
          isAnonymous: request.user.isAnonymous,
          role: request.user.role,
          handle: profile?.handle ?? null,
          avatarUrl: profile?.avatarKey ? app.storage.publicUrl(profile.avatarKey) : null,
          credits: balance.balance,
          hasStore: Boolean(store),
          styleProfileCompletion: completionOf(styleProfile),
        },
        credits: {
          balance: balance.balance,
          freeWeeklyCredits: balance.freeWeeklyCredits,
          nextGrantAt: balance.nextGrantAt?.toISOString() ?? null,
        },
        costs: settings.creditCosts as unknown as Record<string, number>,
        features,
        signIn,
        fitNotice,
      };
    },
  );

  app.post(
    '/session/guest',
    {
      schema: {
        tags: ['session'],
        summary: 'Notes about starting as a guest',
        description:
          'Guest accounts are created by Better Auth at POST /api/auth/sign-in/anonymous. ' +
          'This endpoint only reports whether the caller already has one.',
        response: {
          200: z.object({
            hasSession: z.boolean(),
            isAnonymous: z.boolean(),
            signInPath: z.string(),
          }),
        },
      },
    },
    async (request) => ({
      hasSession: Boolean(request.user),
      isAnonymous: request.user?.isAnonymous ?? false,
      signInPath: '/api/auth/sign-in/anonymous',
    }),
  );
};
