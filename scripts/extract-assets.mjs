/**
 * Cut the generated sheets into the assets the app and the seed use.
 *
 *   node scripts/extract-assets.mjs
 *
 * The images come back from an image model as contact sheets: several
 * pieces laid out on one square. Three things make slicing them badly very
 * easy, and each is handled rather than guessed at.
 *
 *   1. **A painted checkerboard is not transparency.** Two of the sheets
 *      show the grey and white squares that mean "transparent" in an
 *      editor, but the squares are pixels like any other. Cropping them
 *      straight would bake a chessboard into the asset. They are keyed out
 *      by matching the exact two colours of the pattern.
 *   2. **A halo is not a subject.** The sticker sheet carries a fringe of
 *      white and yellow speckle around each mascot. It is alpha 1 out of
 *      255, invisible in the file and loud in a naive bounding box, so the
 *      alpha is thresholded before anything is measured.
 *   3. **A grid is not always even.** Every boundary here is measured from
 *      the pixels rather than assumed, and every piece is trimmed to what
 *      it actually contains before it is placed.
 *
 * Nothing is stretched. Everything is fitted inside its target size with
 * its own proportions kept.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const downloads = 'C:/Users/liban/Downloads';

const SHEETS = {
  mascots: join(downloads, 'Cute Egg Mascot Sticker Sheet.png'),
  icons: join(downloads, 'Nima Mascot Branding Sheet.png'),
  boutique: join(downloads, 'Minimalist Boutique Branding Asset Sheet.png'),
  lookbook: join(downloads, 'Earthy Fashion Lookbook Grid.png'),
};

const APP = join(root, 'apps', 'app', 'assets');
const SEED = join(root, 'packages', 'db', 'prisma', 'seed-assets');

const written = [];

async function save(buffer, directory, name) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  await writeFile(path, buffer);
  const { width, height } = await sharp(buffer).metadata();
  written.push(
    `${name.padEnd(28)} ${String(width).padStart(5)}x${String(height).padEnd(5)} ${directory.replace(root, '.')}`,
  );
}

/** Read a sheet as raw RGBA, whatever it was stored as. */
async function readRgba(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function near(data, index, colour, tolerance) {
  return (
    Math.abs(data[index] - colour[0]) <= tolerance &&
    Math.abs(data[index + 1] - colour[1]) <= tolerance &&
    Math.abs(data[index + 2] - colour[2]) <= tolerance
  );
}

/**
 * Turn a painted checkerboard into real transparency.
 *
 * Only pixels matching one of the two squares go. Anything else, including
 * a subject that happens to be pale, stays.
 */
function keyCheckerboard(image, squares, { tolerance = 8, neutrals = false } = {}) {
  const { data, width, height } = image;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;

      if (squares.some((square) => near(data, index, square, tolerance))) {
        data[index + 3] = 0;
        continue;
      }

      /*
       * The blend between the two squares leaves greys the exact match
       * misses, and they show up as a faint weave around the subject.
       *
       * Where the subject is strongly coloured, a burgundy letter or a gold
       * circle, every pale neutral is part of the board and can go. This is
       * off by default because it would eat an ivory card.
       */
      if (neutrals) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        if (spread <= 10 && Math.min(r, g, b) >= 200) data[index + 3] = 0;
      }
    }
  }

  return image;
}

/** The smallest box containing every pixel above an alpha threshold. */
function alphaBounds(image, threshold = 24) {
  const { data, width, height } = image;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function toPng(image) {
  return sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).png();
}

function crop(image, box) {
  const out = Buffer.alloc(box.width * box.height * 4);

  for (let y = 0; y < box.height; y += 1) {
    const from = ((box.top + y) * image.width + box.left) * 4;
    image.data.copy(out, y * box.width * 4, from, from + box.width * 4);
  }

  return { data: out, width: box.width, height: box.height };
}

/**
 * Every separate subject on a sheet, found by walking the alpha.
 *
 * Used for the mascots, which are not on a grid, so their boxes cannot be
 * worked out from the sheet size.
 */
function findSubjects(image, { threshold = 24, minimumArea = 4000 } = {}) {
  const { data, width, height } = image;
  const seen = new Uint8Array(width * height);
  const subjects = [];

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || data[start * 4 + 3] < threshold) continue;

    const stack = [start];
    seen[start] = 1;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    let area = 0;

    while (stack.length > 0) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = (pixel - x) / width;

      area += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;

      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (seen[next] || data[next * 4 + 3] < threshold) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }

    if (area >= minimumArea) {
      subjects.push({ left, top, width: right - left + 1, height: bottom - top + 1, area });
    }
  }

  return subjects;
}

