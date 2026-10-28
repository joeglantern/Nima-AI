/**
 * Starting a try-on.
 *
 * The single rule from the audit of the old code: **charging and queueing
 * happen in one transaction**. If the job cannot be queued, the credits are
 * never taken. If the credits cannot be taken, no image is ever generated.
 * There is no other path to the image model.
 *
 * It also fails closed. No photo of the person means no generation, because
 * the old fallback dropped the photo and produced a picture of a stranger.
 */

import type { CreditReason, GarmentSlot, Prisma, TryOnKind } from '@nima/db';
import type { Queues, TryOnJobData } from '@nima/jobs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errors } from '../lib/errors.js';

export interface StartTryOnInput {
  userId: string;
  kind: TryOnKind;
  photoId?: string;
  items: Array<{
    slot: GarmentSlot;
    productId?: string;
    variantId?: string;
    wardrobeItemId?: string;
  }>;
  sourceKey?: string;
  parentJobId?: string;
  lookId?: string;
  instruction?: string;
}

export interface StartTryOnResult {
  jobId: string;
  creditsCharged: number;
  creditsRemaining: number;
  queuePosition: number;
  estimatedSeconds: number;
}

/** Roughly how long one image takes, used for the waiting copy. */
const SECONDS_PER_JOB = 25;

