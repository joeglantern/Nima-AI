/**
 * The try-on worker.
 *
 * Takes a job, fetches the images, asks the model, stores the result and
 * tells the app. The important part is what happens when it goes wrong:
 * **the credits always come back**. A person who paid and got nothing is the
 * one failure that loses trust, so the refund path is handled on every exit.
 */

import { createWorkerConnection, QUEUE, type TryOnJobData } from '@nima/jobs';
import { type Job, Worker } from 'bullmq';
import sharp from 'sharp';
import type { WorkerContext } from '../context.js';
import { buildSimplePrompt, buildTryOnPrompt } from '../prompts.js';
import {
  type ImageProvider,
  ImageProviderError,
  type ReferenceImage,
} from '../providers/image-provider.js';

/** What the model sees. Bigger costs more and helps very little. */
const MAX_EDGE = 1024;

export function startTryOnWorker(
  context: WorkerContext,
  provider: ImageProvider,
): Worker<TryOnJobData> {
  const connection = createWorkerConnection(context.env.REDIS_URL);

  const worker = new Worker<TryOnJobData>(
    QUEUE.tryOn,
    async (job: Job<TryOnJobData>) => {
      const data = job.data;
      const log = context.log.child({ jobId: data.jobId, kind: data.kind });
      const started = Date.now();

      await context.prisma.tryOnJob.update({
        where: { id: data.jobId },
        data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
      });

      await context.publishToUser(data.userId, {
        type: 'tryon.progress',
        jobId: data.jobId,
        status: 'RUNNING',
        percent: 10,
        note: 'Nima is dressing you',
      });

      // Fetch and shrink every image. Downscaling here is the single biggest
      // lever on cost and latency.
      const references: ReferenceImage[] = [];

      const person = await prepare(context, data.baseKey);
      references.push({ ...person, label: 'the person' });

      for (const garment of data.garments) {
        const image = await prepare(context, garment.storageKey);
        references.push({ ...image, label: garment.description });
      }

      await context.publishToUser(data.userId, {
        type: 'tryon.progress',
        jobId: data.jobId,
        status: 'RUNNING',
        percent: 40,
        note: 'Putting the look together',
      });

      // First attempt with the full prompt, then one simpler retry. The old
      // codebase did the same and it rescued a useful share of failures.
      let generated;
      try {
        generated = await provider.generate({
          prompt: buildTryOnPrompt(data),
          references,
          quality: data.quality,
        });
      } catch (error) {
        if (error instanceof ImageProviderError && error.retryable) {
          log.warn({ err: error }, 'First attempt failed, trying a simpler prompt');
          generated = await provider.generate({
            prompt: buildSimplePrompt(data),
            references,
            quality: data.quality,
          });
        } else {
          throw error;
        }
      }

      const resultKey = `users/${data.userId}/tryons/${data.jobId}.png`;
      await context.putObject(resultKey, generated.data, generated.mimeType);

      const dimensions = await sharp(generated.data).metadata();

      // A try-on is a look, created private. Only the owner sees it until
      // they choose to share it.
      const look = await context.prisma.look.create({
        data: {
          ownerId: data.userId,
          source: data.kind === 'RECREATE' ? 'RECREATION' : 'TRY_ON',
          visibility: 'PRIVATE',
          coverKey: resultKey,
          width: dimensions.width ?? null,
          height: dimensions.height ?? null,
          items: {
            create: data.garments
              .filter((garment) => garment.productId || garment.wardrobeItemId)
              .map((garment, index) => ({
                slot: garment.slot as never,
                productId: garment.productId,
                wardrobeItemId: garment.wardrobeItemId,
                position: index,
              })),
          },
        },
      });

      await context.prisma.tryOnJob.update({
        where: { id: data.jobId },
        data: {
          status: 'DONE',
          resultKey,
          lookId: look.id,
          model: generated.model,
          promptUsed: buildTryOnPrompt(data).slice(0, 2000),
          finishedAt: new Date(),
          durationMs: Date.now() - started,
        },
      });

      // Bump the counter sellers care about most.
      for (const garment of data.garments) {
        if (!garment.productId) continue;
        await context.prisma.look.update({
          where: { id: look.id },
          data: { tryOnCount: { increment: 1 } },
        });
        break;
      }

      const balance = await context.prisma.creditBalance.findUnique({
        where: { userId: data.userId },
      });

      await context.publishToUser(data.userId, {
        type: 'tryon.done',
        jobId: data.jobId,
        lookId: look.id,
        imageUrl: `${context.env.S3_PUBLIC_URL}/${resultKey}`,
        creditsCharged: data.creditsCharged,
        creditsRemaining: balance?.balance ?? 0,
      });

      log.info({ ms: Date.now() - started, model: generated.model }, 'Try-on finished');

      return { lookId: look.id, resultKey };
    },
    {
      connection,
      // One image at a time per worker keeps memory flat and the provider
      // happy. Scale by running more worker processes.
      concurrency: 2,
      limiter: { max: 30, duration: 60_000 },
    },
  );

  worker.on('failed', async (job, error) => {
    if (!job) return;

    const data = job.data;
    const isFinalAttempt = (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1);

    context.log.error(
      { err: error, jobId: data.jobId, attempt: job.attemptsMade },
      'Try-on failed',
    );

    if (!isFinalAttempt) return;

    // Out of attempts: refund and tell the person plainly.
    try {
      const refunded = await refund(context, data);

      await context.prisma.tryOnJob.update({
        where: { id: data.jobId },
        data: {
          status: 'FAILED',
          error: error.message.slice(0, 500),
          finishedAt: new Date(),
          refunded: true,
        },
      });

      await context.publishToUser(data.userId, {
        type: 'tryon.failed',
        jobId: data.jobId,
        reason: 'Nima could not make that image. Your credits are back.',
        creditsRefunded: refunded,
      });
    } catch (refundError) {
      // A failed refund is the worst case, so it is logged loudly for the
      // daily check rather than swallowed.
      context.log.error({ err: refundError, jobId: data.jobId }, 'REFUND FAILED, fix by hand');
    }
  });

  worker.on('ready', () => context.log.info('Try-on worker ready'));

  return worker;
}

/** Download, orient, shrink and re-encode as JPEG. */
async function prepare(
  context: WorkerContext,
  key: string,
): Promise<{ data: Buffer; mimeType: string }> {
  const original = await context.getObject(key);

  const data = await sharp(original)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();

  return { data, mimeType: 'image/jpeg' };
}

async function refund(context: WorkerContext, data: TryOnJobData): Promise<number> {
  if (data.creditsCharged <= 0) return 0;

  return context.prisma.$transaction(async (tx) => {
    const already = await tx.creditLedgerEntry.findFirst({
      where: { userId: data.userId, reason: 'REFUND', refId: data.jobId },
    });
    if (already) return 0;

    await tx.creditLedgerEntry.create({
      data: {
        userId: data.userId,
        delta: data.creditsCharged,
        reason: 'REFUND',
        refType: 'try_on_job',
        refId: data.jobId,
        note: 'The image could not be made',
      },
    });

    await tx.creditBalance.upsert({
      where: { userId: data.userId },
      create: { userId: data.userId, balance: data.creditsCharged },
      update: { balance: { increment: data.creditsCharged } },
    });

    return data.creditsCharged;
  });
}
