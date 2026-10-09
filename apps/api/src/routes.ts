/**
 * Route table.
 *
 * Everything is mounted under /v1. Auth endpoints are the exception: Better
 * Auth owns /api/auth/* and is registered in the auth plugin.
 *
 * Modules are registered in the order a user meets them.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sessionRoutes } from './modules/session/routes.js';
import { creditRoutes } from './modules/credits/routes.js';

export const registerRoutes: FastifyPluginAsync = async (app) => {
  const modules: FastifyPluginAsyncZod[] = [
    sessionRoutes,
    creditRoutes,
  ];

  for (const module of modules) {
    await app.register(module);
  }
};
