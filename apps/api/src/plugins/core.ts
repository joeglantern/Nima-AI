/**
 * Core decorators: configuration, database, Valkey, mail and storage.
 *
 * Registered first, so every later plugin and route can reach them through
 * the Fastify instance rather than importing singletons. That is what makes
 * the app testable: a test builds an app with its own connections.
 */

import type { Env } from '@nima/config';
import { createPrismaClient, type PrismaClient } from '@nima/db';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { createMailer, type Mailer } from '../lib/mailer.js';
import { createStorage, type Storage } from '../lib/storage.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    prisma: PrismaClient;
    /** Commands, caching and rate limiting. */
    redis: Redis;
    /** A second connection, used only for pub/sub subscriptions. */
    redisSub: Redis;
    mailer: Mailer;
    storage: Storage;
  }
}

export interface CorePluginOptions {
  env: Env;
  /** Tests inject their own instances. */
  prisma?: PrismaClient;
  redis?: Redis;
  redisSub?: Redis;
  mailer?: Mailer;
  storage?: Storage;
}

export default fp<CorePluginOptions>(
  async (app, options) => {
    const { env } = options;

    const prisma =
      options.prisma ??
      createPrismaClient({
        databaseUrl: env.DATABASE_URL,
        log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });

    const redis = options.redis ?? new Redis(env.REDIS_URL, { lazyConnect: false });
    const redisSub = options.redisSub ?? new Redis(env.REDIS_URL, { lazyConnect: false });

    redis.on('error', (error) => app.log.error({ err: error }, 'Valkey connection error'));
    redisSub.on('error', (error) => app.log.error({ err: error }, 'Valkey subscriber error'));

    app.decorate('env', env);
    app.decorate('prisma', prisma);
    app.decorate('redis', redis);
    app.decorate('redisSub', redisSub);
    app.decorate('mailer', options.mailer ?? createMailer(env));
    app.decorate('storage', options.storage ?? createStorage(env));

    app.addHook('onClose', async () => {
      await Promise.allSettled([prisma.$disconnect(), redis.quit(), redisSub.quit()]);
    });
  },
  { name: 'core' },
);
