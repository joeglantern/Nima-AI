/**
 * Shared worker context: configuration, database, storage, Valkey and the
 * realtime publisher.
 *
 * The worker publishes to the same Valkey channel the API's WebSocket
 * gateway listens on, so a finished image reaches the phone without the two
 * processes knowing about each other.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import pino, { type Logger } from 'pino';
import { loadEnv, type Env } from '@nima/config';
import { createPrismaClient, type PrismaClient } from '@nima/db';
import { channels, type ServerFrame } from '@nima/contracts';

const REALTIME_CHANNEL = 'nima:realtime';

export interface WorkerContext {
  env: Env;
  log: Logger;
  prisma: PrismaClient;
  redis: Redis;
  s3: S3Client;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  publishToUser(userId: string, frame: ServerFrame): Promise<void>;
  publishToJob(jobId: string, frame: ServerFrame): Promise<void>;
  close(): Promise<void>;
}

export function createContext(): WorkerContext {
  const env = loadEnv();

  const log = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });

  const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });

  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    // The SDK adds a CRC32 checksum header by default. Presigned PUTs then
    // fail against S3 compatible servers, because the browser never sends
    // that header. Only calculate a checksum when the operation requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  async function publish(channel: string, frame: ServerFrame): Promise<void> {
    await redis.publish(REALTIME_CHANNEL, JSON.stringify({ channel, frame }));
  }

  return {
    env,
    log,
    prisma,
    redis,
    s3,

    async getObject(key) {
      const result = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error(`Object ${key} is empty`);
      return Buffer.from(bytes);
    },

    async putObject(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    publishToUser: (userId, frame) => publish(channels.user(userId), frame),
    publishToJob: (jobId, frame) => publish(channels.job(jobId), frame),

    async close() {
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
      s3.destroy();
    },
  };
}
