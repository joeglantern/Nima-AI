/**
 * Domain services, built once and hung off the app.
 *
 * Routes stay thin: they validate input, call a service, and shape the
 * response. Anything that could be reused by the worker lives in a service.
 */

import fp from 'fastify-plugin';
import { CreditsService } from '../services/credits.js';
import { SettingsService } from '../services/settings.js';

export interface Services {
  settings: SettingsService;
  credits: CreditsService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

export default fp(
  async (app) => {
    const settings = new SettingsService(app.prisma, app.redis);
    const credits = new CreditsService(app.prisma, settings);

    app.decorate('services', { settings, credits });

    // Another node changed the settings: drop the local cache.
    await app.redisSub.subscribe(SettingsService.invalidationChannel);
    app.redisSub.on('message', (channel) => {
      if (channel === SettingsService.invalidationChannel) settings.invalidate();
    });
  },
  { name: 'services', dependencies: ['core'] },
);
