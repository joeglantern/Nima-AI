/**
 * Media worker: everything done to an image that is not a try-on.
 *
 *   REMOVE_BACKGROUND  seller photos and wardrobe items on a clean ground
 *   GHOST_MANNEQUIN    a seller's photo made to look worn, on Nima's hanger (paid)
 *   WARDROBE_INGEST    cut out, then tag what the garment is
 *   PHOTO_CHECK        is this photo usable for a try-on
 *
 * Background removal runs locally with a model that costs nothing per image.
 * Until that model is wired up, the step is a normalise and resize, and the
 * original is used, which is honest rather than pretending the work was done.
 *
 * A ghost shot is paid for by the shop before it is queued, so, as with
 * try-ons, the one rule is that the shot always comes back when the image
 * cannot be made.
 */

import { createWorkerConnection, type MediaJobData, QUEUE } from '@nima/jobs';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import sharp from 'sharp';
import type { WorkerContext } from '../context.js';
import {
  buildGhostMannequinPrompt,
  buildSimpleGhostPrompt,
  GHOST_WALL_HEX,
  type GhostSubject,
} from '../prompts.js';
import { type ImageProvider, ImageProviderError } from '../providers/image-provider.js';

/** What the model sees. Bigger costs more and helps very little. */
const MAX_EDGE = 1024;

export function startMediaWorker(
  context: WorkerContext,
  provider: ImageProvider | null,
): Worker<MediaJobData> {
  const connection = createWorkerConnection(context.env.REDIS_URL);

  const worker = new Worker<MediaJobData>(
    QUEUE.media,
    async (job: Job<MediaJobData>) => {
      const { kind, storageKey, target } = job.data;

      if (kind === 'GHOST_MANNEQUIN') return makeGhostShot(context, provider, job.data);

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

        default:
          return { skipped: true };
      }
    },
    { connection, concurrency: 3 },
  );

  worker.on('ready', () => context.log.info('Media worker ready'));

  worker.on('failed', async (job, error) => {
    context.log.error({ err: error, target: job?.data.target }, 'Media job failed');
    if (!job || job.data.kind !== 'GHOST_MANNEQUIN') return;

    // Give the shot back once the job is really over, not between retries.
    const over =
      error instanceof UnrecoverableError || (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1);
    if (!over) return;

    try {
      await ghostShotFailed(context, job.data, error.message);
    } catch (refundError) {
      // The worst case, so it is logged loudly for the daily check.
      context.log.error(
        { err: refundError, target: job.data.target },
        'GHOST SHOT REFUND FAILED, fix by hand',
      );
    }
  });

  return worker;
}

// ----------------------------------------------------------- ghost shots ---

async function makeGhostShot(
  context: WorkerContext,
  provider: ImageProvider | null,
  data: MediaJobData,
): Promise<{ processedKey: string }> {
  if (data.target.type !== 'productImage') {
    throw new UnrecoverableError('A ghost shot is made from a product photo');
  }
  if (!provider) {
    throw new UnrecoverableError('No image provider is set up, so the shot cannot be made');
  }

  const image = await context.prisma.productImage.findUnique({
    where: { id: data.target.id },
    include: {
      product: { select: { title: true, colours: true, material: true, category: true } },
    },
  });
  if (!image) throw new UnrecoverableError('That photo is no longer there');

  const subject: GhostSubject = {
    description: [image.product.colours[0], image.product.material, image.product.title]
      .filter(Boolean)
      .join(' '),
    category: image.product.category,
  };

  const log = context.log.child({ imageId: image.id, kind: 'GHOST_MANNEQUIN' });
  const started = Date.now();

  // Always from what the seller uploaded, never from an earlier result, so a
  // redo does not drift further from the real garment each time.
  const reference = await prepare(context, data.storageKey);
  const references = [{ ...reference, label: subject.description }];

  let generated: Awaited<ReturnType<typeof provider.generate>>;
  try {
    generated = await provider.generate({
      prompt: buildGhostMannequinPrompt(subject),
      references,
      quality: 'high',
      aspectRatio: '3:4',
    });
  } catch (error) {
    if (!(error instanceof ImageProviderError && error.retryable)) throw error;
    log.warn({ err: error }, 'First attempt failed, trying a simpler prompt');
    generated = await provider.generate({
      prompt: buildSimpleGhostPrompt(subject),
      references,
      quality: 'high',
      aspectRatio: '3:4',
    });
  }

  const finished = await settleOnTheWall(generated.data);
  // A fresh key every time: a redo must not overwrite the shot still on show,
  // and caches keyed on the old address keep serving it otherwise.
  const stamp = Date.now().toString(36);
  const processedKey = `${data.storageKey.replace(/\.[a-z0-9]+$/i, '')}-ghost-${stamp}.jpg`;
  await context.putObject(processedKey, finished.data, 'image/jpeg');

  await context.prisma.productImage.update({
    where: { id: image.id },
    data: {
      processedKey,
      processing: 'GHOST_MANNEQUIN',
      processingError: null,
      width: finished.width,
      height: finished.height,
    },
  });

  log.info({ ms: Date.now() - started, model: generated.model }, 'Ghost shot finished');
  return { processedKey };
}

