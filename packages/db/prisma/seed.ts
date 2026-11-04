/**
 * Sample data.
 *
 * Enough of a world to work against and to show people: two Nairobi shops, a
 * demo shopper, and the outfits in looks.ts with every piece in them for
 * sale. Prices are realistic KES so the interface is designed against numbers
 * of the right shape.
 *
 * Safe to run repeatedly: everything is keyed by a stable slug or handle.
 *
 *   tsx prisma/seed.ts                     fill in whatever is missing
 *   tsx prisma/seed.ts --replace-looks     rebuild the curated looks
 *   tsx prisma/seed.ts --replace-catalogue clear the sample shops, then rebuild
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { type GarmentSlot, PrismaClient, type ProductCategory } from '../generated/client/index.js';
import { SEED_LOOKS, type SeedSlot } from './looks.js';
import { createSeedUploader } from './seed-media.js';

// Configuration lives in one .env at the repository root.
loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

const prisma = new PrismaClient();

const upload = createSeedUploader({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:3960',
  region: process.env.S3_REGION ?? 'garage',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  bucket: process.env.S3_BUCKET ?? 'nima-media',
});

const KES = (shillings: number) => shillings * 100;

const SAMPLE_STORES = [
  {
    slug: 'kanzu-collective',
    name: 'Kanzu Collective',
    about: 'Tailored African print and linen, cut and sewn in Nairobi. Made to order in five days.',
    county: 'Nairobi',
    verified: true,
  },
  {
    slug: 'sote-street',
    name: 'Sote Street',
    about: 'Streetwear and good mitumba out of Eastlands. Picked, washed and pressed.',
    county: 'Nairobi',
    verified: false,
  },
];

/** The shop category each slot in a look sells under. */
const CATEGORY_FOR_SLOT: Record<SeedSlot, ProductCategory> = {
  TOP: 'TOP',
  BOTTOM: 'BOTTOM',
  FULL_BODY: 'DRESS',
  OUTERWEAR: 'OUTERWEAR',
  SHOES: 'SHOES',
  BAG: 'BAG',
  JEWELLERY: 'JEWELLERY',
  EYEWEAR: 'EYEWEAR',
  HEADWEAR: 'HEADWEAR',
};

/**
 * Clear the sample catalogue so it can be seeded afresh.
 *
 * Only what the seed itself created: the products of the sample stores and
 * the curated looks. Real people's posts and shops are never touched. A
 * product that was ordered is archived rather than deleted, because an order
 * has to keep pointing at what was sold.
 */
async function replaceCatalogue(): Promise<void> {
  const sampleStores = await prisma.store.findMany({
    where: { owner: { email: { in: SAMPLE_STORES.map((store) => `${store.slug}@example.com`) } } },
    select: { id: true },
  });
  const storeIds = sampleStores.map((store) => store.id);

  const looks = await prisma.look.deleteMany({ where: { source: 'CURATED' } });
  if (storeIds.length === 0) return;

  await prisma.cartItem.deleteMany({ where: { product: { storeId: { in: storeIds } } } });

  const archived = await prisma.product.updateMany({
    where: { storeId: { in: storeIds }, orderItems: { some: {} } },
    data: { status: 'ARCHIVED' },
  });
  const removed = await prisma.product.deleteMany({
    where: { storeId: { in: storeIds }, orderItems: { none: {} } },
  });

  console.info(
    `Cleared: ${looks.count} looks, ${removed.count} products removed, ${archived.count} archived (ordered)`,
  );
}

/**
 * The curated looks, from seed-assets/looks, and the pieces in them, from
 * seed-assets/pieces.
 *
 * Each look belongs to nobody, which is what the feed shows as Nima's own,
 * and each of its pieces is listed in one of the two sample shops. The set
 * is rebuilt only when asked or when the photographs change, so loves and
 * comments people left on them survive an ordinary seed.
 */
