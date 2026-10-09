/**
 * Queue definitions, shared by the API (which enqueues) and the worker (which
 * consumes). Keeping the names and payload types in one package means the two
 * processes cannot drift apart.
 *
 * Everything slow or external is a job: image generation, background removal,
 * tagging, embeddings, notifications, payouts and roll-ups.
 */

import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

export const QUEUE = {
  tryOn: 'nima.tryon',
  media: 'nima.media',
  embedding: 'nima.embedding',
  notification: 'nima.notification',
  commerce: 'nima.commerce',
  analytics: 'nima.analytics',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

// ----------------------------------------------------------------- payloads

/** A garment going into an image, already resolved to URLs and description. */
export const garmentInputSchema = z.object({
  slot: z.string(),
  description: z.string(),
  storageKey: z.string(),
  productId: z.string().nullable(),
  wardrobeItemId: z.string().nullable(),
});

export const tryOnJobDataSchema = z.object({
  jobId: z.string(),
  userId: z.string(),
  kind: z.string(),
  /** The person. Either a saved photo or the result of a previous job. */
  baseKey: z.string(),
  garments: z.array(garmentInputSchema),
  instruction: z.string().nullable(),
  /** Use the slower, higher quality model for outfits and premium sellers. */
  quality: z.enum(['fast', 'high']),
  creditsCharged: z.number().int(),
});

export type TryOnJobData = z.infer<typeof tryOnJobDataSchema>;

export const mediaJobDataSchema = z.object({
  kind: z.enum(['REMOVE_BACKGROUND', 'GHOST_MANNEQUIN', 'WARDROBE_INGEST', 'PHOTO_CHECK']),
  storageKey: z.string(),
  /** What the result belongs to, so the worker can write it back. */
  target: z.object({
    type: z.enum(['productImage', 'wardrobeItem', 'userPhoto']),
    id: z.string(),
  }),
  userId: z.string().nullable(),
});

export type MediaJobData = z.infer<typeof mediaJobDataSchema>;

export const embeddingJobDataSchema = z.object({
  target: z.enum(['product', 'look', 'wardrobeItem', 'taste']),
  id: z.string(),
});

export type EmbeddingJobData = z.infer<typeof embeddingJobDataSchema>;

export const notificationJobDataSchema = z.object({
  userId: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  /** Skip the push if the person is looking at the app right now. */
  skipPushIfOnline: z.boolean().default(true),
});

export type NotificationJobData = z.infer<typeof notificationJobDataSchema>;

// ------------------------------------------------------------- connections

/**
 * Workers and event listeners block on Redis, so they need
 * `maxRetriesPerRequest: null`. Producers do not, and should fail fast so an
 * HTTP request never hangs behind a queue.
 */
export function createQueueConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 1, enableReadyCheck: true });
}

export function createWorkerConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 4_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export interface Queues {
  tryOn: Queue<TryOnJobData>;
  media: Queue<MediaJobData>;
  embedding: Queue<EmbeddingJobData>;
  notification: Queue<NotificationJobData>;
  close(): Promise<void>;
}

export function createQueues(connection: ConnectionOptions): Queues {
  const options = { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS };

  const tryOn = new Queue<TryOnJobData>(QUEUE.tryOn, options);
  const media = new Queue<MediaJobData>(QUEUE.media, options);
  const embedding = new Queue<EmbeddingJobData>(QUEUE.embedding, options);
  const notification = new Queue<NotificationJobData>(QUEUE.notification, options);

  return {
    tryOn,
    media,
    embedding,
    notification,
    async close() {
      await Promise.all([tryOn.close(), media.close(), embedding.close(), notification.close()]);
    },
  };
}
