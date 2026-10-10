/**
 * Imagery for the development seed.
 *
 * Real photographs come from sellers. Until there are any, the seed needs
 * something to render, and a grid of grey rectangles cannot be judged: you
 * cannot see whether the masonry reads, whether a tile fights the title
 * under it, or whether a dress and a pair of shoes tell apart at a glance.
 *
 * So it uses the illustrated garments in `seed-assets/`, which were drawn
 * for this and are obviously drawings. They are not photographs and must
 * never be passed off as a seller's product. They live behind a `seed/`
 * key, the seed is the only thing that writes them, and `docs/ASSETS.md`
 * says why that line matters in a shopping app.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const assets = join(dirname(fileURLToPath(import.meta.url)), 'seed-assets');

/**
 * Which drawing stands in for which product.
 *
 * By slug where there is an obvious match, so the ankara shirt gets the
 * ankara shirt, and by category otherwise. Getting this right is most of
 * what makes the seeded shop look like a shop.
 */
const BY_SLUG: Record<string, string> = {
  'ankara-panel-shirt': 'garment-heritage',
  'linen-drawstring-trouser': 'garment-minimal',
  'kitenge-wrap-dress': 'garment-elegant',
  // Both of these are in the streetwear outfit, which is where they came
  // from, so sharing a drawing is the truthful answer rather than a clash.
  'boxy-logo-tee': 'garment-streetwear',
  'cargo-utility-pant': 'garment-streetwear',
  'suede-court-sneaker': 'garment-sporty',
  // The two curated looks on the feed, which are whole outfits.
  'look-saturday': 'garment-smart-casual',
  'look-weekend': 'garment-vintage',
};

/**
 * Categories with no drawing of their own.
 *
 * The sheet is eight outfits, so there is nothing for sunglasses, a bag or
 * a necklace. Putting a jumper behind "Round frame sunglasses" is worse
 * than admitting there is no picture: the faint outline says "no photo
 * yet", which is true, and it is the same placeholder a real listing gets
 * before the seller uploads anything.
 */
const NO_DRAWING = new Set(['EYEWEAR', 'JEWELLERY', 'BAG', 'HEADWEAR', 'ACCESSORY']);

const BY_CATEGORY: Record<string, string> = {
  TOP: 'garment-smart-casual',
  BOTTOM: 'garment-streetwear',
  DRESS: 'garment-elegant',
  OUTERWEAR: 'garment-bold',
  SHOES: 'garment-sporty',
  BAG: 'no-photo',
  JEWELLERY: 'no-photo',
  EYEWEAR: 'no-photo',
  HEADWEAR: 'no-photo',
  ACCESSORY: 'no-photo',
};

const EVERY = [
  'garment-smart-casual',
  'garment-streetwear',
  'garment-heritage',
  'garment-minimal',
  'garment-elegant',
  'garment-sporty',
  'garment-bold',
  'garment-vintage',
];

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

export interface PlaceholderInput {
  index: number;
  slug?: string;
  category?: string;
  size?: { width: number; height: number };
}

/**
 * One stand in photograph.
 *
 * The drawing is covered to the shape asked for rather than stretched, and
 * taken from the middle, which is where the garment sits on every one of
 * these tiles.
 */
export async function placeholderImage(input: PlaceholderInput): Promise<Buffer> {
  const { index, slug, category } = input;
  const size = input.size ?? placeholderShape(index);

  const name =
    (slug ? BY_SLUG[slug] : undefined) ??
    (category && NO_DRAWING.has(category) ? 'no-photo' : undefined) ??
    (category ? BY_CATEGORY[category] : undefined) ??
    EVERY[index % EVERY.length] ??
    'garment-smart-casual';

  const art = await readFile(join(assets, `${name}.png`));

  return sharp(art)
    .resize(size.width, size.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 86 })
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
