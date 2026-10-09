/**
 * Builds the Fastify instance.
 *
 * Kept separate from server.ts so tests can build an app, inject requests and
 * close it without binding a port.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { loadEnv, type Env } from '@nima/config';
import corePlugin, { type CorePluginOptions } from './plugins/core.js';
import authPlugin from './plugins/auth.js';
import securityPlugin from './plugins/security.js';
import realtimePlugin from './plugins/realtime.js';
import docsPlugin from './plugins/docs.js';
import servicesPlugin from './plugins/services.js';
import { registerErrorHandler } from './lib/errors.js';
import { registerRoutes } from './routes.js';
import { healthRoutes } from './modules/health/routes.js';

export interface BuildAppOptions extends Partial<CorePluginOptions> {
  env?: Env;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();
  const isDevelopment = env.NODE_ENV === 'development';

  const app = Fastify({
    loggerInstance: undefined,
    logger: {
      level: env.LOG_LEVEL,
      ...(isDevelopment
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.otp',
        ],
        remove: true,
      },
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url,
          // The full address is personal data. The subnet is enough to spot
          // abuse patterns in logs.
          ip: request.ip?.replace(/\.\d+$/, '.x'),
        }),
      },
    },
    // Trust the reverse proxy in production so rate limits see the real client.
    trustProxy: !isDevelopment,
    genReqId: (request) => (request.headers['x-request-id'] as string) ?? randomUUID(),
    bodyLimit: 1024 * 1024, // 1MB. Images go straight to storage, not through here.
    disableRequestLogging: false,
    ajv: { customOptions: { coerceTypes: false } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  await app.register(corePlugin, { ...options, env });
  await app.register(servicesPlugin);
  await app.register(authPlugin);
  await app.register(securityPlugin);
  await app.register(realtimePlugin);
  await app.register(docsPlugin);

  // Health sits at the root: load balancers and uptime checks should not have
  // to know about API versions.
  await app.register(healthRoutes);
  await app.register(registerRoutes, { prefix: '/v1' });

  // Echo the request id back so a user can quote it in a support message.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.ready();
  return app;
}
