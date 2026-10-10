/**
 * Domain services, built once and hung off the app.
 *
 * Routes stay thin: they validate input, call a service, and shape the
 * response. Anything that could be reused by the worker lives in a service.
 */

import fp from 'fastify-plugin';
import { CartService } from '../services/cart.js';
import { CheckoutService } from '../services/checkout.js';
import { CreditsService } from '../services/credits.js';
import { createPaymentGateway, type PaymentGateway } from '../services/payments/index.js';
import { SettingsService } from '../services/settings.js';

export interface Services {
  settings: SettingsService;
  credits: CreditsService;
  cart: CartService;
  checkout: CheckoutService;
  /**
   * Exposed because the webhook route needs to verify a signature with the
   * same gateway that signed the request, and it is mounted at the root
   * rather than inside the versioned route tree.
   */
  payments: PaymentGateway;
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
    const cart = new CartService(app.prisma, app.storage);
    const payments = createPaymentGateway(app.env);
    const checkout = new CheckoutService(app, payments);

    app.decorate('services', { settings, credits, cart, checkout, payments });

    if (!payments.configured) {
      app.log.warn(
        'No payment credentials, so checkout will refuse to start. ' +
          'Set FINGO_API_KEY and FINGO_WEBHOOK_SECRET to take money.',
      );
    }

    // Another node changed the settings: drop the local cache.
    await app.redisSub.subscribe(SettingsService.invalidationChannel);
    app.redisSub.on('message', (channel) => {
      if (channel === SettingsService.invalidationChannel) settings.invalidate();
    });
  },
  { name: 'services', dependencies: ['core'] },
);
