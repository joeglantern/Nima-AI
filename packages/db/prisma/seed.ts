/**
 * Development seed.
 *
 * Enough of a world to work against: two Nairobi stores, a spread of
 * products, a few public looks and a demo shopper. Prices are realistic KES
 * so the interface is designed against numbers of the right shape, not
 * against 9.99.
 *
 * Safe to run repeatedly: everything is keyed by a stable slug or handle.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { type GarmentSlot, PrismaClient, type ProductCategory } from '../generated/client/index.js';
import { createSeedUploader, placeholderImage, placeholderShape } from './seed-media.js';

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

let imageIndex = 0;

const KES = (shillings: number) => shillings * 100;

interface SeedProduct {
  slug: string;
  title: string;
  category: ProductCategory;
  slot: GarmentSlot;
  brand: string;
  description: string;
  colours: string[];
  tags: string[];
  occasions: string[];
  price: number;
  sizes: string[];
}

const SAMPLE_STORES = [
  {
    slug: 'kanzu-collective',
    name: 'Kanzu Collective',
    about: 'Tailored African print and linen, cut and sewn in Nairobi. Made to order in five days.',
    county: 'Nairobi',
    verified: true,
    products: [
      {
        slug: 'ankara-panel-shirt',
        title: 'Ankara panel shirt',
        category: 'TOP' as ProductCategory,
        slot: 'TOP' as GarmentSlot,
        brand: 'Kanzu',
        description:
          'A short sleeve shirt in cotton, with a hand cut ankara panel across the chest and sleeve.',
        colours: ['brown', 'rust', 'cream'],
        tags: ['ankara', 'print', 'smart casual', 'heritage'],
        occasions: ['weekend', 'celebration', 'office'],
        price: 4500,
        sizes: ['S', 'M', 'L', 'XL'],
      },
      {
        slug: 'linen-drawstring-trouser',
        title: 'Linen drawstring trouser',
        category: 'BOTTOM' as ProductCategory,
        slot: 'BOTTOM' as GarmentSlot,
        brand: 'Kanzu',
        description:
          'Light linen with a wide leg and a drawstring waist. Built for hot afternoons.',
        colours: ['sand', 'olive', 'black'],
        tags: ['linen', 'relaxed', 'warm weather'],
        occasions: ['weekend', 'holiday'],
        price: 3800,
        sizes: ['S', 'M', 'L', 'XL'],
      },
      {
        slug: 'kitenge-wrap-dress',
        title: 'Kitenge wrap dress',
        category: 'DRESS' as ProductCategory,
        slot: 'FULL_BODY' as GarmentSlot,
        brand: 'Kanzu',
        description: 'A full length wrap in waxed kitenge, with a tie waist and deep pockets.',
        colours: ['indigo', 'gold'],
        tags: ['kitenge', 'print', 'elegant'],
        occasions: ['celebration', 'wedding', 'date night'],
        price: 7200,
        sizes: ['XS', 'S', 'M', 'L'],
      },
    ] satisfies SeedProduct[],
  },
  {
    slug: 'sote-street',
    name: 'Sote Street',
    about: 'Streetwear out of Eastlands. Heavy cotton, boxy cuts, small runs.',
    county: 'Nairobi',
    verified: false,
    products: [
      {
        slug: 'boxy-logo-tee',
        title: 'Boxy logo tee',
        category: 'TOP' as ProductCategory,
        slot: 'TOP' as GarmentSlot,
        brand: 'Sote',
        description: 'Heavyweight 240gsm cotton, dropped shoulder, screen printed logo.',
        colours: ['black', 'white', 'maroon'],
        tags: ['streetwear', 'oversized', 'cotton'],
        occasions: ['weekend', 'casual'],
        price: 2200,
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
      },
      {
        slug: 'cargo-utility-pant',
        title: 'Cargo utility pant',
        category: 'BOTTOM' as ProductCategory,
        slot: 'BOTTOM' as GarmentSlot,
        brand: 'Sote',
        description: 'Six pocket ripstop cargo with an adjustable hem.',
        colours: ['khaki', 'black'],
        tags: ['streetwear', 'utility', 'cargo'],
        occasions: ['casual', 'weekend'],
        price: 4900,
        sizes: ['28', '30', '32', '34', '36'],
      },
      {
        slug: 'suede-court-sneaker',
        title: 'Suede court sneaker',
        category: 'SHOES' as ProductCategory,
        slot: 'SHOES' as GarmentSlot,
        brand: 'Sote',
        description: 'Low top suede with a gum sole.',
        colours: ['brown', 'off white'],
        tags: ['sneakers', 'everyday'],
        occasions: ['casual', 'weekend'],
        price: 6500,
        sizes: ['39', '40', '41', '42', '43', '44'],
      },
      {
        slug: 'round-frame-sunglasses',
        title: 'Round frame sunglasses',
        category: 'EYEWEAR' as ProductCategory,
        slot: 'EYEWEAR' as GarmentSlot,
        brand: 'Sote',
        description: 'Thin metal frame, rose tinted lens, UV400.',
        colours: ['rose', 'black'],
        tags: ['accessory', 'statement'],
        occasions: ['weekend', 'festival'],
        price: 1800,
        sizes: ['One size'],
      },
    ] satisfies SeedProduct[],
  },
];

async function main(): Promise<void> {
  console.info('Seeding Nima development data');

  // A demo shopper. Sign in as this person with an email code in development.
  const shopper = await prisma.user.upsert({
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
    include: { profile: true },
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

    const store = await prisma.store.upsert({
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

    for (const productSeed of storeSeed.products) {
      const product = await prisma.product.upsert({
        where: { slug: productSeed.slug },
        create: {
          storeId: store.id,
          title: productSeed.title,
          slug: productSeed.slug,
          description: productSeed.description,
          category: productSeed.category,
          brand: productSeed.brand,
          colours: productSeed.colours,
          tags: productSeed.tags,
          occasions: productSeed.occasions,
          status: 'ACTIVE',
          publishedAt: new Date(),
          priceFromCents: KES(productSeed.price),
          inStock: true,
          sizeGuide: {
            note: 'Measurements are in centimetres, taken flat.',
            rows: productSeed.sizes.map((size) => ({ size, chest: '-', length: '-' })),
          },
          variants: {
            create: productSeed.sizes.map((size) => ({
              size,
              colour: productSeed.colours[0] ?? null,
              priceCents: KES(productSeed.price),
              stock: 12,
            })),
          },
        },
        update: {},
      });

      // Give every product a placeholder so the grid can be judged for real.
      const existingImage = await prisma.productImage.findFirst({
        where: { productId: product.id },
      });

      if (!existingImage) {
        const key = `seed/products/${product.slug}.jpg`;
        // The shape is recorded so the shop grid can lay the tile out before
        // the picture has downloaded, which is what keeps the masonry from
        // jumping as the page fills.
        const shape = placeholderShape(imageIndex);
        await upload(key, await placeholderImage(imageIndex, shape));
        imageIndex += 1;

        await prisma.productImage.create({
          data: {
            productId: product.id,
            originalKey: key,
            processedKey: key,
            isPrimary: true,
            position: 0,
            width: shape.width,
            height: shape.height,
          },
        });
      }

      console.info(`  product ${product.slug}`);
    }
  }

  // A couple of public looks so the feed has something in it.
  const kanzu = await prisma.store.findUniqueOrThrow({
    where: { slug: 'kanzu-collective' },
    include: { products: { include: { variants: true } } },
  });
  const sote = await prisma.store.findUniqueOrThrow({
    where: { slug: 'sote-street' },
    include: { products: { include: { variants: true } } },
  });

  const shirt = kanzu.products.find((p) => p.slug === 'ankara-panel-shirt');
  const trouser = kanzu.products.find((p) => p.slug === 'linen-drawstring-trouser');
  const tee = sote.products.find((p) => p.slug === 'boxy-logo-tee');
  const cargo = sote.products.find((p) => p.slug === 'cargo-utility-pant');
  const sneaker = sote.products.find((p) => p.slug === 'suede-court-sneaker');

  const existingLooks = await prisma.look.count({ where: { source: 'CURATED' } });

  if (existingLooks === 0 && shirt && trouser && tee && cargo && sneaker) {
    const saturdayCover = 'seed/looks/saturday-in-town.jpg';
    await upload(saturdayCover, await placeholderImage(1, { width: 1080, height: 1350 }));

    await prisma.look.create({
      data: {
        ownerId: shopper.id,
        coverKey: saturdayCover,
        width: 1080,
        height: 1350,
        title: 'Saturday in town',
        caption: 'Print on top, something quiet underneath.',
        nimaSays: 'The rust in the print picks up the sand linen. Easy, and it photographs well.',
        source: 'CURATED',
        visibility: 'PUBLIC',
        publishedAt: new Date(),
        likeCount: 12,
        saveCount: 4,
        items: {
          create: [
            { slot: 'TOP', productId: shirt.id, position: 0 },
            { slot: 'BOTTOM', productId: trouser.id, position: 1 },
          ],
        },
      },
    });

    const weekendCover = 'seed/looks/weekend-uniform.jpg';
    await upload(weekendCover, await placeholderImage(3, { width: 1080, height: 1350 }));

    await prisma.look.create({
      data: {
        ownerId: shopper.id,
        coverKey: weekendCover,
        width: 1080,
        height: 1350,
        title: 'Weekend uniform',
        caption: 'Boxy tee, cargo, gum sole.',
        nimaSays: 'Keep the tee tucked at the front so the cargo waist still reads.',
        source: 'CURATED',
        visibility: 'PUBLIC',
        publishedAt: new Date(),
        likeCount: 31,
        saveCount: 9,
        items: {
          create: [
            { slot: 'TOP', productId: tee.id, position: 0 },
            { slot: 'BOTTOM', productId: cargo.id, position: 1 },
            { slot: 'SHOES', productId: sneaker.id, position: 2 },
          ],
        },
      },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    stores: await prisma.store.count(),
    products: await prisma.product.count(),
    looks: await prisma.look.count(),
  };

  console.info('Done:', counts);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
