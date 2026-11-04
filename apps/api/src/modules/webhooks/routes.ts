/**
 * Provider webhooks.
 *
 * These sit outside `/v1` and outside the session: the caller is PaySasa
 * or Paystack (or Fingo, in the test scripts), not a person, and it proves
 * itself with a signature over the exact bytes it sent. That is why this
 * route parses the body itself and keeps the raw string: re-serialising
 * parsed JSON changes whitespace and key order, and the HMAC no longer
 * matches.
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

import { Prisma } from '@nima/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CheckoutService } from '../../services/checkout.js';
import { canVerify, FingoGateway, type PaymentGateway } from '../../services/payments/index.js';
import { redactPayload } from '../../services/payments/words.js';

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return { unparseable: raw.toString('utf8').slice(0, 2000) };
  }
}

/** The two verifying providers, each on its own path with its own header. */
const PROVIDERS = [
  {
    provider: 'paysasa',
    path: '/webhooks/paysasa',
    header: 'x-paysasa-signature',
    summary: 'Events from PaySasa',
    description:
      'Signed with HMAC SHA256 of the raw body, keyed with the webhook secret, in the ' +
      '`x-paysasa-signature` header. A webhook is only a prompt: the session is read ' +
      'back from PaySasa before anything is marked paid.',
    rate: 600,
  },
  {
    provider: 'paystack',
    path: '/webhooks/paystack',
    header: 'x-paystack-signature',
    summary: 'Events from Paystack',
    description:
      'Signed with HMAC SHA512 of the raw body, keyed with the secret key, in the ' +
      '`x-paystack-signature` header. A webhook is only a prompt: the payment is ' +
      'confirmed with Transaction Verify before anything is marked paid.',
    rate: 600,
  },
] as const;

export function webhookRoutes(
  checkout: CheckoutService,
  gateway: PaymentGateway,
): FastifyPluginAsyncZod {
  return async (app) => {
    // Scoped to this plugin: everywhere else the normal JSON parser applies.
    // Kept as the exact bytes received, because the signature is over those.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );

    for (const spec of PROVIDERS) {
      app.post(
        spec.path,
        {
          config: { rateLimit: { max: spec.rate, timeWindow: '1 minute' } },
          schema: {
            tags: ['webhooks'],
            summary: spec.summary,
            description: spec.description,
            response: { 200: z.object({ received: z.literal(true) }) },
          },
        },
        async (request, reply) => {
          const ok = { received: true as const };
          const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
          const header = request.headers[spec.header];
          const signature = Array.isArray(header) ? header[0] : header;

          // Only the provider in use can sign anything. A webhook for the
          // other one is written down and dropped, like a bad signature.
          const active = canVerify(gateway) && gateway.webhookProvider === spec.provider;
          const signatureOk = active && gateway.verifySignature(raw, signature);
          const payload = parseJson(raw);
          const notice = signatureOk && canVerify(gateway) ? gateway.parseWebhook(payload) : null;
          const externalId = notice?.externalId ?? null;

          // A repeat of an event we finished is dropped. One that failed half
          // way is processed again, which is safe: every step is idempotent.
          let eventId: string | null = null;
          if (externalId) {
            const seen = await app.prisma.webhookEvent.findUnique({
              where: { provider_externalId: { provider: spec.provider, externalId } },
              select: { id: true, processedAt: true, error: true },
            });
            if (seen?.processedAt && !seen.error) return reply.status(200).send(ok);
            eventId = seen?.id ?? null;
          }

          if (!eventId) {
            try {
              const created = await app.prisma.webhookEvent.create({
                data: {
                  provider: spec.provider,
                  eventType: notice?.event ?? null,
                  signatureOk,
                  externalId,
                  // Phone numbers masked and card tokens dropped. The rest is
                  // kept as it came, for support questions.
                  payload: redactPayload(payload) as never,
                  headers: {
                    'content-type': request.headers['content-type'] ?? null,
                    'user-agent': request.headers['user-agent'] ?? null,
                    // Compare with the provider's published addresses when in doubt.
                    ip: request.ip,
                  } as never,
                },
                select: { id: true },
              });
              eventId = created.id;
            } catch (error) {
              // The same event on two nodes at once. The other one has it.
              if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return reply.status(200).send(ok);
              }
              throw error;
            }
          }

          if (!signatureOk) {
            app.log.warn(
              { eventId, provider: spec.provider },
              'A webhook arrived with a bad signature',
            );
            return reply.status(200).send(ok);
          }

          if (!notice || notice.kind === 'other') {
            await app.prisma.webhookEvent.update({
              where: { id: eventId },
              data: {
                processedAt: new Date(),
                error: notice ? null : 'The payload had no reference',
              },
            });
            return reply.status(200).send(ok);
          }

          try {
            let note: string | null = null;
            if (notice.kind === 'charge') {
              const outcome = await app.services.paymentSync.confirm(notice.reference, 'webhook');
              if (outcome === 'ignored') note = 'Not a payment Nima is waiting on';
              if (outcome === 'mismatch') note = 'Verify did not match; nothing credited';
              // Left open, so a retry of this event is looked at again.
              if (outcome === 'waiting') note = 'Verify does not show it paid yet';
            } else {
              const open = await app.services.paymentSync.onRefundWebhook(notice.reference);
              if (open > 0) note = 'The provider does not show the refund finished yet';
            }

            await app.prisma.webhookEvent.update({
              where: { id: eventId },
              data: { processedAt: new Date(), error: note },
            });
          } catch (error) {
            // On record, unprocessed. The reconcile pass and the provider's
            // own retry both come back to it.
            app.log.error(
              { err: error, eventId, provider: spec.provider },
              'Could not act on a webhook',
            );
            await app.prisma.webhookEvent.update({
              where: { id: eventId },
              data: { error: error instanceof Error ? error.message.slice(0, 500) : 'unknown' },
            });
          }

          return reply.status(200).send(ok);
        },
      );
    }

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
        const raw = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
        const header = request.headers['x-fingo-signature'];
        const signature = Array.isArray(header) ? header[0] : header;

        // Only when Fingo is the provider in use. With PaySasa or Paystack
        // configured this path takes nothing in.
        const signatureOk =
          gateway instanceof FingoGateway && gateway.verifySignature(raw, signature);

        let payload: unknown = null;
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          payload = { unparseable: raw.slice(0, 2000) };
        }

        const parsed =
          signatureOk && gateway instanceof FingoGateway ? gateway.parseWebhook(payload) : null;

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
