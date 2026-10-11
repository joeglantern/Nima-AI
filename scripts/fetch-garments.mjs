/**
 * Fetch openly licensed garment photographs for the development seed.
 *
 *   node scripts/fetch-garments.mjs          fetch, then lay out a sheet
 *   node scripts/fetch-garments.mjs --sheet  just lay out what is there
 *
 * The source is the Metropolitan Museum's Open Access collection: its
 * Costume Institute holds tens of thousands of garments, photographed one
 * at a time against plain backgrounds, which is the same picture a shop
 * takes of a product. Everything marked public domain there is released
 * CC0, so there is no attribution condition and nothing is being used on
 * terms it was not offered under. The API needs no key.
 *
 * Openverse was tried first and is a better fit on paper, being a search
 * across Flickr and the museums at once. Two things ruled it out: it rate
 * limits anonymous callers to a handful of queries and then answers 401,
 * and an open image search for "dress" surfaces plenty that has no place
 * in a shop. A curated museum collection has neither problem.
 *
 * These are still not product photography. Real pictures come from
 * sellers. See docs/ASSETS.md.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, 'packages', 'db', 'prisma', 'seed-assets', 'garments');

const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
// Search moved to v1.1 and the old path answers 410. Objects stayed on v1.
const SEARCH = 'https://collectionapi.metmuseum.org/public/collection/v1.1';
const COSTUME = 8;
const AGENT = 'nima-seed/0.1 (development seed for a fashion app)';

/**
 * What to collect, and how much of it.
 *
 * Enough of each that a category filter in the shop has something to show
 * and the masonry has something to stagger.
 */
const WANTED = [
  { category: 'TOP', queries: ['blouse', 'shirt', 'sweater'], take: 10 },
  { category: 'BOTTOM', queries: ['skirt', 'trousers'], take: 8 },
  { category: 'DRESS', queries: ['evening dress', 'dress'], take: 12 },
  { category: 'OUTERWEAR', queries: ['coat', 'jacket'], take: 8 },
  { category: 'SHOES', queries: ['shoes', 'boots'], take: 8 },
  { category: 'BAG', queries: ['handbag', 'purse'], take: 6 },
  { category: 'JEWELLERY', queries: ['necklace', 'brooch'], take: 5 },
  { category: 'HEADWEAR', queries: ['hat', 'bonnet'], take: 5 },
];

/** Not every costume photograph is of a garment on its own. */
const REJECT = /fragment|textile sample|swatch|doll|paper|drawing|print|photograph of/i;

/**
 * One request, backing off when the museum says slow down.
 *
 * The Met counts every call against one limit, so a burst of object reads
 * makes the next search answer 403. The first version of this fired as
 * fast as it could and collected three pictures before being shut out.
 */
async function polite(url, { attempts = 5 } = {}) {
  let wait = 1200;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': AGENT } });

    if (response.ok) return response;

    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      if (attempt === attempts) throw new Error(`${response.status} after ${attempts} tries`);
      await sleep(wait);
      wait *= 2;
      continue;
    }

    throw new Error(`${response.status} for ${url}`);
  }

  throw new Error('unreachable');
}

async function json(url) {
  return (await polite(url)).json();
}

async function idsFor(query) {
  const url =
    `${SEARCH}/search?q=${encodeURIComponent(query)}` +
    `&hasImages=true&isPublicDomain=true&departmentId=${COSTUME}`;

  try {
    const found = await json(url);
    return found.objectIDs ?? [];
  } catch (error) {
    console.warn(`  could not search "${query}":`, error.message);
    return [];
  }
}

async function fetchGroup(group, used, ids) {
  let kept = 0;
  const manifest = [];

  {
    for (const id of ids) {
      if (kept >= group.take) break;
      if (used.has(id)) continue;
      used.add(id);

      let object;
      try {
        object = await json(`${BASE}/objects/${id}`);
      } catch {
        continue;
      }

      // Belt and braces: the search says public domain, the object is
      // asked again before anything is downloaded.
      if (!object.isPublicDomain) continue;

      const source = object.primaryImage || object.primaryImageSmall;
      if (!source) continue;

      const described = `${object.title ?? ''} ${object.objectName ?? ''} ${object.classification ?? ''}`;
      if (REJECT.test(described)) continue;

      try {
        const response = await fetch(source, { headers: { 'User-Agent': AGENT } });
        if (!response.ok) continue;

        const bytes = Buffer.from(await response.arrayBuffer());
        const meta = await sharp(bytes).metadata();

        // A thumbnail stretched into a product tile looks worse than no
        // photograph at all.
        if ((meta.width ?? 0) < 500 || (meta.height ?? 0) < 500) continue;

        const file = `${group.category.toLowerCase()}-${String(kept + 1).padStart(2, '0')}.jpg`;

        await sharp(bytes)
          .rotate()
          // A product photograph is portrait, and the garment is the
          // interesting part, so the crop follows it rather than the middle.
          .resize(900, 1200, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: 82 })
          .toFile(join(OUT, file));

        manifest.push({
          file,
          category: group.category,
          title: object.title || object.objectName || 'Untitled',
          maker: object.artistDisplayName || object.culture || 'Unknown',
          date: object.objectDate ?? null,
          licence: 'CC0 1.0',
          source: object.objectURL,
        });

        kept += 1;
      } catch {
        // One bad download is not worth stopping the run for.
      }

      // The Met asks callers to be reasonable. This is reasonable.
      await sleep(400);
    }
  }

  console.info(`${group.category.padEnd(10)} ${kept}/${group.take}`);
  return manifest;
}

async function contactSheet() {
  const files = (await readdir(OUT)).filter((name) => name.endsWith('.jpg')).sort();
  if (files.length === 0) {
    console.info('nothing to lay out');
    return;
  }

  const columns = 9;
  const cell = 130;
  const rows = Math.ceil(files.length / columns);

  const composites = await Promise.all(
    files.map(async (file, index) => ({
      input: await sharp(join(OUT, file))
        .resize(cell - 6, cell - 6, { fit: 'cover' })
        .png()
        .toBuffer(),
      left: (index % columns) * cell + 3,
      top: Math.floor(index / columns) * cell + 3,
    })),
  );

  await sharp({
    create: { width: columns * cell, height: rows * cell, channels: 4, background: '#E9E4DC' },
  })
    .composite(composites)
    .png()
    .toFile(join(root, '.garment-sheet.png'));

  console.info(`\ncontact sheet: .garment-sheet.png (${files.length} images)`);
}

if (!process.argv.includes('--sheet')) {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const used = new Set();
  const images = [];

  // Every search first, spaced out, so the limiter never sees a burst of
  // reads followed by a search.
  console.info('looking through the collection');
  const found = new Map();

  for (const group of WANTED) {
    const ids = [];
    for (const query of group.queries) {
      ids.push(...(await idsFor(query)));
      await sleep(900);
    }
    found.set(group.category, ids);
    console.info(`  ${group.category.padEnd(10)} ${ids.length} candidates`);
  }

  console.info('\nfetching');
  for (const group of WANTED) {
    images.push(...(await fetchGroup(group, used, found.get(group.category) ?? [])));
  }

  await writeFile(
    join(OUT, 'manifest.json'),
    `${JSON.stringify(
      {
        note:
          'Development seed imagery from the Metropolitan Museum Open Access ' +
          'collection, all CC0. Not product photography: real pictures come ' +
          'from sellers.',
        fetched: new Date().toISOString(),
        images,
      },
      null,
      2,
    )}\n`,
  );

  console.info(`\n${images.length} images, manifest written`);
}

await contactSheet();