/**
 * Put the photo back how it was and give the shop its shot back.
 *
 * The photo keeps its earlier cleaned version, so the shop never goes blank
 * because an experiment failed, and the reason is kept for the seller.
 */
async function ghostShotFailed(
  context: WorkerContext,
  data: MediaJobData,
  reason: string,
): Promise<void> {
  const image = await context.prisma.productImage.findUnique({
    where: { id: data.target.id },
    select: {
      id: true,
      processedKey: true,
      processing: true,
      product: { select: { storeId: true } },
    },
  });
  if (!image) return;

  await context.prisma.$transaction(async (tx) => {
    if (image.processing === 'PENDING') {
      await tx.productImage.update({
        where: { id: image.id },
        data: {
          // Back to exactly what it showed before, so a failed redo leaves a
          // shop's existing ghost shot hanging where it was.
          processing:
            data.restore?.processing && data.restore.processing !== 'PENDING'
              ? data.restore.processing
              : image.processedKey
                ? 'BACKGROUND_REMOVED'
                : 'NONE',
          processedKey: data.restore ? data.restore.processedKey : image.processedKey,
          processingError: reason.slice(0, 300),
        },
      });
    }

    if (data.creditsCharged) {
      await tx.store.update({
        where: { id: image.product.storeId },
        data: { tryOnCredits: { increment: data.creditsCharged } },
      });
    }
  });
}

/** Download, orient, shrink and re-encode as JPEG for the model. */
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

/**
 * Make the background exactly the wall colour.
 *
 * The model gets close to the colour it is asked for, never exact, and on a
 * rail of six pieces the eye picks out the one whose ground is a shade off.
 * The corners of a ghost shot are always bare wall, so their average says
 * how far off this one is, and a small per channel scale brings it home.
 * Capped, so a photo that came back wrong is not bent to fit.
 */
export async function settleOnTheWall(
  input: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const base = sharp(input).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const patch = Math.max(4, Math.round(Math.min(width, height) * 0.01));
  const corners = [
    { left: 0, top: 0 },
    { left: width - patch, top: 0 },
    { left: 0, top: height - patch },
    { left: width - patch, top: height - patch },
  ];

  // stats() describes the whole input, whatever was extracted, so the patch
  // is read as raw pixels and averaged by hand.
  const sums = [0, 0, 0];
  for (const corner of corners) {
    const raw = await sharp(input)
      .rotate()
      .extract({ ...corner, width: patch, height: patch })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = raw.info.width * raw.info.height;
    const channels = raw.info.channels;
    for (let i = 0; i < 3; i += 1) {
      let total = 0;
      for (let p = 0; p < pixels; p += 1) total += raw.data[p * channels + i] ?? 0;
      sums[i] = (sums[i] ?? 0) + total / pixels;
    }
  }

  const wall = [
    Number.parseInt(GHOST_WALL_HEX.slice(1, 3), 16),
    Number.parseInt(GHOST_WALL_HEX.slice(3, 5), 16),
    Number.parseInt(GHOST_WALL_HEX.slice(5, 7), 16),
  ];
  const scale = wall.map((target, i) => {
    const mean = (sums[i] ?? 0) / corners.length;
    const ratio = mean > 0 ? target / mean : 1;
    return Math.min(1.06, Math.max(0.94, ratio));
  });

  const data = await base
    .linear(scale, [0, 0, 0])
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: GHOST_WALL_HEX })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });

  return { data: data.data, width: data.info.width, height: data.info.height };
}