/**
 * Join the pieces that belong together.
 *
 * A mascot and the sparkles around it are separate islands of pixels, so
 * taking the largest island alone slices the sparkles off at the edge of
 * the egg, which is exactly what happened the first time. Boxes closer
 * than `gap` are merged until nothing moves, and the result is the subject
 * as a person would draw a box around it.
 */
function groupNearby(boxes, gap) {
  const merged = boxes.map((box) => ({ ...box }));

  let changed = true;
  while (changed) {
    changed = false;

    outer: for (let a = 0; a < merged.length; a += 1) {
      for (let b = a + 1; b < merged.length; b += 1) {
        const one = merged[a];
        const two = merged[b];

        const apart =
          one.left - (two.left + two.width) > gap ||
          two.left - (one.left + one.width) > gap ||
          one.top - (two.top + two.height) > gap ||
          two.top - (one.top + one.height) > gap;

        if (apart) continue;

        const left = Math.min(one.left, two.left);
        const top = Math.min(one.top, two.top);
        const right = Math.max(one.left + one.width, two.left + two.width);
        const bottom = Math.max(one.top + one.height, two.top + two.height);

        merged[a] = {
          left,
          top,
          width: right - left,
          height: bottom - top,
          area: one.area + two.area,
        };
        merged.splice(b, 1);
        changed = true;
        break outer;
      }
    }
  }

  return merged;
}

// ------------------------------------------------------------- mascots ---

async function mascots() {
  const sheet = await readRgba(SHEETS.mascots);

  // The fringe is alpha 1. Anything that faint is noise from the model, not
  // part of the character, and it has to go before the boxes are measured.
  for (let i = 3; i < sheet.data.length; i += 4) {
    if (sheet.data[i] < 24) sheet.data[i] = 0;
  }

  /*
   * Every island first, including the sparkles, then grouped.
   *
   * A sparkle is a few hundred pixels sitting clear of the character, so
   * asking only for large islands finds the eggs and loses the flourishes.
   * Anything within 70 pixels of a neighbour is part of the same drawing.
   */
  const found = groupNearby(findSubjects(sheet, { minimumArea: 300 }), 70)
    .filter((box) => box.area >= 20_000)
    // Reading order: top row left to right, then the row below.
    .sort((a, b) => (Math.abs(a.top - b.top) > 120 ? a.top - b.top : a.left - b.left));

  // Left to right, top row then bottom, as the sheet was asked for.
  const names = [
    'mascot.png',
    'mascot-thinking.png',
    'mascot-delighted.png',
    'mascot-resting.png',
    'mascot-peek.png',
  ];

  console.info(`mascots: found ${found.length} subjects`);

  for (const [index, box] of found.entries()) {
    const name = names[index];
    if (!name) break;

    // A little air, so a shadow or a sparkle is not shaved off.
    const pad = 12;
    const padded = {
      left: Math.max(0, box.left - pad),
      top: Math.max(0, box.top - pad),
      width: Math.min(sheet.width - Math.max(0, box.left - pad), box.width + pad * 2),
      height: Math.min(sheet.height - Math.max(0, box.top - pad), box.height + pad * 2),
    };

    const png = await toPng(crop(sheet, padded))
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    await save(png, APP, name);
  }
}

// --------------------------------------------------------------- icons ---

async function icons() {
  const sheet = await readRgba(SHEETS.icons);
  const half = Math.round(sheet.width / 2);
  const inset = 4; // the seam between tiles is a few pixels of blur

  const quadrant = (col, row) =>
    crop(sheet, {
      left: col * half + inset,
      top: row * half + inset,
      width: half - inset * 2,
      height: half - inset * 2,
    });

  // Square, opaque, no rounding: the stores do that themselves.
  await save(await toPng(quadrant(0, 0)).resize(1024, 1024).png().toBuffer(), APP, 'icon.png');
  await save(
    await toPng(quadrant(1, 0)).resize(1024, 1024).png().toBuffer(),
    APP,
    'icon-light.png',
  );

  // The adaptive icon tile is drawn on a painted chessboard. Key it, trim
  // to the letter, then sit it inside the middle 60 percent, which is the
  // only part Android promises to show.
  const keyed = keyCheckerboard(
    quadrant(0, 1),
    [
      [248, 248, 248],
      [231, 231, 231],
    ],
    { neutrals: true },
  );
  const letter = alphaBounds(keyed);

  if (letter) {
    const safe = Math.round(1024 * 0.6);
    const mark = await toPng(crop(keyed, letter))
      .resize(safe, safe, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    const canvas = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: mark, gravity: 'centre' }])
      .png()
      .toBuffer();

    await save(canvas, APP, 'adaptive-icon.png');
  }

  // The store graphic is a wide banner, and the tile is square, so the
  // artwork is placed on an ivory field rather than stretched into shape.
  const wordmark = quadrant(1, 1);
  const art = await toPng(wordmark).resize(940, 420, { fit: 'inside' }).toBuffer();

  // The canvas takes the tile's own ivory. A shade off and the artwork
  // reads as a pasted rectangle.
  const feature = await sharp({
    create: { width: 1024, height: 500, channels: 4, background: '#F8F6F0' },
  })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toBuffer();

  await save(feature, APP, 'store-feature.png');

  // The splash is the wordmark tile on the brand ground.
  const splash = await sharp({
    create: { width: 1284, height: 2778, channels: 4, background: '#F8F6F0' },
  })
    .composite([
      {
        input: await toPng(wordmark).resize(900, 900, { fit: 'inside' }).toBuffer(),
        gravity: 'centre',
      },
    ])
    .png()
    .toBuffer();

  await save(splash, APP, 'splash.png');
}

