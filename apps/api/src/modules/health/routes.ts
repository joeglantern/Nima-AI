/**
 * Health and readiness.
 *
 *   /health        is the process alive         (no dependencies touched)
 *   /health/ready  can it serve traffic         (database, Valkey, storage)
 *
 * Uptime Kuma watches /health/ready. The reverse proxy watches /health.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const checkSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int(),
  detail: z.string().optional(),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness',
        response: {
          200: z.object({
            status: z.literal('ok'),
            uptimeSeconds: z.number().int(),
            version: z.string(),
          }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '0.1.0',
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness, including dependencies',
        response: {
          200: z.object({
            status: z.enum(['ok', 'degraded']),
            checks: z.object({
              database: checkSchema,
              redis: checkSchema,
              storage: checkSchema,
            }),
          }),
          503: z.object({
            status: z.literal('down'),
            checks: z.object({
              database: checkSchema,
              redis: checkSchema,
              storage: checkSchema,
            }),
          }),
        },
      },
    },
    async (_request, reply) => {
      const timed = async (run: () => Promise<void>) => {
        const started = Date.now();
        try {
          await run();
          return { ok: true, latencyMs: Date.now() - started };
        } catch (error) {
          return {
            ok: false,
            latencyMs: Date.now() - started,
            detail: error instanceof Error ? error.message : 'unknown',
          };
        }
      };

      const [database, redis, storage] = await Promise.all([
        timed(async () => {
          await app.prisma.$queryRaw`SELECT 1`;
        }),
        timed(async () => {
          await app.redis.ping();
        }),
        // Storage is checked by listing a key that does not exist: cheap, and
        // it proves credentials and connectivity.
        timed(async () => {
          await app.storage.exists('health-check');
        }),
      ]);

      const checks = { database, redis, storage };

      // The database and Valkey are required. Storage being down degrades
      // uploads but the feed still works, so it does not fail readiness.
      if (!database.ok || !redis.ok) {
        return reply.status(503).send({ status: 'down' as const, checks });
      }

      return reply.send({
        status: storage.ok ? ('ok' as const) : ('degraded' as const),
        checks,
      });
    },
  );
};
