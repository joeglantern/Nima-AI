/**
 * Placeholder imagery for development.
 *
 * Real photography comes from sellers. Until then the seed needs something
 * to render, and a blank grey box makes it impossible to judge layout.
 *
 * Two rules these follow, learned from looking at the grid next to the
 * screens in `Design/`:
 *
 *   1. No text in the picture. A tile that shouts its own name reads as a
 *      mockup, and the title is already set underneath it.
 *   2. Not every photo is the same shape. Sellers upload what their camera
 *      gave them, so the heights vary and the masonry staggers. A seed where
 *      every image is 3:4 makes a grid look like a spreadsheet.
 *
 * They are never created outside development.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

/**
 * Muted warm neutrals, with two brand tints among them.
 *
 * Studio backdrops, roughly: the tones a garment is usually shot against.
 * Full strength burgundy on a whole tile reads as a colour swatch, not as a
 * photograph, so the brand colours appear here only as washes.
 */
const WASHES = [
  { top: '#E8DED2', bottom: '#CDBCAA' },
  { top: '#F1EAE2', bottom: '#D8C8B8' },
  { top: '#DED3CA', bottom: '#BBA897' },
  { top: '#F3E7E6', bottom: '#D8BCBA' },
  { top: '#E6E2DA', bottom: '#C4BCAF' },
  { top: '#EFE2D3', bottom: '#CBAE8E' },
  { top: '#E4DCD6', bottom: '#B9A79C' },
];

/**
 * The shapes a photograph comes in.
 *
 * Portrait, because clothes are. The spread is deliberate: the shortest and
 * the tallest differ by about a third, which is what makes two columns stop
 * lining up.
 */
const SHAPES = [
  { width: 900, height: 1125 },
  { width: 900, height: 1350 },
  { width: 900, height: 1200 },
  { width: 900, height: 1440 },
  { width: 900, height: 1080 },
  { width: 900, height: 1260 },
];

/** The shape the seed should store for image number `index`. */
export function placeholderShape(index: number): { width: number; height: number } {
  return SHAPES[index % SHAPES.length] ?? { width: 900, height: 1200 };
}

/**
 * One placeholder photograph.
 *
 * A soft wash with a hanger drawn faintly over it, so it is obvious at a
 * glance that the picture has not arrived yet without the tile turning into
 * a label.
 */
export async function placeholderImage(
  index: number,
  size: { width: number; height: number } = placeholderShape(index),
): Promise<Buffer> {
  const wash = WASHES[index % WASHES.length] ?? { top: '#E8DED2', bottom: '#CDBCAA' };

  // The hanger sits a little above centre, where a garment's shoulders would.
  const scale = Math.min(size.width, size.height) * 0.0042;
  const centreX = size.width / 2;
  const centreY = size.height * 0.46;

  const svg = `
    <svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wash" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stop-color="${wash.top}"/>
          <stop offset="100%" stop-color="${wash.bottom}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#wash)"/>
      <g
        transform="translate(${centreX} ${centreY}) scale(${scale}) translate(-48 -48)"
        fill="none"
        stroke="#2D2926"
        stroke-opacity="0.14"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M48 30a7 7 0 1 1 7 7c-4 0-7 2-7 6v3"/>
        <path d="M48 46 16 68c-3 2-2 6 2 6h60c4 0 5-4 2-6L48 46Z"/>
      </g>
    </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 84 }).toBuffer();
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
