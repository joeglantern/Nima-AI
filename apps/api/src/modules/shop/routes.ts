/**
 * Shop: browsing products and stores.
 *
 * Everything here works without an account, which is what the brief means by
 * window shopping. A viewer who is signed in gets `savedByMe` filled in; a
 * guest gets false.
 */

import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Prisma } from '@nima/db';
import {
  idSchema,
  productCardSchema,
  productDetailSchema,
  productListQuerySchema,
  searchSuggestionSchema,
  storeCardSchema,
} from '@nima/contracts';
import { errors } from '../../lib/errors.js';
import { decodeCursor, encodeCursor } from '../../lib/pagination.js';
import { productCard, publicImage, storeCard } from '../../lib/presenters.js';
import { recordEvent } from '../../services/events.js';

const productInclude = {
  store: true,
  images: { orderBy: { position: 'asc' }, take: 1 },
} satisfies Prisma.ProductInclude;

export const shopRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/products',
    {
      schema: {
        tags: ['shop'],
        summary: 'Browse and search products',
        querystring: productListQuerySchema,
        response: {
          200: z.object({
            items: z.array(productCardSchema),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const q = request.query;
      const cursor = decodeCursor(q.cursor);

      const where: Prisma.ProductWhereInput = {
        status: 'ACTIVE',
        ...(q.inStockOnly ? { inStock: true } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.storeId ? { storeId: q.storeId } : {}),
        ...(q.gender ? { gender: q.gender } : {}),
        ...(q.colour ? { colours: { has: q.colour } } : {}),
        ...(q.occasion ? { occasions: { has: q.occasion } } : {}),
        ...(q.minCents !== undefined || q.maxCents !== undefined
          ? {
              priceFromCents: {
                ...(q.minCents !== undefined ? { gte: q.minCents } : {}),
                ...(q.maxCents !== undefined ? { lte: q.maxCents } : {}),
              },
            }
          : {}),
        ...(q.q
          ? {
              OR: [
                { title: { contains: q.q, mode: 'insensitive' } },
                { brand: { contains: q.q, mode: 'insensitive' } },
                { tags: { has: q.q.toLowerCase() } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        q.sort === 'price_asc'
          ? [{ priceFromCents: 'asc' }, { id: 'asc' }]
          : q.sort === 'price_desc'
            ? [{ priceFromCents: 'desc' }, { id: 'asc' }]
            : [{ publishedAt: 'desc' }, { id: 'asc' }];

      const rows = await app.prisma.product.findMany({
        where,
        orderBy,
        take: q.limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
        include: productInclude,
      });

      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;

      // One query for everything this viewer has saved, rather than one per card.
      const savedIds = await savedProductIds(
        app,
        request.user?.id,
        items.map((item) => item.id),
      );

      const last = items.at(-1);

      return {
        items: items.map((product) =>
          productCard(app.storage, product, { savedByMe: savedIds.has(product.id) }),
        ),
        nextCursor:
          hasMore && last
            ? encodeCursor({ key: last.publishedAt?.toISOString() ?? '', id: last.id })
            : null,
      };
    },
  );

  app.get(
    '/products/:id',
    {
      schema: {
        tags: ['shop'],
        summary: 'One product',
        params: z.object({ id: idSchema }),
        response: { 200: productDetailSchema },
      },
    },
    async (request) => {
      const product = await app.prisma.product.findFirst({
        where: { id: request.params.id, status: { not: 'ARCHIVED' } },
        include: {
          store: true,
          images: { orderBy: { position: 'asc' } },
          variants: { where: { isActive: true }, orderBy: [{ size: 'asc' }, { colour: 'asc' }] },
          _count: { select: { lookItems: true } },
        },
      });

      if (!product) throw errors.notFound('That product');

      const [ratings, saved] = await Promise.all([
        app.prisma.review.aggregate({
          where: { productId: product.id, hiddenAt: null },
          _avg: { rating: true },
          _count: true,
        }),
        savedProductIds(app, request.user?.id, [product.id]),
      ]);

      // Viewing is a signal for both the feed and the seller funnel.
      void recordEvent(app, {
        request,
        type: 'VIEW',
        entityType: 'product',
        entityId: product.id,
        storeId: product.storeId,
      });

      const sizeGuide = product.sizeGuide as { note?: string | null; rows?: unknown } | null;

      return {
        ...productCard(app.storage, product, { savedByMe: saved.has(product.id) }),
        description: product.description,
        brand: product.brand,
        material: product.material,
        colours: product.colours,
        tags: product.tags,
        occasions: product.occasions,
        gender: (product.gender ?? null) as never,
        images: product.images
          .map((image) =>
            publicImage(
              app.storage,
              image.processedKey ?? image.originalKey,
              image.width,
              image.height,
            ),
          )
          .filter((image): image is NonNullable<typeof image> => image !== null),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          size: variant.size,
          colour: variant.colour,
          priceCents: variant.priceCents,
          compareAtCents: variant.compareAtCents,
          inStock: variant.stock > 0,
        })),
        sizeGuide: sizeGuide
          ? {
              note: sizeGuide.note ?? null,
              rows: (sizeGuide.rows ?? []) as Array<Record<string, string>>,
            }
          : null,
        returnPolicy: product.store.returnPolicy,
        rating:
          ratings._count > 0
            ? { average: Number((ratings._avg.rating ?? 0).toFixed(2)), count: ratings._count }
            : null,
        styledWithCount: product._count.lookItems,
      };
    },
  );

  app.get(
    '/stores/:slug',
    {
      schema: {
        tags: ['shop'],
        summary: 'A store front',
        params: z.object({ slug: z.string().min(2).max(40) }),
        response: {
          200: z.object({
            store: storeCardSchema.extend({
              about: z.string().nullable(),
              banner: z.object({ url: z.url() }).nullable(),
              returnPolicy: z.string().nullable(),
              productCount: z.number().int(),
              isFollowing: z.boolean().nullable(),
            }),
          }),
        },
      },
    },
    async (request) => {
      const store = await app.prisma.store.findUnique({
        where: { slug: request.params.slug },
        include: {
          _count: { select: { products: { where: { status: 'ACTIVE' } } } },
          followers: request.user ? { where: { followerId: request.user.id }, take: 1 } : false,
        },
      });

      if (!store) throw errors.notFound('That store');

      return {
        store: {
          ...storeCard(app.storage, store),
          about: store.about,
          banner: store.bannerKey ? { url: app.storage.publicUrl(store.bannerKey) } : null,
          returnPolicy: store.returnPolicy,
          productCount: store._count.products,
          isFollowing: request.user ? (store.followers?.length ?? 0) > 0 : null,
        },
      };
    },
  );

  app.get(
    '/search/suggestions',
    {
      schema: {
        tags: ['shop'],
        summary: 'Type ahead suggestions',
        querystring: z.object({ q: z.string().min(1).max(60) }),
        response: { 200: z.object({ items: z.array(searchSuggestionSchema) }) },
      },
    },
    async (request) => {
      const term = request.query.q;

      const [products, stores, profiles] = await Promise.all([
        app.prisma.product.findMany({
          where: { status: 'ACTIVE', title: { contains: term, mode: 'insensitive' } },
          take: 5,
          include: { images: { take: 1, orderBy: { position: 'asc' } } },
        }),
        app.prisma.store.findMany({
          where: { name: { contains: term, mode: 'insensitive' } },
          take: 3,
        }),
        app.prisma.profile.findMany({
          where: { handle: { contains: term, mode: 'insensitive' }, isPrivate: false },
          take: 3,
        }),
      ]);

      return {
        items: [
          ...products.map((product) => ({
            kind: 'product' as const,
            label: product.title,
            value: product.id,
            imageUrl: product.images[0]
              ? app.storage.publicUrl(
                  product.images[0].processedKey ?? product.images[0].originalKey,
                )
              : null,
          })),
          ...stores.map((store) => ({
            kind: 'store' as const,
            label: store.name,
            value: store.slug,
            imageUrl: store.logoKey ? app.storage.publicUrl(store.logoKey) : null,
          })),
          ...profiles.map((profile) => ({
            kind: 'profile' as const,
            label: profile.displayName,
            value: profile.handle,
            imageUrl: profile.avatarKey ? app.storage.publicUrl(profile.avatarKey) : null,
          })),
        ],
      };
    },
  );
};

async function savedProductIds(
  app: Parameters<FastifyPluginAsyncZod>[0],
  userId: string | undefined,
  productIds: string[],
): Promise<Set<string>> {
  if (!userId || productIds.length === 0) return new Set();

  const saves = await app.prisma.save.findMany({
    where: { userId, productId: { in: productIds } },
    select: { productId: true },
  });

  return new Set(saves.map((save) => save.productId).filter((id): id is string => id !== null));
}
