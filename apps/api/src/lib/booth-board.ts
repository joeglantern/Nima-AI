/**
 * The scan to pay board a vendor prints for their booth.
 *
 * A5 at 300 dpi, burgundy edge to edge, so nobody at the event can mistake it
 * for a plain "download Nima" code. The QR sits on its own white card, which
 * keeps the contrast a camera needs and gives it more than its quiet zone.
 *
 * Text is drawn as vector outlines from fonts in this package rather than as
 * SVG text. Server images carry no system fonts, and SVG text there renders as
 * blanks or boxes without any error.
 */

import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import QRCode from 'qrcode';
import sharp from 'sharp';

const WIDTH = 1748;
const HEIGHT = 2480;
const INSET = 130;
const PRIMARY = '#5C2A33';
const ON_PRIMARY = '#FFFFFF';
const SOFT = '#F3E8E5';

/** High error correction, so a scratched or creased print still scans. */
const ERROR_CORRECTION = 'H';
/** The QR standard asks for four modules of clear space on every side. */
const QUIET_ZONE_MODULES = 4;
const QR_MAX_SIZE = 1320;

function loadFont(file: string): opentype.Font {
  const bytes = readFileSync(new URL(`../../assets/fonts/${file}`, import.meta.url));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

let titleFont: opentype.Font | undefined;
let bodyFont: opentype.Font | undefined;

function title(): opentype.Font {
  titleFont ??= loadFont('CormorantGaramond_600SemiBold.ttf');
  return titleFont;
}

function body(): opentype.Font {
  bodyFont ??= loadFont('DMSans_600SemiBold.ttf');
  return bodyFont;
}

/** One centred line of text as an SVG path. `y` is the baseline. */
function line(font: opentype.Font, text: string, size: number, y: number, fill: string): string {
  const x = (WIDTH - font.getAdvanceWidth(text, size)) / 2;
  return `<path fill="${fill}" d="${font.getPath(text, x, y, size).toPathData(1)}"/>`;
}

function wrap(font: opentype.Font, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.getAdvanceWidth(next, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  return lines;
}

/**
 * The shop's name, as large as it will go in the band at the top.
 *
 * Names are whatever the seller typed, so a long one drops in size, then wraps
 * to two lines, and only then gets cut.
 */
function shopName(name: string, top: number, bottom: number): string {
  const font = title();
  const width = WIDTH - INSET * 2;
  // A character the font does not have would print as an empty box.
  const text = [...name]
    .filter((char) => char === ' ' || font.hasChar(char))
    .join('')
    .trim();

  const fits = (lines: string[], size: number) =>
    lines.length <= 2 && lines.every((entry) => font.getAdvanceWidth(entry, size) <= width);

  let size = 170;
  while (size > 84 && !fits(wrap(font, text, size, width), size)) size -= 6;

  let lines = wrap(font, text, size, width);
  if (!fits(lines, size)) {
    let last = lines.slice(1).join(' ') || (lines[0] ?? '');
    while (last.length > 1 && font.getAdvanceWidth(`${last}...`, size) > width) {
      last = last.slice(0, -1);
    }
    lines = lines.length > 1 ? [lines[0] ?? '', `${last.trim()}...`] : [`${last.trim()}...`];
  }

  const leading = size * 1.08;
  const blockHeight = leading * (lines.length - 1) + size * 0.7;
  const firstBaseline = top + (bottom - top - blockHeight) / 2 + size * 0.7;

  return lines
    .map((entry, index) => line(font, entry, size, firstBaseline + leading * index, ON_PRIMARY))
    .join('');
}

async function render(input: { name: string; url: string }): Promise<Buffer> {
  const code = QRCode.create(input.url, { errorCorrectionLevel: ERROR_CORRECTION });
  const modules = code.modules.size + QUIET_ZONE_MODULES * 2;
  // A whole number of pixels per module, so every square prints sharp.
  const scale = Math.floor(QR_MAX_SIZE / modules);
  const qrSize = modules * scale;

  const qr = await QRCode.toBuffer(input.url, {
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: QUIET_ZONE_MODULES,
    scale,
    color: { dark: `${PRIMARY}FF`, light: '#FFFFFFFF' },
  });

  const cardPadding = 24;
  const cardSize = qrSize + cardPadding * 2;
  const cardLeft = Math.round((WIDTH - cardSize) / 2);
  const cardTop = 450;
  const cardBottom = cardTop + cardSize;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${PRIMARY}"/>
    ${shopName(input.name, 90, cardTop - 40)}
    <rect x="${cardLeft}" y="${cardTop}" width="${cardSize}" height="${cardSize}" rx="56" fill="#FFFFFF"/>
    ${line(body(), 'Scan to pay', 190, cardBottom + 270, ON_PRIMARY)}
    ${line(body(), 'Nima Checkout', 84, HEIGHT - 150, SOFT)}
  </svg>`;

  return sharp(Buffer.from(svg))
    .composite([{ input: qr, left: cardLeft + cardPadding, top: cardTop + cardPadding }])
    .withMetadata({ density: 300 })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}

/** Boards change only with a shop's name or the public address. */
const rendered = new Map<string, Promise<Buffer>>();
const KEEP = 64;

export function renderBoothBoard(input: { name: string; url: string }): Promise<Buffer> {
  const key = `${input.name}\n${input.url}`;
  const known = rendered.get(key);
  if (known) return known;

  const job = render(input);
  job.catch(() => rendered.delete(key));

  if (rendered.size >= KEEP) {
    const oldest = rendered.keys().next().value;
    if (oldest !== undefined) rendered.delete(oldest);
  }
  rendered.set(key, job);

  return job;
}
