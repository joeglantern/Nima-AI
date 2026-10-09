/**
 * Route table.
 *
 * Everything is mounted under /v1. Auth is the exception: Better Auth owns
 * /api/auth/*, and health sits at the root so uptime checks need not know
 * about versions.
 *
 * Modules are listed in the order a person meets them: look around, set
 * yourself up, try things on, then buy.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sessionRoutes } from './modules/session/routes.js';
import { feedRoutes } from './modules/feed/routes.js';
import { shopRoutes } from './modules/shop/routes.js';
import { lookRoutes } from './modules/looks/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { creditRoutes } from './modules/credits/routes.js';
import { tryOnRoutes } from './modules/tryon/routes.js';
import { TryOnService } from './services/tryon.js';

export const registerRoutes: FastifyPluginAsync = async (app) => {
  const tryOn = new TryOnService(app, app.queues);

  const modules: FastifyPluginAsyncZod[] = [
    sessionRoutes,
    feedRoutes,
    shopRoutes,
    lookRoutes,
    profileRoutes,
    creditRoutes,
    tryOnRoutes(tryOn),
  ];

  for (const module of modules) {
    await app.register(module);
  }
};