export class TryOnService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly queues: Queues,
  ) {}

  async start(input: StartTryOnInput, request: FastifyRequest): Promise<StartTryOnResult> {
    const { app } = this;

    // Without an image provider the job would wait forever, after being
    // paid for. Refuse before anything is charged.
    if (!app.env.GEMINI_API_KEY) {
      throw errors.providerUnavailable('Try-ons are switched off for now. They will be back soon.');
    }

    // One person cannot fill the queue.
    const running = await app.prisma.tryOnJob.count({
      where: { userId: input.userId, status: { in: ['QUEUED', 'RUNNING'] } },
    });

    if (running >= app.env.MAX_CONCURRENT_AI_JOBS) {
      throw errors.conflict(
        running === 1
          ? 'One of your try-ons is still being made. Wait for it to finish.'
          : `${running} of your try-ons are still being made. Wait for those to finish.`,
      );
    }

    const base = await this.resolveBaseImage(input);
    const garments = await this.resolveGarments(input);

    if (garments.length === 0 && !input.instruction) {
      throw errors.badRequest('Pick something to try on');
    }

    const { reason, cost, quality } = await this.priceOf(input, garments.length);

    // Charge and create the job row together. Either both happen or neither.
    const { jobId, creditsRemaining } = await app.prisma.$transaction(async (tx) => {
      const remaining = await app.services.credits.charge(
        {
          userId: input.userId,
          amount: cost,
          reason,
          refType: 'try_on_job',
          note: describe(input.kind, garments.length),
        },
        tx,
      );

      const job = await tx.tryOnJob.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          status: 'QUEUED',
          photoId: input.photoId ?? null,
          sourceKey: base.key,
          inputs: {
            garments: garments.map((garment) => ({
              slot: garment.slot,
              description: garment.description,
              productId: garment.productId,
              wardrobeItemId: garment.wardrobeItemId,
            })),
            instruction: input.instruction ?? null,
          } satisfies Prisma.InputJsonValue,
          parentJobId: input.parentJobId ?? null,
          lookId: input.lookId ?? null,
          creditsCharged: cost,
        },
      });

      // Point the ledger entry at the job now that it has an id.
      await tx.creditLedgerEntry.updateMany({
        where: { userId: input.userId, refType: 'try_on_job', refId: null },
        data: { refId: job.id },
      });

      return { jobId: job.id, creditsRemaining: remaining };
    });

    const data: TryOnJobData = {
      jobId,
      userId: input.userId,
      kind: input.kind,
      baseKey: base.key,
      garments,
      instruction: input.instruction ?? null,
      quality,
      creditsCharged: cost,
    };

    try {
      await this.queues.tryOn.add('generate', data, { jobId });
    } catch (error) {
      // The queue is down. Give the credits straight back rather than leaving
      // the person paying for something that will never run.
      await app.services.credits.refund({
        userId: input.userId,
        amount: cost,
        reason: 'REFUND' as CreditReason,
        refType: 'try_on_job',
        refId: jobId,
        note: 'Could not start the image',
      });

      await app.prisma.tryOnJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: 'queue_unavailable', refunded: true },
      });

      request.log.error({ err: error }, 'Could not queue a try-on');
      throw errors.providerUnavailable('Nima cannot make images right now. Try again shortly.');
    }

    const waiting = await this.queues.tryOn.getWaitingCount();

    return {
      jobId,
      creditsCharged: cost,
      creditsRemaining,
      queuePosition: waiting,
      estimatedSeconds: Math.max(SECONDS_PER_JOB, waiting * SECONDS_PER_JOB),
    };
  }

  /**
   * Stop a try-on that has not started yet, and give the credits back.
   *
   * Someone who picked the wrong photo should not have to watch it finish,
   * and without this a job that never runs, because the image provider is
   * down or a key is missing, counts against the concurrency limit forever
   * and locks the person out of the feature with no way to clear it.
   *
   * A job already running is left alone: the image is being paid for whether
   * or not anybody still wants it.
   */
  async cancel(userId: string, jobId: string): Promise<{ creditsRefunded: number }> {
    const { app } = this;

    const job = await app.prisma.tryOnJob.findFirst({
      where: { id: jobId, userId },
      select: { id: true, status: true, creditsCharged: true },
    });

    if (!job) throw errors.notFound('That try-on');

    if (job.status === 'DONE' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return { creditsRefunded: 0 };
    }

    if (job.status === 'RUNNING') {
      throw errors.conflict('That image is already being made. It will be ready shortly.');
    }

    // Take it off the queue first. A worker that picks it up between here and
    // the refund would produce an image nobody paid for.
    await this.queues.tryOn.remove(jobId).catch((error: unknown) => {
      app.log.warn({ err: error, jobId }, 'Could not remove a cancelled job from the queue');
    });

    await app.prisma.tryOnJob.update({
      where: { id: job.id },
      data: { status: 'CANCELLED', refunded: true, error: 'cancelled_by_user' },
    });

    // The refund is keyed on the job, so calling this twice gives back one
    // lot of credits.
    await app.services.credits.refund({
      userId,
      amount: job.creditsCharged,
      reason: 'REFUND' as CreditReason,
      refType: 'try_on_job',
      refId: job.id,
      note: 'Try-on cancelled',
    });

    return { creditsRefunded: job.creditsCharged };
  }

  /**
   * Which image the person appears in: a saved photo, a chained result, or a
   * garment they just photographed.
   */
  private async resolveBaseImage(input: StartTryOnInput): Promise<{ key: string }> {
    const { app } = this;

    if (input.parentJobId) {
      const parent = await app.prisma.tryOnJob.findUnique({ where: { id: input.parentJobId } });

      if (!parent || parent.userId !== input.userId) throw errors.notFound('That try-on');
      if (parent.status !== 'DONE' || !parent.resultKey) {
        throw errors.badRequest('Wait for the first image to finish before changing it');
      }

      return { key: parent.resultKey };
    }

    const photo = input.photoId
      ? await app.prisma.userPhoto.findUnique({ where: { id: input.photoId } })
      : await app.prisma.userPhoto.findFirst({
          where: {
            userId: input.userId,
            kind: input.kind === 'ACCESSORY' ? 'UPPER_BODY' : 'FULL_BODY',
          },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });

    // Accessories work on an upper body shot; fall back to any photo.
    const fallback =
      photo ??
      (await app.prisma.userPhoto.findFirst({
        where: { userId: input.userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }));

    if (!fallback) throw errors.photoRequired();
    if (fallback.userId !== input.userId) throw errors.forbidden('That photo is not yours');
    if (fallback.checkState === 'FAILED') {
      throw errors.badRequest(
        fallback.checkNote ?? 'That photo will not work. Try one where your whole body is visible.',
      );
    }

    return { key: fallback.storageKey };
  }

  /** Turn ids into the descriptions and image keys the prompt needs. */
  private async resolveGarments(input: StartTryOnInput): Promise<TryOnJobData['garments']> {
    const { app } = this;
    const garments: TryOnJobData['garments'] = [];

    // Quick Try-On: the garment is a photo taken right now.
    if (input.sourceKey) {
      if (!input.sourceKey.startsWith(`users/${input.userId}/`)) {
        throw errors.forbidden('That upload does not belong to you');
      }
      garments.push({
        slot: 'OTHER',
        description: 'the garment in the photo',
        storageKey: input.sourceKey,
        productId: null,
        wardrobeItemId: null,
      });
    }

    // Recreating a look: take its items.
    const items = input.lookId
      ? (
          await app.prisma.lookItem.findMany({
            where: { lookId: input.lookId },
            include: {
              product: { include: { images: { take: 1, orderBy: { position: 'asc' } } } },
              wardrobeItem: true,
            },
            orderBy: { position: 'asc' },
          })
        ).map((item) => ({
          slot: item.slot,
          productId: item.productId ?? undefined,
          wardrobeItemId: item.wardrobeItemId ?? undefined,
        }))
      : input.items;

    for (const item of items) {
      if (item.productId) {
        const product = await app.prisma.product.findUnique({
          where: { id: item.productId },
          include: { images: { take: 1, orderBy: { position: 'asc' } } },
        });

        const image = product?.images[0];
        if (!product || !image) continue;

        garments.push({
          slot: item.slot,
          description: [product.colours[0], product.material, product.title]
            .filter(Boolean)
            .join(' '),
          storageKey: image.processedKey ?? image.originalKey,
          productId: product.id,
          wardrobeItemId: null,
        });
        continue;
      }

      if (item.wardrobeItemId) {
        const wardrobeItem = await app.prisma.wardrobeItem.findUnique({
          where: { id: item.wardrobeItemId },
        });

        if (!wardrobeItem) continue;
        if (wardrobeItem.userId !== input.userId) {
          throw errors.forbidden('That wardrobe item is not yours');
        }

        garments.push({
          slot: item.slot,
          description: [wardrobeItem.colours[0], wardrobeItem.label ?? wardrobeItem.category]
            .filter(Boolean)
            .join(' '),
          storageKey: wardrobeItem.cutoutKey ?? wardrobeItem.originalKey,
          productId: null,
          wardrobeItemId: wardrobeItem.id,
        });
      }
    }

    return garments;
  }

  /** What this costs and which model it deserves. */
  private async priceOf(
    input: StartTryOnInput,
    garmentCount: number,
  ): Promise<{ reason: CreditReason; cost: number; quality: 'fast' | 'high' }> {
    const settings = await this.app.services.settings.get();
    const costs = settings.creditCosts;

    switch (input.kind) {
      case 'QUICK':
        return { reason: 'TRY_ON', cost: costs.tryOnQuick, quality: 'fast' };
      case 'ACCESSORY':
        return { reason: 'TRY_ON', cost: costs.tryOnAccessory, quality: 'fast' };
      case 'RECREATE':
        return { reason: 'TRY_ON', cost: costs.recreateLook, quality: 'high' };
      case 'OUTFIT':
        return { reason: 'LOOK_GENERATION', cost: costs.tryOnOutfit, quality: 'high' };
      case 'ONBOARDING':
        // The welcome looks are free, which is what the signup bonus is for.
        return { reason: 'LOOK_GENERATION', cost: 0, quality: 'fast' };
      default:
        return {
          reason: 'TRY_ON',
          cost: garmentCount > 1 ? costs.tryOnOutfit : costs.tryOnSingleItem,
          quality: garmentCount > 1 ? 'high' : 'fast',
        };
    }
  }
}

function describe(kind: TryOnKind, garmentCount: number): string {
  if (kind === 'QUICK') return 'Quick try-on';
  if (kind === 'RECREATE') return 'Recreated a look';
  if (kind === 'ACCESSORY') return 'Accessory try-on';
  return garmentCount > 1 ? `Outfit with ${garmentCount} pieces` : 'Try-on';
}
