/**
 * Virtual try-on.
 *
 * Every response here is a job, never an image. The picture arrives on the
 * WebSocket when it is ready, which keeps the request fast and lets the app
 * show honest progress.
 *
 * The fit notice is attached to every result: Nima guarantees the picture,
 * not the fit.
 */

import {
  idSchema,
  paginationQuerySchema,
  startTryOnResponseSchema,
  startTryOnSchema,
  tryOnJobSchema,
} from '@nima/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { privateImage } from '../../lib/presenters.js';
import { recordEvent } from '../../services/events.js';
import type { TryOnService } from '../../services/tryon.js';

export function tryOnRoutes(tryOn: TryOnService): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/tryon',
      {
        preHandler: app.requireAccount,
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          tags: ['tryon'],
          summary: 'See something on yourself',
          description: [
            'Charges credits and queues the image. Listen on the WebSocket for',
            '`tryon.progress` and `tryon.done`.',
            '',
            'Needs a real account and at least one photo. A guest gets',
            '`401 account_required`, which the app turns into the sign up sheet.',
          ].join('\n'),
          body: startTryOnSchema,
          response: { 202: startTryOnResponseSchema },
        },
      },
      async (request, reply) => {
        const user = request.requireUser();
        const body = request.body;

        const result = await tryOn.start(
          {
            userId: user.id,
            kind: body.kind,
            photoId: body.photoId,
            items: body.items,
            sourceKey: body.sourceKey,
            parentJobId: body.parentJobId,
            lookId: body.lookId,
            instruction: body.instruction,
          },
          request,
        );

        for (const item of body.items) {
          if (item.productId) {
            void recordEvent(app, {
              request,
              type: 'TRY_ON',
              entityType: 'product',
              entityId: item.productId,
            });
          }
        }

        const job = await app.prisma.tryOnJob.findUniqueOrThrow({ where: { id: result.jobId } });

        await app.realtime.toUser(user.id, {
          type: 'tryon.queued',
          jobId: job.id,
          position: result.queuePosition,
          estimatedSeconds: result.estimatedSeconds,
        });

        return reply.status(202).send({
          job: {
            id: job.id,
            kind: job.kind as never,
            status: job.status as never,
            image: null,
            lookId: job.lookId,
            creditsCharged: job.creditsCharged,
            queuePosition: result.queuePosition,
            estimatedSeconds: result.estimatedSeconds,
            error: null,
            instruction: body.instruction ?? null,
            parentJobId: job.parentJobId,
            createdAt: job.queuedAt.toISOString(),
            finishedAt: null,
          },
          creditsRemaining: result.creditsRemaining,
        });
      },
    );

    app.get(
      '/tryon/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['tryon'],
          summary: 'Check one job',
          description: 'For clients that cannot hold a WebSocket open.',
          params: z.object({ id: idSchema }),
          response: { 200: tryOnJobSchema },
        },
      },
      async (request) => {
        const user = request.requireUser();
        const job = await app.prisma.tryOnJob.findUnique({ where: { id: request.params.id } });

        if (!job || job.userId !== user.id) throw errors.notFound('That try-on');

        const inputs = job.inputs as { instruction?: string | null } | null;

        return {
          id: job.id,
          kind: job.kind as never,
          status: job.status as never,
          image: await privateImage(app.storage, job.resultKey),
          lookId: job.lookId,
          creditsCharged: job.creditsCharged,
          queuePosition: null,
          estimatedSeconds: null,
          error: job.error,
          instruction: inputs?.instruction ?? null,
          parentJobId: job.parentJobId,
          createdAt: job.queuedAt.toISOString(),
          finishedAt: job.finishedAt?.toISOString() ?? null,
        };
      },
    );

    app.get(
      '/tryon',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['tryon'],
          summary: 'Your try-ons, newest first',
          querystring: paginationQuerySchema,
          response: {
            200: z.object({
              items: z.array(tryOnJobSchema),
              nextCursor: z.string().nullable(),
            }),
          },
        },
      },
      async (request) => {
        const user = request.requireUser();
        const { limit, cursor } = request.query;

        const rows = await app.prisma.tryOnJob.findMany({
          where: { userId: user.id },
          orderBy: { queuedAt: 'desc' },
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;

        return {
          items: await Promise.all(
            items.map(async (job) => ({
              id: job.id,
              kind: job.kind as never,
              status: job.status as never,
              image: await privateImage(app.storage, job.resultKey),
              lookId: job.lookId,
              creditsCharged: job.creditsCharged,
              queuePosition: null,
              estimatedSeconds: null,
              error: job.error,
              instruction: (job.inputs as { instruction?: string | null })?.instruction ?? null,
              parentJobId: job.parentJobId,
              createdAt: job.queuedAt.toISOString(),
              finishedAt: job.finishedAt?.toISOString() ?? null,
            })),
          ),
          nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
        };
      },
    );

    app.delete(
      '/tryon/:id',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['tryon'],
          summary: 'Stop a try-on that has not started',
          description:
            'Refunds the credits. A job already being made cannot be stopped, because ' +
            'the image is being paid for either way.',
          params: z.object({ id: idSchema }),
          response: { 200: z.object({ creditsRefunded: z.number().int() }) },
        },
      },
      async (request) => tryOn.cancel(request.requireUser().id, request.params.id),
    );

    app.post(
      '/tryon/:id/publish',
      {
        preHandler: app.requireAccount,
        schema: {
          tags: ['tryon'],
          summary: 'Share a try-on as a look',
          description:
            'Try-ons are private. This is the only way one becomes visible to anyone else.',
          params: z.object({ id: idSchema }),
          body: z.object({
            visibility: z.enum(['FOLLOWERS', 'PUBLIC']),
            caption: z.string().max(500).optional(),
          }),
          response: { 200: z.object({ lookId: idSchema }) },
        },
      },
      async (request) => {
        const user = request.requireUser();
        const job = await app.prisma.tryOnJob.findUnique({ where: { id: request.params.id } });

        if (!job || job.userId !== user.id) throw errors.notFound('That try-on');
        if (job.status !== 'DONE' || !job.resultKey) {
          throw errors.badRequest('That image is not ready yet');
        }

        const look = job.lookId
          ? await app.prisma.look.update({
              where: { id: job.lookId },
              data: {
                visibility: request.body.visibility,
                caption: request.body.caption ?? null,
                publishedAt: new Date(),
              },
            })
          : await app.prisma.look.create({
              data: {
                ownerId: user.id,
                source: 'TRY_ON',
                visibility: request.body.visibility,
                caption: request.body.caption ?? null,
                coverKey: job.resultKey,
                publishedAt: new Date(),
              },
            });

        if (!job.lookId) {
          await app.prisma.tryOnJob.update({
            where: { id: job.id },
            data: { lookId: look.id },
          });
        }

        return { lookId: look.id };
      },
    );
  };
}
