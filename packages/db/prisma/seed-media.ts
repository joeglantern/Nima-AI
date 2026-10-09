/**
 * Placeholder imagery for development.
 *
 * Real photography comes from sellers. Until then the seed needs something
 * to render, and a blank grey box makes it impossible to judge layout. These
 * placeholders use the brand palette and name what they stand for, so the
 * screens can be reviewed honestly without pretending to be real products.
 *
 * They are never created outside development.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

/** Brand colours, from Nima's brand book. */
const PALETTE = [
  { background: '#5C2A33', ink: '#F5F0E8' },
  { background: '#A67C52', ink: '#2D2926' },
  { background: '#2D2926', ink: '#F5F0E8' },
  { background: '#FAF8F5', ink: '#5C2A33' },
  { background: '#C9A07A', ink: '#2D2926' },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A tall card with the name set in the brand serif. */
export async function placeholderImage(
  title: string,
  subtitle: string,
  index: number,
  size: { width: number; height: number } = { width: 900, height: 1200 },
): Promise<Buffer> {
  const colour = PALETTE[index % PALETTE.length] ?? PALETTE[0]!;
  const words = title.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if ((current + word).length > 14) {
      lines.push(current.trim());
      current = `${word} `;
    } else {
      current += `${word} `;
    }
  }
  if (current.trim()) lines.push(current.trim());

  const startY = size.height / 2 - (lines.length - 1) * 34;

  const svg = `
    <svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${colour.background}"/>
      <g font-family="Georgia, 'Times New Roman', serif" fill="${colour.ink}" text-anchor="middle">
        ${lines
          .map(
            (line, lineIndex) =>
              `<text x="50%" y="${startY + lineIndex * 68}" font-size="58">${escapeXml(line)}</text>`,
          )
          .join('')}
        <text x="50%" y="${startY + lines.length * 68 + 28}" font-size="24" font-family="system-ui, sans-serif" opacity="0.75" letter-spacing="3">${escapeXml(subtitle.toUpperCase())}</text>
      </g>
    </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
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