async function seedLooks(force: boolean): Promise<void> {
  const assets = join(dirname(fileURLToPath(import.meta.url)), 'seed-assets');

  const existing = await prisma.look.findMany({
    where: { source: 'CURATED' },
    select: { coverKey: true },
  });
  const wanted = new Set(SEED_LOOKS.map((look) => `seed/looks/${look.file}`));
  const current =
    existing.length === wanted.size && existing.every((look) => wanted.has(look.coverKey ?? ''));

  if (current && !force) {
    for (const look of SEED_LOOKS) {
      await prisma.look.updateMany({
        where: { source: 'CURATED', coverKey: `seed/looks/${look.file}` },
        data: { occasions: look.occasions },
      });
    }
    return;
  }

  await prisma.look.deleteMany({ where: { source: 'CURATED' } });

  // Newest first in the feed, so the order of the list is the order shown.
  const now = Date.now();

  for (const [index, look] of SEED_LOOKS.entries()) {
    const postedAt = new Date(now - index * 47 * 60 * 1000);
    const coverKey = `seed/looks/${look.file}`;
    await upload(coverKey, await readFile(join(assets, 'looks', look.file)));

    const store = await prisma.store.findUniqueOrThrow({ where: { slug: look.store } });
    const productIds: string[] = [];

    for (const piece of look.pieces) {
      const product = await prisma.product.upsert({
        where: { slug: piece.slug },
        create: {
          storeId: store.id,
          title: piece.title,
          slug: piece.slug,
          description: piece.description,
          category: CATEGORY_FOR_SLOT[piece.slot],
          colours: piece.colours,
          tags: [],
          occasions: look.occasions,
          status: 'ACTIVE',
          publishedAt: postedAt,
          priceFromCents: KES(piece.price),
          inStock: true,
          variants: {
            create: piece.sizes.map((size) => ({
              size,
              colour: piece.colours[0] ?? null,
              priceCents: KES(piece.price),
              stock: 8,
            })),
          },
        },
        update: {},
      });
      productIds.push(product.id);

      const pictureKey = `seed/pieces/${piece.slug}.jpg`;
      await upload(pictureKey, await readFile(join(assets, 'pieces', `${piece.slug}.jpg`)));

      // Where a ghost shot exists (seed-assets/ghost, made with the words
      // the media worker uses), the piece hangs on the shop's rail.
      const ghostKey = `seed/ghost/${piece.slug}.jpg`;
      const ghost = await readFile(join(assets, 'ghost', `${piece.slug}.jpg`)).catch(() => null);
      if (ghost) await upload(ghostKey, ghost);

      await prisma.productImage.deleteMany({ where: { productId: product.id } });
      await prisma.productImage.create({
        data: {
          productId: product.id,
          originalKey: pictureKey,
          processedKey: ghost ? ghostKey : pictureKey,
          processing: ghost ? 'GHOST_MANNEQUIN' : 'NONE',
          isPrimary: true,
          position: 0,
          width: ghost ? 1200 : 1080,
          height: ghost ? 1600 : 1350,
        },
      });
    }

    await prisma.look.create({
      data: {
        ownerId: null,
        coverKey,
        width: 1080,
        height: 1350,
        title: look.title,
        caption: look.caption,
        nimaSays: look.nimaSays,
        occasions: look.occasions,
        source: 'CURATED',
        visibility: 'PUBLIC',
        publishedAt: postedAt,
        createdAt: postedAt,
        likeCount: look.likes,
        saveCount: Math.round(look.likes / 4),
        items: {
          create: look.pieces.map((piece, position) => ({
            slot: piece.slot as GarmentSlot,
            productId: productIds[position],
            position,
          })),
        },
      },
    });
  }

  console.info(`Looks: ${SEED_LOOKS.length} curated looks, each with its own pieces`);
}

async function main(): Promise<void> {
  console.info('Seeding Nima sample data');

  const replacing = process.argv.includes('--replace-catalogue');
  if (replacing) await replaceCatalogue();

  // A demo shopper. Sign in as this person with an email code in development.
  await prisma.user.upsert({
    where: { email: 'wanjiru@example.com' },
    create: {
      email: 'wanjiru@example.com',
      name: 'Wanjiru',
      emailVerified: true,
      profile: {
        create: {
          handle: 'wanjiru',
          displayName: 'Wanjiru',
          bio: 'Earth tones, good tailoring, one good jacket.',
        },
      },
      styleProfile: {
        create: {
          aesthetics: ['smart casual', 'heritage', 'minimal'],
          favouriteColours: ['brown', 'cream', 'olive'],
          occasions: ['office', 'weekend', 'celebration'],
          budgetMinCents: KES(1500),
          budgetMaxCents: KES(8000),
          topSize: 'M',
          bottomSize: '30',
          shoeSizeEu: 40,
          completedSteps: ['style', 'colours', 'occasions', 'budget', 'sizes'],
        },
      },
      creditBalance: { create: { balance: 8 } },
    },
    update: {},
  });

  for (const storeSeed of SAMPLE_STORES) {
    const owner = await prisma.user.upsert({
      where: { email: `${storeSeed.slug}@example.com` },
      create: {
        email: `${storeSeed.slug}@example.com`,
        name: storeSeed.name,
        emailVerified: true,
        profile: {
          create: {
            handle: storeSeed.slug.replace(/-/g, ''),
            displayName: storeSeed.name,
            bio: storeSeed.about,
          },
        },
      },
      update: {},
    });

    await prisma.store.upsert({
      where: { slug: storeSeed.slug },
      create: {
        ownerId: owner.id,
        name: storeSeed.name,
        slug: storeSeed.slug,
        about: storeSeed.about,
        county: storeSeed.county,
        verifiedAt: storeSeed.verified ? new Date() : null,
        returnPolicy: 'Returns accepted within 7 days, unworn, with tags on.',
      },
      update: {},
    });
  }

  await seedLooks(replacing || process.argv.includes('--replace-looks'));

  console.info('Done:', {
    users: await prisma.user.count(),
    stores: await prisma.store.count(),
    products: await prisma.product.count(),
    looks: await prisma.look.count(),
  });
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
