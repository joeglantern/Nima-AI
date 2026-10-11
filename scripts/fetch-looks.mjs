/**
 * Fetch openly licensed outfit photographs for the feed's sample looks.
 *
 *   node scripts/fetch-looks.mjs candidates   search, download, lay out sheets
 *   node scripts/fetch-looks.mjs keep a,b,c   keep the numbered candidates
 *
 * The source is Wikimedia Commons, whose Wiki Loves Africa contest had
 * fashion as a theme: hundreds of photographs of people dressed up in
 * kitenge, Ankara, kanga and everyday city clothes, taken by the people
 * who live there. Only CC0, public domain, CC BY and CC BY-SA files are
 * taken, and the author, licence and page of each are written to the
 * manifest so every look can carry its credit. The API needs no key.
 *
 * Choosing is done by eye. The search is broad and Commons is a library,
 * not a lookbook, so `candidates` writes numbered contact sheets and
 * `keep` copies the chosen ones into the seed folder.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, 'packages', 'db', 'prisma', 'seed-assets', 'looks');
const CANDIDATES = join(root, '.look-candidates');
const AGENT = 'nima-seed/0.1 (development seed for a fashion app)';

const QUERIES = [
  'kitenge dress',
  'kitenge outfit',
  'Ankara fashion',
  'African fashion outfit',
  'African print dress',
  'Lagos fashion week',
  'Wiki Loves Africa fashion',
  'kanga fashion',
  'dashiki outfit',
  'Kenyan fashion',
  'Nairobi fashion',
  'Ghana fashion kente outfit',
  'headwrap fashion',
  'African wedding attire',
  'fashion week model runway Africa',
  'modern african dressing',
];

const OPEN = /^(CC0|Public domain|CC BY(-SA)? (2\.0|2\.5|3\.0|4\.0))$/i;

const strip = (html = '') =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function search(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  const params = {
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '50',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1080',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { headers: { 'user-agent': AGENT } });
  if (!response.ok) throw new Error(`${query}: ${response.status}`);
  const data = await response.json();
  return Object.values(data.query?.pages ?? {});
}

async function candidates() {
  await rm(CANDIDATES, { recursive: true, force: true });
  await mkdir(CANDIDATES, { recursive: true });

  const seen = new Set();
  const found = [];

  for (const query of QUERIES) {
    const pages = await search(query);
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info || seen.has(page.title)) continue;
      const licence = info.extmetadata?.LicenseShortName?.value ?? '';
      const portrait = info.height >= info.width * 1.15;
      if (!portrait || info.width < 900 || !OPEN.test(licence)) continue;
      seen.add(page.title);
      found.push({
        title: page.title.replace(/^File:/, ''),
        page: info.descriptionurl,
        thumb: info.thumburl,
        licence,
        licenceUrl: info.extmetadata?.LicenseUrl?.value ?? null,
        author: strip(info.extmetadata?.Artist?.value) || 'Unknown',
        query,
      });
    }
    await sleep(300);
  }

  console.info(`${found.length} candidates. Downloading.`);

  const kept = [];
  for (const [index, item] of found.entries()) {
    try {
      const response = await fetch(item.thumb, { headers: { 'user-agent': AGENT } });
      if (!response.ok) continue;
      const file = `${String(kept.length).padStart(3, '0')}.jpg`;
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(
        join(CANDIDATES, file),
        await sharp(bytes).rotate().resize({ width: 1080 }).jpeg({ quality: 86 }).toBuffer(),
      );
      kept.push({ ...item, file });
    } catch {
      // A file that will not download is not worth chasing.
    }
    if (index % 10 === 9) await sleep(400);
  }

  await writeFile(join(CANDIDATES, 'candidates.json'), JSON.stringify(kept, null, 2));
  await sheets(kept);
  console.info(`${kept.length} downloaded into ${CANDIDATES}`);
}

/** Numbered contact sheets of 24, for choosing by eye. */
async function sheets(items) {
  const per = 24;
  const cols = 6;
  const cell = { width: 240, height: 320 };

  for (let start = 0; start < items.length; start += per) {
    const chunk = items.slice(start, start + per);
    const rows = Math.ceil(chunk.length / cols);
    const tiles = await Promise.all(
      chunk.map(async (item, offset) => {
        const label = Buffer.from(
          `<svg width="${cell.width}" height="34"><rect width="100%" height="100%" fill="black" opacity="0.7"/><text x="8" y="24" font-size="22" font-family="sans-serif" fill="white">${start + offset}</text></svg>`,
        );
        const input = await sharp(join(CANDIDATES, item.file))
          .resize(cell.width, cell.height, { fit: 'cover', position: 'attention' })
          .composite([{ input: label, top: 0, left: 0 }])
          .toBuffer();
        return {
          input,
          left: (offset % cols) * cell.width,
          top: Math.floor(offset / cols) * cell.height,
        };
      }),
    );

    await sharp({
      create: {
        width: cols * cell.width,
        height: rows * cell.height,
        channels: 3,
        background: '#222',
      },
    })
      .composite(tiles)
      .jpeg({ quality: 80 })
      .toFile(join(CANDIDATES, `sheet-${start / per}.jpg`));
  }
}

async function keep(numbers) {
  const all = JSON.parse(await readFile(join(CANDIDATES, 'candidates.json'), 'utf8'));
  await mkdir(OUT, { recursive: true });
  for (const file of await readdir(OUT)) await rm(join(OUT, file));

  const manifest = [];
  for (const [position, number] of numbers.entries()) {
    const item = all[number];
    if (!item) throw new Error(`No candidate ${number}`);
    const file = `look-${String(position).padStart(2, '0')}.jpg`;
    const bytes = await readFile(join(CANDIDATES, item.file));
    // A 4:5 crop, the feed's tallest card, centred on whoever is in it.
    await sharp(bytes)
      .resize(1080, 1350, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toFile(join(OUT, file));
    manifest.push({
      file,
      title: item.title,
      author: item.author,
      licence: item.licence,
      licenceUrl: item.licenceUrl,
      page: item.page,
    });
  }

  await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.info(`${manifest.length} kept in ${OUT}`);
}

const [command, list] = process.argv.slice(2);
if (command === 'candidates') await candidates();
else if (command === 'keep' && list) await keep(list.split(',').map((n) => Number(n.trim())));
else console.info('Usage: node scripts/fetch-looks.mjs candidates | keep 3,7,12');
