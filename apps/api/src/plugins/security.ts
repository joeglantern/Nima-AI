/**
 * CORS, headers, body limits and rate limiting.
 *
 * Rate limits are backed by Valkey so they hold across restarts and across
 * nodes. The old codebase configured a limiter and never applied it, which is
 * why the limits here are global with tighter per route overrides rather than
 * opt in.
 */

import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';

export default fp(
  async (app) => {
    const isDevelopment = app.env.NODE_ENV === 'development';

    await app.register(helmet, {
      // The API serves JSON and presigned redirects, not HTML pages. The
      // Swagger UI is the one exception and sets its own policy.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    });

    await app.register(cors, {
      origin(origin, callback) {
        // Native apps and server to server calls send no origin.
        if (!origin) return callback(null, true);

        const allowed =
          app.env.WEB_ORIGINS.includes(origin) ||
          origin.startsWith('nima://') ||
          (isDevelopment && /^(https?:\/\/localhost|exp:\/\/)/.test(origin));

        callback(null, allowed);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'expo-origin'],
      maxAge: 86_400,
    });

    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      redis: app.redis,
      nameSpace: 'nima:rl:',
      // Per user when signed in, per address otherwise.
      keyGenerator: (request) => request.user?.id ?? request.ip,
      // Health checks and the docs should never be throttled.
      allowList: (request) => request.url.startsWith('/health') || request.url.startsWith('/docs'),
      addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
    });

    // Shed load rather than fall over when the box is saturated.
    await app.register(underPressure, {
      maxEventLoopDelay: 2_000,
      maxHeapUsedBytes: 1_200 * 1024 * 1024,
      maxRssBytes: 1_800 * 1024 * 1024,
      retryAfter: 15,
      exposeStatusRoute: false,
      message: 'Nima is busy right now, try again in a moment',
    });
  },
  { name: 'security', dependencies: ['core', 'auth'] },
);
