/**
 * Imagery for the development seed.
 *
 * Real photographs come from sellers. Until there are any, the seed needs
 * something to render, and a grid of grey rectangles cannot be judged: you
 * cannot see whether the masonry reads, whether a tile fights the title
 * under it, or whether a dress and a pair of shoes tell apart at a glance.
 *
 * So it uses the photographs in `seed-assets/garments/`, collected by
 * `scripts/fetch-garments.mjs` from the Metropolitan Museum's Open Access
 * collection. All of it is CC0, so there is no attribution condition, and
 * `manifest.json` beside them records where each one came from anyway.
 *
 * They are photographs of real garments, which is the point: a shop full
 * of real clothes is the only way to see what the shop looks like. They
 * are still not a seller's product photography, they live behind a `seed/`
 * key, and the seed is the only thing that writes one. See docs/ASSETS.md.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const assets = join(dirname(fileURLToPath(import.meta.url)), 'seed-assets');
const garments = join(assets, 'garments');

/**
 * The shapes a photograph comes in.
 *
 * Portrait, because clothes are. The spread is deliberate: the shortest
 * and the tallest differ by about a third, which is what stops two columns
 * of a masonry lining up and reading as a spreadsheet.
 */
const SHAPES = [
  { width: 900, height: 1125 },
  { width: 900, height: 1350 },
  { width: 900, height: 1200 },
  { width: 900, height: 1440 },
  { width: 900, height: 1080 },
  { width: 900, height: 1260 },
];

export function placeholderShape(index: number): { width: number; height: number } {
  return SHAPES[index % SHAPES.length] ?? { width: 900, height: 1200 };
}

export interface GarmentFile {
  file: string;
  category: string;
}

/** Every photograph that was collected, grouped by what it is. */
export async function availableGarments(): Promise<GarmentFile[]> {
  let names: string[] = [];

  try {
    names = (await readdir(garments)).filter((name) => name.endsWith('.jpg')).sort();
  } catch {
    return [];
  }

  return names.map((file) => ({
    file,
    // top-03.jpg -> TOP
    category: (file.split('-')[0] ?? 'top').toUpperCase(),
  }));
}

export interface PlaceholderInput {
  index: number;
  /** A file from `availableGarments`. */
  file?: string;
  size?: { width: number; height: number };
}

/**
 * One photograph, cut to the shape asked for.
 *
 * Covered rather than stretched, and the crop follows the garment instead
 * of the middle of the frame, because a museum photograph often leaves
 * room above a hem that a product tile should not keep.
 */
export async function placeholderImage(input: PlaceholderInput): Promise<Buffer> {
  const size = input.size ?? placeholderShape(input.index);
  const name = input.file ?? 'no-photo.png';
  const where = input.file ? garments : assets;

  const art = await readFile(join(where, name));

  return sharp(art)
    .resize(size.width, size.height, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 84 })
    .toBuffer();
}

/** The faint outline that means a listing has no picture yet. */
export async function noPhotoImage(size = { width: 900, height: 1200 }): Promise<Buffer> {
  const art = await readFile(join(assets, 'no-photo.png'));
  return sharp(art)
    .resize(size.width, size.height, { fit: 'contain', background: '#FAF8F5' })
    .jpeg({ quality: 84 })
    .toBuffer();
}

/** The gold circle with a storefront in it, for a shop with no logo yet. */
export async function placeholderStoreLogo(): Promise<Buffer> {
  const art = await readFile(join(assets, 'store-logo.png'));
  return sharp(art)
    .resize(512, 512, { fit: 'contain', background: '#FAF8F5' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

export function createSeedUploader(options: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}) {
  const client = new S3Client({
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });

  return async function upload(key: string, body: Buffer): Promise<string> {
    await client.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/jpeg',
      }),
    );
    return key;
  };
}
