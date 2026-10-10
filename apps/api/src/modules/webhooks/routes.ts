/**
 * Provider webhooks.
 *
 * These sit outside `/v1` and outside the session: the caller is Fingo, not
 * a person, and it proves itself with a signature over the exact bytes it
 * sent. That is why this route parses the body itself and keeps the raw
 * string: re-serialising parsed JSON changes whitespace and key order, and
 * the HMAC no longer matches.
 *
 * Three rules, all learned the expensive way:
 *
 *   1. **Every delivery is written down before it is acted on**, valid or
 *      not. When a buyer says they paid and the order says otherwise, the
 *      only useful thing is the exact payload that arrived.
 *   2. **A bad signature is recorded and then dropped.** Never processed,
 *      never answered with a clue about why.
 *   3. **Always answer 200 once the event is stored.** A provider that gets
 *      an error retries, often for days. Our own failure to process is our
 *      problem to fix from the stored row, not a reason to be hammered.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CheckoutService } from '../../services/checkout.js';
import type { PaymentGateway } from '../../services/payments/index.js';

export function webhookRoutes(
  checkout: CheckoutService,
  gateway: PaymentGateway,
): FastifyPluginAsyncZod {
  return async (app) => {
    // Scoped to this plugin: everywhere else the normal JSON parser applies.
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    );

    app.post(
      '/webhooks/fingo',
      {
        config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
        schema: {
          tags: ['webhooks'],
          summary: 'Payment result from Fingo',
          description:
            'Signed with HMAC SHA256 over the raw body, in the `x-fingo-signature` header. ' +
            'This is the only path that marks an order paid.',
          response: { 200: z.object({ received: z.literal(true) }) },
        },
      },
      async (request, reply) => {
        const raw = typeof request.body === 'string' ? request.body : '';
        const header = request.headers['x-fingo-signature'];
        const signature = Array.isArray(header) ? header[0] : header;

        const signatureOk = gateway.verifySignature(raw, signature);

        let payload: unknown = null;
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          payload = { unparseable: raw.slice(0, 2000) };
        }

        const parsed = signatureOk ? gateway.parseWebhook(payload) : null;

        // The provider's own event id makes a replay a no-op at the database
        // level rather than in our logic, which is the only version of this
        // that survives two API nodes receiving the same retry at once.
        const externalId = parsed?.externalId ?? null;

        if (externalId) {
          const seen = await app.prisma.webhookEvent.findUnique({
            where: { provider_externalId: { provider: 'fingo', externalId } },
            select: { id: true },
          });

          if (seen) return reply.status(200).send({ received: true as const });
        }

        const event = await app.prisma.webhookEvent.create({
          data: {
            provider: 'fingo',
            eventType: parsed?.status ?? null,
            signatureOk,
            externalId,
            payload: payload as never,
            // Only the headers that say what this is. The rest can carry
            // tokens, and a webhook log is not the place to keep those.
            headers: {
              'content-type': request.headers['content-type'] ?? null,
              'user-agent': request.headers['user-agent'] ?? null,
            } as never,
          },
          select: { id: true },
        });

        if (!signatureOk) {
          app.log.warn({ eventId: event.id }, 'A webhook arrived with a bad signature');
          return reply.status(200).send({ received: true as const });
        }

        if (!parsed) {
          await app.prisma.webhookEvent.update({
            where: { id: event.id },
            data: { processedAt: new Date(), error: 'The payload had no payment reference' },
          });
          return reply.status(200).send({ received: true as const });
        }

        try {
          const { handled } = await checkout.settle(parsed);

          await app.prisma.webhookEvent.update({
            where: { id: event.id },
            data: {
              processedAt: new Date(),
              error: handled ? null : 'Nothing to do: already settled, or unknown payment',
            },
          });
        } catch (error) {
          // The event is on record with the reason. Answering 200 stops the
          // retry storm; a person fixes it from the stored payload.
          app.log.error({ err: error, eventId: event.id }, 'Could not settle a payment');

          await app.prisma.webhookEvent.update({
            where: { id: event.id },
            data: { error: error instanceof Error ? error.message : 'unknown' },
          });
        }

        return reply.status(200).send({ received: true as const });
      },
    );
  };
}
