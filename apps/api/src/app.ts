/**
 * Builds the Fastify instance.
 *
 * Kept separate from server.ts so tests can build an app, inject requests and
 * close it without binding a port.
 */

import { randomUUID } from 'node:crypto';
import { type Env, loadEnv } from '@nima/config';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandler } from './lib/errors.js';
import { runWithRequestHost } from './lib/request-host.js';
import { healthRoutes } from './modules/health/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';
import authPlugin from './plugins/auth.js';
import corePlugin, { type CorePluginOptions } from './plugins/core.js';
import docsPlugin from './plugins/docs.js';
import queuesPlugin from './plugins/queues.js';
import realtimePlugin from './plugins/realtime.js';
import securityPlugin from './plugins/security.js';
import servicesPlugin from './plugins/services.js';
import { registerRoutes } from './routes.js';
import { startDeletionSweep } from './services/deletion.js';

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

  // Before anything builds a URL: which host did this caller use. See
  // lib/request-host.ts for why a phone needs this and a browser does not.
  app.addHook('onRequest', (request, _reply, done) => {
    runWithRequestHost(request.hostname.replace(/:\d+$/, ''), done);
  });

  await app.register(corePlugin, { ...options, env });
  await app.register(servicesPlugin);
  await app.register(queuesPlugin);
  await app.register(authPlugin);
  await app.register(securityPlugin);
  await app.register(realtimePlugin);
  await app.register(docsPlugin);

  // Health sits at the root: load balancers and uptime checks should not have
  // to know about API versions.
  await app.register(healthRoutes);

  // Nor do payment providers. The webhook URL is registered with Fingo and
  // is not ours to version. It is also the one route that reads a raw body,
  // which is why it registers its own parser inside its own plugin scope.
  await app.register(webhookRoutes(app.services.checkout, app.services.payments));

  await app.register(registerRoutes, { prefix: '/v1' });

  // Echo the request id back so a user can quote it in a support message.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Accounts past their deletion grace period are erased on a timer.
  startDeletionSweep(app);

  await app.ready();
  return app;
}
