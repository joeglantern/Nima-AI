/**
 * Object storage (S3 compatible: Garage locally, the same API in production).
 *
 * Image bytes never pass through this process. The client asks for a
 * presigned PUT, uploads straight to storage, then tells the API the object
 * is there. The API only ever deals in storage keys.
 *
 * Keys are structured so that deleting a user means deleting a prefix:
 *   users/{userId}/photos/{id}.jpg
 *   users/{userId}/wardrobe/{id}.jpg
 *   users/{userId}/tryons/{jobId}.png
 *   stores/{storeId}/products/{productId}/{id}.jpg
 */

import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '@nima/config';

export type UploadPurpose =
  | 'USER_PHOTO'
  | 'WARDROBE_ITEM'
  | 'PRODUCT_IMAGE'
  | 'AVATAR'
  | 'STORE_LOGO'
  | 'STORE_BANNER'
  | 'QUICK_TRY_ON'
  | 'REVIEW';

/** Per purpose limits, in bytes. Photos of people need the most room. */
const SIZE_LIMITS: Record<UploadPurpose, number> = {
  USER_PHOTO: 15 * 1024 * 1024,
  WARDROBE_ITEM: 12 * 1024 * 1024,
  PRODUCT_IMAGE: 15 * 1024 * 1024,
  AVATAR: 6 * 1024 * 1024,
  STORE_LOGO: 6 * 1024 * 1024,
  STORE_BANNER: 10 * 1024 * 1024,
  QUICK_TRY_ON: 12 * 1024 * 1024,
  REVIEW: 10 * 1024 * 1024,
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export interface PresignInput {
  purpose: UploadPurpose;
  contentType: string;
  size: number;
  /** Scopes the key. A store upload passes the store id instead. */
  ownerId: string;
  /** Extra path segment, for example the product id. */
  scopeId?: string;
}

export interface PresignedUpload {
  uploadUrl: string;
  storageKey: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface Storage {
  limitFor(purpose: UploadPurpose): number;
  presignUpload(input: PresignInput): Promise<PresignedUpload>;
  /** Signed read URL for private objects (user photos, try-on results). */
  presignDownload(key: string, expiresInSeconds?: number): Promise<string>;
  /** Stable public URL for objects that are meant to be public. */
  publicUrl(key: string): string;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class UnsupportedMediaError extends Error {}
export class FileTooLargeError extends Error {}

function keyFor(input: PresignInput): string {
  const extension = EXTENSIONS[input.contentType];
  if (!extension) throw new UnsupportedMediaError(`Unsupported content type ${input.contentType}`);

  const id = randomUUID();

  switch (input.purpose) {
    case 'USER_PHOTO':
      return `users/${input.ownerId}/photos/${id}.${extension}`;
    case 'WARDROBE_ITEM':
      return `users/${input.ownerId}/wardrobe/${id}.${extension}`;
    case 'QUICK_TRY_ON':
      return `users/${input.ownerId}/quick/${id}.${extension}`;
    case 'AVATAR':
      return `users/${input.ownerId}/avatar/${id}.${extension}`;
    case 'REVIEW':
      return `users/${input.ownerId}/reviews/${id}.${extension}`;
    case 'PRODUCT_IMAGE':
      return `stores/${input.ownerId}/products/${input.scopeId ?? 'draft'}/${id}.${extension}`;
    case 'STORE_LOGO':
      return `stores/${input.ownerId}/logo/${id}.${extension}`;
    case 'STORE_BANNER':
      return `stores/${input.ownerId}/banner/${id}.${extension}`;
  }
}

export function createStorage(env: Env): Storage {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    // Garage and most self hosted S3 servers need path style addressing.
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });

  const bucket = env.S3_BUCKET;

  return {
    limitFor: (purpose) => SIZE_LIMITS[purpose],

    async presignUpload(input) {
      const limit = SIZE_LIMITS[input.purpose];
      if (input.size > limit) {
        throw new FileTooLargeError(
          `That image is ${Math.round(input.size / 1024 / 1024)}MB. The limit is ${Math.round(limit / 1024 / 1024)}MB.`,
        );
      }

      const storageKey = keyFor(input);
      const expiresInSeconds = 15 * 60;

      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          ContentType: input.contentType,
          ContentLength: input.size,
        }),
        { expiresIn: expiresInSeconds },
      );

      return {
        uploadUrl,
        storageKey,
        headers: { 'Content-Type': input.contentType },
        expiresInSeconds,
      };
    },

    async presignDownload(key, expiresInSeconds = 60 * 60) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },

    publicUrl(key) {
      return `${env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },

    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error(`Object ${key} is empty`);
      return Buffer.from(bytes);
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
