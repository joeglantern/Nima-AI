/**
 * Media worker: everything done to an image that is not a try-on.
 *
 *   REMOVE_BACKGROUND  seller photos and wardrobe items on a clean ground
 *   GHOST_MANNEQUIN    a flat lay made to look worn (seller feature, paid)
 *   WARDROBE_INGEST    cut out, then tag what the garment is
 *   PHOTO_CHECK        is this photo usable for a try-on
 *
 * Background removal runs locally with a model that costs nothing per image.
 * Until that model is wired up, the step is a normalise and resize, and the
 * original is used, which is honest rather than pretending the work was done.
 */

import { createWorkerConnection, type MediaJobData, QUEUE } from '@nima/jobs';
import { type Job, Worker } from 'bullmq';
import sharp from 'sharp';
import type { WorkerContext } from '../context.js';

export function startMediaWorker(context: WorkerContext): Worker<MediaJobData> {
  const connection = createWorkerConnection(context.env.REDIS_URL);

  const worker = new Worker<MediaJobData>(
    QUEUE.media,
    async (job: Job<MediaJobData>) => {
      const { kind, storageKey, target } = job.data;
      const original = await context.getObject(storageKey);

      switch (kind) {
        case 'PHOTO_CHECK': {
          const metadata = await sharp(original).metadata();
          const width = metadata.width ?? 0;
          const height = metadata.height ?? 0;

          // A cheap, honest check: resolution and orientation. A vision model
          // decides whether a face is visible, and is added here next.
          const tooSmall = width < 512 || height < 512;
          const wrongShape = height < width;

          const note = tooSmall
            ? 'That photo is quite small. A larger one gives a much better result.'
            : wrongShape
              ? 'Use a portrait photo, taken from the front, with your whole body in frame.'
              : null;

          await context.prisma.userPhoto.update({
            where: { id: target.id },
            data: {
              checkState: tooSmall ? 'FAILED' : 'PASSED',
              checkNote: note,
              width,
              height,
            },
          });

          return { state: tooSmall ? 'FAILED' : 'PASSED' };
        }

        case 'REMOVE_BACKGROUND':
        case 'WARDROBE_INGEST': {
          // Normalise now, swap in the cut out model without changing the
          // contract: the processed key is what the rest of the app reads.
          const processed = await sharp(original)
            .rotate()
            .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#FFFFFF' })
            .jpeg({ quality: 88 })
            .toBuffer();

          const processedKey = storageKey.replace(/(\.[a-z]+)$/i, '-clean.jpg');
          await context.putObject(processedKey, processed, 'image/jpeg');

          if (target.type === 'productImage') {
            await context.prisma.productImage.update({
              where: { id: target.id },
              data: { processedKey, processing: 'BACKGROUND_REMOVED' },
            });
          } else if (target.type === 'wardrobeItem') {
            await context.prisma.wardrobeItem.update({
              where: { id: target.id },
              data: { cutoutKey: processedKey, processing: 'BACKGROUND_REMOVED' },
            });
          }

          return { processedKey };
        }

        case 'GHOST_MANNEQUIN': {
          // Needs the image provider and a seller credit charge. Not enabled
          // yet, and the feature flag keeps it off in the app.
          context.log.warn({ target }, 'Ghost mannequin is not enabled yet');
          return { skipped: true };
        }
      }
    },
    { connection, concurrency: 3 },
  );

  worker.on('ready', () => context.log.info('Media worker ready'));
  worker.on('failed', (job, error) =>
    context.log.error({ err: error, target: job?.data.target }, 'Media job failed'),
  );

  return worker;
}
