/**
 * Placeholder app icons, in the brand colours.
 *
 * These exist so the app builds and so the icon on a test device is not a
 * default Expo logo. They are not the final artwork: the real icon, the
 * mascot and the illustrations come from the design work, and this script is
 * deleted once those land.
 *
 *   node scripts/make-placeholder-assets.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');

const PRIMARY = '#5C2A33';
const GROUND = '#FAF8F5';

/** The wordmark letter, set in a serif to match Cormorant Garamond. */
function mark({ size, background, ink, letter = 'N', padding = 0 }) {
  const fontSize = Math.round((size - padding * 2) * 0.56);

  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      ${background === 'none' ? '' : `<rect width="${size}" height="${size}" fill="${background}"/>`}
      <text
        x="50%" y="50%"
        dy="0.35em"
        text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${fontSize}"
        fill="${ink}"
      >${letter}</text>
    </svg>`);
}

/**
 * A stand-in for the mascot in the design: a rounded character with a cream
 * top and a warm lower half. Replaced by the real illustration.
 */
function mascot(size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FFFDF7"/>
          <stop offset="52%" stop-color="#F6EEDF"/>
          <stop offset="53%" stop-color="#C9A07A"/>
          <stop offset="100%" stop-color="#A67C52"/>
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="108" rx="52" ry="66" fill="url(#body)"/>
      <path d="M78 96c4-5 10-5 14 0" stroke="#5C2A33" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M108 96c4-5 10-5 14 0" stroke="#5C2A33" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M90 114c6 7 14 7 20 0" stroke="#5C2A33" stroke-width="4" stroke-linecap="round" fill="none"/>
      <circle cx="152" cy="74" r="6" fill="#A67C52"/>
      <circle cx="48" cy="118" r="5" fill="#C9A07A"/>
      <path d="M150 112l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#C9A07A"/>
      <path d="M52 66l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" fill="#A67C52"/>
    </svg>`);
}

async function main() {
  await mkdir(assets, { recursive: true });

  const files = [
    { name: 'icon.png', size: 1024, background: PRIMARY, ink: GROUND },
    { name: 'adaptive-icon.png', size: 1024, background: 'none', ink: PRIMARY, padding: 220 },
    { name: 'splash.png', size: 512, background: 'none', ink: PRIMARY },
    { name: 'favicon.png', size: 64, background: PRIMARY, ink: GROUND },
  ];

  for (const file of files) {
    const png = await sharp(mark(file)).png().toBuffer();
    await writeFile(join(assets, file.name), png);
    console.info(`  ${file.name}`);
  }

  await writeFile(join(assets, 'mascot.png'), await sharp(mascot(512)).png().toBuffer());
  console.info('  mascot.png');

  // A minimal web manifest so the browser tab and an installed web app both
  // use the brand colours.
  await writeFile(
    join(assets, 'site.webmanifest'),
    `${JSON.stringify(
      {
        name: 'Nima',
        short_name: 'Nima',
        description: 'Your personal AI stylist. See yourself in every outfit.',
        start_url: '/',
        display: 'standalone',
        background_color: GROUND,
        theme_color: PRIMARY,
      },
      null,
      2,
    )}\n`,
  );

  console.info('  site.webmanifest');
}

main().catch((error) => {
  console.error('Could not write the placeholder assets:', error);
  process.exit(1);
});