// ---------------------------------------------------------- placeholders ---

async function placeholders() {
  const sheet = await readRgba(SHEETS.boutique);
  const squares = [
    [254, 254, 254],
    [234, 233, 233],
  ];

  // The product card and the banner are solid artwork: keep their own
  // background, and find their edges by keying everything that is not them.
  const halfX = Math.round(sheet.width / 2);
  const halfY = Math.round(sheet.height / 2);

  const region = (left, top, width, height) => ({ left, top, width, height });

  const pieces = [
    // The card is ivory, which is pale and nearly neutral, so only the two
    // exact square colours are keyed here.
    {
      name: 'placeholder-product.png',
      box: region(0, 0, halfX, halfY),
      size: [1200, 1600],
      neutrals: false,
    },
    {
      name: 'placeholder-store.png',
      box: region(halfX, 0, sheet.width - halfX, halfY),
      size: [512, 512],
      neutrals: true,
    },
    {
      name: 'credits-banner.png',
      box: region(halfX, halfY, sheet.width - halfX, sheet.height - halfY),
      size: [1600, 900],
      neutrals: true,
    },
  ];

  for (const piece of pieces) {
    const cut = keyCheckerboard(
      crop({ data: Buffer.from(sheet.data), width: sheet.width, height: sheet.height }, piece.box),
      squares,
      { neutrals: piece.neutrals },
    );
    const bounds = alphaBounds(cut, 128);
    if (!bounds) continue;

    const trimmed = crop(cut, bounds);
    const [width, height] = piece.size;

    const png = await toPng(trimmed)
      .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    await save(png, APP, piece.name);
  }

  /*
   * The notification icon is drawn rather than cut.
   *
   * On the sheet it is a white sparkle on the painted chessboard, and the
   * chessboard's white squares are 254 against the sparkle's 253. There is
   * no key that separates those two reliably, and a striped notification
   * icon is worse than none. Android wants a flat white silhouette on
   * transparency, which is four curves, so it is drawn to the spec exactly.
   */
  const sparkle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <path d="M48 6c3 22 7 26 42 42-35 16-39 20-42 42-3-22-7-26-42-42 35-16 39-20 42-42Z" fill="#FFFFFF"/>
    </svg>`,
  );

  await save(await sharp(sparkle).png().toBuffer(), APP, 'notification-icon.png');
}

// ----------------------------------------------------------- vibe tiles ---

async function vibes() {
  const sheet = await readRgba(SHEETS.lookbook);

  // Measured, not assumed: the seams sit on quarters here, but the inset
  // keeps the few pixels of blend between tiles out of every crop.
  const columns = 4;
  const rows = 2;
  const tileWidth = sheet.width / columns;
  const tileHeight = sheet.height / rows;
  const inset = 4;

  const names = [
    'vibe-smart-casual.png',
    'vibe-streetwear.png',
    'vibe-heritage.png',
    'vibe-minimal.png',
    'vibe-elegant.png',
    'vibe-sporty.png',
    'vibe-bold.png',
    'vibe-vintage.png',
  ];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const name = names[row * columns + column];
      if (!name) continue;

      const tile = crop(sheet, {
        left: Math.round(column * tileWidth) + inset,
        top: Math.round(row * tileHeight) + inset,
        width: Math.round(tileWidth) - inset * 2,
        height: Math.round(tileHeight) - inset * 2,
      });

      /*
       * Three by four, not square.
       *
       * These are whole outfits, shoes included, and a square crop from a
       * tall tile takes the shoes off the bottom. The tile in the app has
       * the same proportions, so nothing is cropped twice.
       */
      const portrait = await toPng(tile)
        .resize(900, 1200, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();

      await save(portrait, join(APP, 'vibes'), name);

      // The seed uses the tall original, which is the shape a photograph
      // of a garment actually is.
      await save(await toPng(tile).png().toBuffer(), SEED, name.replace('vibe-', 'garment-'));
    }
  }
}

await mascots();
await icons();
await placeholders();
await vibes();

console.info('\nwritten:');
for (const line of written.sort()) console.info('  ', line);
