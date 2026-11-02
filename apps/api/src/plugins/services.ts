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
import { PaymentSync, startPaymentReconcile } from '../services/payment-sync.js';
import {
  canVerify,
  createPaymentGateway,
  type PaymentGateway,
} from '../services/payments/index.js';
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
  /** Confirms payments and refunds with Paystack. */
  paymentSync: PaymentSync;
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
    const paymentSync = new PaymentSync(app, payments, checkout);

    app.decorate('services', { settings, credits, cart, checkout, payments, paymentSync });

    if (!payments.configured) {
      app.log.warn(
        'No payment credentials, so checkout will refuse to start. ' +
          'Set PAYSTACK_SECRET_KEY to take money.',
      );
    }

    if (canVerify(payments)) {
      const production = app.env.NODE_ENV === 'production';
      if (production && !payments.live) {
        app.log.warn('Paystack is using a TEST key in production. No real money will move.');
      } else if (!production && payments.live) {
        app.log.warn('Paystack is using a LIVE key outside production. Real money will move.');
      }
      startPaymentReconcile(app, paymentSync, app.env.PAYMENT_RECONCILE_SECONDS);
    }

    // Another node changed the settings: drop the local cache.
    await app.redisSub.subscribe(SettingsService.invalidationChannel);
    app.redisSub.on('message', (channel) => {
      if (channel === SettingsService.invalidationChannel) settings.invalidate();
    });
  },
  { name: 'services', dependencies: ['core'] },
);
