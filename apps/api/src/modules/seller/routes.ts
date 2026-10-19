/**
 * Selling.
 *
 * One account can buy and sell, so a shop is something a person opens from
 * their own profile rather than a separate sign up. Everything here is
 * scoped to the caller's own shop: there is no store id in any path, so
 * there is nothing to guess.
 *
 * Product photos land in the shop's own storage folder and every one goes
 * through the media worker, which squares up the light and the background
 * so a grid of phone photos still looks like a shop.
 */

import {
  orderListQuerySchema,
  productStatusSchema,
  sellerDashboardSchema,
  sellerOrderActionSchema,
  sellerOrderSchema,
  sellerProductDetailSchema,
  sellerProductRowSchema,
  sellerStoreSchema,
  upsertProductSchema,
  upsertStoreSchema,
} from '@nima/contracts';
import type { OrderStatus, Prisma } from '@nima/db';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import {
  order as presentOrder,
  productCard,
  publicImage,
  storeCard,
} from '../../lib/presenters.js';
import { notify } from '../../services/notify.js';

const DAY = 24 * 3600_000;

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** What a seller can do with an order in each state. */
function actionsFor(status: OrderStatus): Array<'accept' | 'mark_ready' | 'cancel'> {
  if (status === 'PAID') return ['accept', 'cancel'];
  if (status === 'PREPARING') return ['mark_ready', 'cancel'];
  return [];
}

const ORDER_WORDS: Partial<Record<OrderStatus, string>> = {
  PREPARING: 'is being packed',
  READY_FOR_PICKUP: 'is ready and on its way to your pick up point',
  CANCELLED: 'was cancelled by the shop',
};

const orderInclude = {
  store: true,
  items: true,
  shipment: true,
  buyer: { select: { profile: { select: { displayName: true, handle: true } }, name: true } },
} satisfies Prisma.OrderInclude;

export const sellerRoutes: FastifyPluginAsyncZod = async (app) => {
  async function myStore(userId: string) {
    const store = await app.prisma.store.findUnique({ where: { ownerId: userId } });
    if (!store) throw errors.notFound('Your shop');
    return store;
  }

  async function uniqueStoreSlug(name: string): Promise<string> {
    const base = slugify(name) || 'shop';
    let candidate = base.length >= 3 ? base : `${base}-shop`;
    for (let i = 0; i < 6; i += 1) {
      const taken = await app.prisma.store.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
      candidate = `${base}-${suffix()}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  async function presentStore(store: Awaited<ReturnType<typeof myStore>>) {
    const since = new Date(Date.now() - 30 * DAY);
    const now = new Date();

    const [active, drafts, openOrders, followers, sales, pending, available] = await Promise.all([
      app.prisma.product.count({ where: { storeId: store.id, status: 'ACTIVE' } }),
      app.prisma.product.count({ where: { storeId: store.id, status: 'DRAFT' } }),
      app.prisma.order.count({
        where: { storeId: store.id, status: { in: ['PAID', 'PREPARING'] } },
      }),
      app.prisma.follow.count({ where: { storeId: store.id } }),
      app.prisma.order.aggregate({
        where: {
          storeId: store.id,
          paidAt: { gte: since },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
        _sum: { subtotalCents: true },
      }),
      app.prisma.sellerLedgerEntry.aggregate({
        where: {
          storeId: store.id,
          kind: { not: 'PAYOUT' },
          OR: [{ availableAt: null }, { availableAt: { gt: now } }],
        },
        _sum: { amountCents: true },
      }),
      app.prisma.sellerLedgerEntry.aggregate({
        where: { storeId: store.id, availableAt: { lte: now } },
        _sum: { amountCents: true },
      }),
    ]);

    return {
      ...storeCard(app.storage, store),
      about: store.about,
      whatsapp: store.whatsapp,
      returnPolicy: store.returnPolicy,
      plan: store.plan,
      stats: {
        activeProducts: active,
        draftProducts: drafts,
        openOrders,
        followers,
        sales30dCents: sales._sum.subtotalCents ?? 0,
        pendingCents: pending._sum.amountCents ?? 0,
        availableCents: Math.max(0, available._sum.amountCents ?? 0),
      },
    };
  }

  // ---------------------------------------------------------------- shop ---

  app.get(
    '/seller/store',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'My shop, with its numbers',
        response: { 200: z.object({ store: sellerStoreSchema.nullable() }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await app.prisma.store.findUnique({ where: { ownerId: user.id } });
      return { store: store ? await presentStore(store) : null };
    },
  );

  app.post(
    '/seller/store',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Open a shop',
        body: upsertStoreSchema,
        response: { 201: z.object({ store: sellerStoreSchema }) },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const existing = await app.prisma.store.findUnique({ where: { ownerId: user.id } });
      if (existing) throw errors.conflict('You already have a shop');

      const body = request.body;
      const slug = body.slug ?? (await uniqueStoreSlug(body.name));
      if (body.slug && (await app.prisma.store.findUnique({ where: { slug } }))) {
        throw errors.conflict('That shop address is taken');
      }

      const store = await app.prisma.store.create({
        data: {
          ownerId: user.id,
          name: body.name.trim(),
          slug,
          about: body.about ?? null,
          county: body.county ?? null,
          whatsapp: body.whatsapp ?? null,
          returnPolicy: body.returnPolicy ?? null,
        },
      });

      return reply.status(201).send({ store: await presentStore(store) });
    },
  );

  app.patch(
    '/seller/store',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Change shop details',
        body: upsertStoreSchema.partial(),
        response: { 200: z.object({ store: sellerStoreSchema }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      const body = request.body;

      // Logos and banners must come from this shop's own uploads.
      for (const key of [body.logoKey, body.bannerKey]) {
        if (key && !key.startsWith(`stores/${store.id}/`)) {
          throw errors.badRequest('That picture was not uploaded for this shop');
        }
      }

      if (body.slug && body.slug !== store.slug) {
        const taken = await app.prisma.store.findUnique({ where: { slug: body.slug } });
        if (taken) throw errors.conflict('That shop address is taken');
      }

      const updated = await app.prisma.store.update({
        where: { id: store.id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.about !== undefined ? { about: body.about } : {}),
          ...(body.county !== undefined ? { county: body.county } : {}),
          ...(body.whatsapp !== undefined ? { whatsapp: body.whatsapp } : {}),
          ...(body.returnPolicy !== undefined ? { returnPolicy: body.returnPolicy } : {}),
          ...(body.logoKey !== undefined ? { logoKey: body.logoKey } : {}),
          ...(body.bannerKey !== undefined ? { bannerKey: body.bannerKey } : {}),
        },
      });

      return { store: await presentStore(updated) };
    },
  );

  // ------------------------------------------------------------ products ---

  app.get(
    '/seller/products',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Everything in my shop, drafts included',
        querystring: z.object({ status: productStatusSchema.optional() }),
        response: { 200: z.object({ items: z.array(sellerProductRowSchema) }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);

      const rows = await app.prisma.product.findMany({
        where: {
          storeId: store.id,
          ...(request.query.status
            ? { status: request.query.status }
            : { status: { not: 'ARCHIVED' } }),
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        include: {
          images: { orderBy: { position: 'asc' }, take: 1 },
          variants: { where: { isActive: true }, select: { stock: true } },
        },
      });

      const views = rows.length
        ? await app.prisma.event.groupBy({
            by: ['entityId'],
            where: {
              type: 'VIEW',
              entityType: 'product',
              entityId: { in: rows.map((r) => r.id) },
              createdAt: { gte: new Date(Date.now() - 30 * DAY) },
            },
            _count: { _all: true },
          })
        : [];
      const viewsById = new Map(views.map((v) => [v.entityId, v._count._all]));

      return {
        items: rows.map((row) => {
          const first = row.images[0];
          return {
            id: row.id,
            title: row.title,
            status: row.status,
            priceFromCents: row.priceFromCents,
            stock: row.variants.reduce((sum, v) => sum + v.stock, 0),
            image: first
              ? publicImage(
                  app.storage,
                  first.processedKey ?? first.originalKey,
                  first.width,
                  first.height,
                )
              : null,
            views30d: viewsById.get(row.id) ?? 0,
            updatedAt: row.updatedAt.toISOString(),
          };
        }),
      };
    },
  );

  async function ownedProduct(storeId: string, id: string) {
    const product = await app.prisma.product.findFirst({
      where: { id, storeId },
      include: {
        variants: { orderBy: { createdAt: 'asc' } },
        images: { orderBy: { position: 'asc' } },
      },
    });
    if (!product) throw errors.notFound('That piece');
    return product;
  }

  function presentDetail(product: Awaited<ReturnType<typeof ownedProduct>>) {
    return {
      id: product.id,
      title: product.title,
      description: product.description,
      category: product.category,
      colours: product.colours,
      occasions: product.occasions,
      status: product.status,
      variants: product.variants.map((v) => ({
        id: v.id,
        size: v.size,
        colour: v.colour,
        priceCents: v.priceCents,
        stock: v.stock,
        isActive: v.isActive,
      })),
      images: product.images.map((img) => ({
        storageKey: img.originalKey,
        image: publicImage(
          app.storage,
          img.processedKey ?? img.originalKey,
          img.width,
          img.height,
        ) ?? {
          url: '',
          width: null,
          height: null,
        },
        processing: img.processing === 'PENDING',
      })),
    };
  }

  app.get(
    '/seller/products/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'One piece, for editing',
        params: z.object({ id: z.string() }),
        response: { 200: sellerProductDetailSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      return presentDetail(await ownedProduct(store.id, request.params.id));
    },
  );

  /** Writes variants and photos, then works out the price and stock the shop shows. */
  async function writeProduct(
    storeId: string,
    body: z.infer<typeof upsertProductSchema>,
    existingId: string | null,
  ): Promise<string> {
    for (const image of body.images) {
      if (!image.storageKey.startsWith(`stores/${storeId}/`)) {
        throw errors.badRequest('A photo was not uploaded for this shop');
      }
    }

    const sizes = new Set<string>();
    for (const v of body.variants) {
      const key = `${v.size ?? ''}|${v.colour ?? ''}`;
      if (sizes.has(key)) throw errors.badRequest('Each size can only be listed once');
      sizes.add(key);
    }

    if (body.status === 'ACTIVE' && body.images.length === 0) {
      throw errors.badRequest('Add at least one photo before putting this in the shop');
    }

    const active = body.variants.filter((v) => v.isActive);
    const priceFromCents = active.length ? Math.min(...active.map((v) => v.priceCents)) : 0;
    const inStock = active.some((v) => v.stock > 0);
    const status = body.status === 'ACTIVE' && !inStock ? 'OUT_OF_STOCK' : body.status;

    const fields = {
      title: body.title.trim(),
      description: body.description ?? null,
      category: body.category,
      subcategory: body.subcategory ?? null,
      brand: body.brand ?? null,
      material: body.material ?? null,
      colours: body.colours,
      tags: body.tags,
      occasions: body.occasions,
      gender: body.gender ?? null,
      sizeGuide: (body.sizeGuide ?? undefined) as never,
      status,
      priceFromCents,
      inStock,
    };

    const queued: Array<{ id: string; key: string }> = [];

    const id = await app.prisma.$transaction(async (tx) => {
      let productId = existingId;

      if (productId) {
        const before = await tx.product.findUniqueOrThrow({ where: { id: productId } });
        await tx.product.update({
          where: { id: productId },
          data: {
            ...fields,
            publishedAt: status === 'ACTIVE' && !before.publishedAt ? new Date() : undefined,
          },
        });
      } else {
        const created = await tx.product.create({
          data: {
            ...fields,
            storeId,
            slug: `${slugify(body.title) || 'piece'}-${suffix()}${suffix()}`,
            publishedAt: status === 'ACTIVE' ? new Date() : null,
          },
        });
        productId = created.id;
      }

      // Variants: keep the ones sent, retire the rest. A variant someone
      // has bought cannot be deleted, so retiring is switching it off.
      const current = await tx.productVariant.findMany({ where: { productId } });
      const keep = new Set<string>();
      for (const v of body.variants) {
        const match =
          (v.id && current.find((c) => c.id === v.id)) ||
          current.find(
            (c) =>
              (c.size ?? null) === (v.size ?? null) && (c.colour ?? null) === (v.colour ?? null),
          );
        const data = {
          size: v.size ?? null,
          colour: v.colour ?? null,
          sku: v.sku ?? null,
          priceCents: v.priceCents,
          compareAtCents: v.compareAtCents ?? null,
          stock: v.stock,
          isActive: v.isActive,
        };
        if (match) {
          await tx.productVariant.update({ where: { id: match.id }, data });
          keep.add(match.id);
        } else {
          const created = await tx.productVariant.create({ data: { ...data, productId } });
          keep.add(created.id);
        }
      }
      const retired = current.filter((c) => !keep.has(c.id)).map((c) => c.id);
      if (retired.length) {
        await tx.productVariant.updateMany({
          where: { id: { in: retired } },
          data: { isActive: false },
        });
      }

      // Photos: in the order sent, the first is the cover.
      const photos = await tx.productImage.findMany({ where: { productId } });
      const sentKeys = new Set(body.images.map((i) => i.storageKey));
      const gone = photos.filter((p) => !sentKeys.has(p.originalKey)).map((p) => p.id);
      if (gone.length) await tx.productImage.deleteMany({ where: { id: { in: gone } } });

      for (const [position, image] of body.images.entries()) {
        const existing = photos.find((p) => p.originalKey === image.storageKey);
        if (existing) {
          await tx.productImage.update({
            where: { id: existing.id },
            data: { position, isPrimary: position === 0 },
          });
        } else {
          const created = await tx.productImage.create({
            data: {
              productId,
              originalKey: image.storageKey,
              position,
              isPrimary: position === 0,
              processing: 'PENDING',
            },
          });
          queued.push({ id: created.id, key: image.storageKey });
        }
      }

      return productId;
    });

    for (const photo of queued) {
      try {
        await app.queues.media.add('product-photo', {
          kind: 'REMOVE_BACKGROUND',
          storageKey: photo.key,
          target: { type: 'productImage', id: photo.id },
          userId: null,
        });
      } catch (error) {
        // The original still shows. The worker catching up later is fine.
        app.log.warn({ err: error }, 'Could not queue a product photo');
      }
    }

    return id;
  }

  app.post(
    '/seller/products',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Add a piece',
        body: upsertProductSchema,
        response: { 201: sellerProductDetailSchema },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      const id = await writeProduct(store.id, request.body, null);
      return reply.status(201).send(presentDetail(await ownedProduct(store.id, id)));
    },
  );

  app.put(
    '/seller/products/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Save changes to a piece',
        params: z.object({ id: z.string() }),
        body: upsertProductSchema,
        response: { 200: sellerProductDetailSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      await ownedProduct(store.id, request.params.id);
      const id = await writeProduct(store.id, request.body, request.params.id);
      return presentDetail(await ownedProduct(store.id, id));
    },
  );

  app.post(
    '/seller/products/:id/status',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Publish, hide or archive a piece',
        params: z.object({ id: z.string() }),
        body: z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']) }),
        response: { 200: z.object({ status: productStatusSchema }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      const product = await ownedProduct(store.id, request.params.id);

      let status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'OUT_OF_STOCK' = request.body.status;
      if (status === 'ACTIVE') {
        if (product.images.length === 0) {
          throw errors.badRequest('Add at least one photo before putting this in the shop');
        }
        if (!product.variants.some((v) => v.isActive && v.stock > 0)) status = 'OUT_OF_STOCK';
      }

      await app.prisma.product.update({
        where: { id: product.id },
        data: {
          status,
          publishedAt: status === 'ACTIVE' && !product.publishedAt ? new Date() : undefined,
        },
      });

      return { status };
    },
  );

  // -------------------------------------------------------------- orders ---

  function presentSellerOrder(row: Prisma.OrderGetPayload<{ include: typeof orderInclude }>) {
    return {
      ...presentOrder(app.storage, row),
      buyer: {
        displayName: row.buyer.profile?.displayName ?? row.buyer.name ?? 'A buyer',
        handle: row.buyer.profile?.handle ?? null,
      },
      actions: actionsFor(row.status),
    };
  }

  app.get(
    '/seller/orders',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Orders for my shop',
        description: 'Unpaid orders are left out: there is nothing to pack until the money is in.',
        querystring: orderListQuerySchema,
        response: {
          200: z.object({ items: z.array(sellerOrderSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      const { limit, cursor, status } = request.query;

      const rows = await app.prisma.order.findMany({
        where: {
          storeId: store.id,
          ...(status ? { status } : { status: { not: 'PENDING_PAYMENT' } }),
        },
        orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: orderInclude,
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: page.map(presentSellerOrder),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    '/seller/orders/:id/action',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'Accept, mark ready or cancel an order',
        params: z.object({ id: z.string() }),
        body: sellerOrderActionSchema,
        response: { 200: sellerOrderSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      const { action, reason } = request.body;

      const current = await app.prisma.order.findFirst({
        where: { id: request.params.id, storeId: store.id },
        include: { items: true },
      });
      if (!current) throw errors.notFound('That order');
      if (!actionsFor(current.status).includes(action)) {
        throw errors.conflict('That order has already moved on');
      }

      const now = new Date();
      let next: OrderStatus;

      if (action === 'accept') {
        next = 'PREPARING';
        await app.prisma.order.update({ where: { id: current.id }, data: { status: next } });
      } else if (action === 'mark_ready') {
        next = 'READY_FOR_PICKUP';
        await app.prisma.$transaction([
          app.prisma.order.update({
            where: { id: current.id },
            data: { status: next, readyAt: now },
          }),
          app.prisma.shipment.updateMany({
            where: { orderId: current.id },
            data: { status: 'BOOKED' },
          }),
        ]);
      } else {
        next = 'CANCELLED';
        // Stock goes back, the sale comes off the shop's ledger, and a
        // refund is opened for the buyer. The refund itself is sent by the
        // payments side, which owns the money.
        await app.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: current.id },
            data: {
              status: next,
              cancelledAt: now,
              cancelReason: reason?.trim() || 'Cancelled by the shop',
            },
          });
          for (const item of current.items) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          }
          await tx.sellerLedgerEntry.createMany({
            data: [
              {
                storeId: store.id,
                orderId: current.id,
                kind: 'REFUND',
                amountCents: -current.subtotalCents,
                note: `Cancelled ${current.reference}`,
              },
              {
                storeId: store.id,
                orderId: current.id,
                kind: 'ADJUSTMENT',
                amountCents: current.platformFeeCents,
                note: `Fee returned on ${current.reference}`,
              },
            ],
          });
          await tx.refund.create({
            data: {
              orderId: current.id,
              amountCents: current.totalCents,
              reason: reason?.trim() || 'Cancelled by the shop',
            },
          });
        });
      }

      await app.realtime.toUser(current.buyerId, {
        type: 'order.updated',
        orderId: current.id,
        status: next,
      });
      const words = ORDER_WORDS[next];
      if (words) {
        await notify(app, {
          userId: current.buyerId,
          type: 'ORDER_UPDATE',
          title: 'Your order',
          body: `Your order ${current.reference} from ${store.name} ${words}`,
          data: { orderId: current.id },
        });
      }

      const row = await app.prisma.order.findUniqueOrThrow({
        where: { id: current.id },
        include: orderInclude,
      });
      return presentSellerOrder(row);
    },
  );

  // ----------------------------------------------------------- dashboard ---

  app.get(
    '/seller/dashboard',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['seller'],
        summary: 'How the shop is doing',
        querystring: z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') }),
        response: { 200: sellerDashboardSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await myStore(user.id);
      return dashboard(app, store.id, request.query.range);
    },
  );
};

async function dashboard(app: FastifyInstance, storeId: string, range: '7d' | '30d' | '90d') {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const since = new Date(Date.now() - days * DAY);
  since.setHours(0, 0, 0, 0);
  const now = new Date();

  const [events, orders, followers, ledger, payouts] = await Promise.all([
    app.prisma.event.findMany({
      where: {
        storeId,
        createdAt: { gte: since },
        type: { in: ['VIEW', 'TRY_ON', 'ADD_TO_CART'] },
      },
      select: { type: true, entityId: true, entityType: true, createdAt: true },
      take: 50_000,
    }),
    app.prisma.order.findMany({
      where: { storeId, paidAt: { gte: since }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      select: {
        paidAt: true,
        subtotalCents: true,
        items: { select: { productId: true, quantity: true } },
      },
    }),
    app.prisma.follow.count({ where: { storeId } }),
    app.prisma.sellerLedgerEntry.findMany({
      where: { storeId },
      select: { amountCents: true, availableAt: true, kind: true },
    }),
    app.prisma.payout.aggregate({ where: { storeId }, _sum: { amountCents: true } }),
  ]);

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const daily = new Map<
    string,
    { views: number; tryOns: number; purchases: number; revenueCents: number }
  >();
  for (let i = days - 1; i >= 0; i -= 1) {
    daily.set(dayKey(new Date(now.getTime() - i * DAY)), {
      views: 0,
      tryOns: 0,
      purchases: 0,
      revenueCents: 0,
    });
  }

  const perProduct = new Map<string, { views: number; tryOns: number; purchases: number }>();
  const bump = (id: string, field: 'views' | 'tryOns' | 'purchases', by = 1) => {
    const row = perProduct.get(id) ?? { views: 0, tryOns: 0, purchases: 0 };
    row[field] += by;
    perProduct.set(id, row);
  };

  let views = 0;
  let tryOns = 0;
  let carts = 0;
  for (const e of events) {
    const day = daily.get(dayKey(e.createdAt));
    if (e.type === 'VIEW') {
      views += 1;
      if (day) day.views += 1;
      if (e.entityType === 'product') bump(e.entityId, 'views');
    } else if (e.type === 'TRY_ON') {
      tryOns += 1;
      if (day) day.tryOns += 1;
      if (e.entityType === 'product') bump(e.entityId, 'tryOns');
    } else {
      carts += 1;
    }
  }

  let revenue = 0;
  for (const o of orders) {
    revenue += o.subtotalCents;
    const day = o.paidAt ? daily.get(dayKey(o.paidAt)) : undefined;
    if (day) {
      day.purchases += 1;
      day.revenueCents += o.subtotalCents;
    }
    for (const item of o.items) bump(item.productId, 'purchases', item.quantity);
  }

  const topIds = [...perProduct.entries()]
    .sort((a, b) => b[1].purchases - a[1].purchases || b[1].views - a[1].views)
    .slice(0, 5)
    .map(([id]) => id);

  const products = topIds.length
    ? await app.prisma.product.findMany({
        where: { id: { in: topIds } },
        include: { store: true, images: { orderBy: { position: 'asc' }, take: 1 } },
      })
    : [];

  let pending = 0;
  let available = 0;
  for (const entry of ledger) {
    if (entry.kind === 'PAYOUT') continue;
    if (entry.availableAt && entry.availableAt <= now) available += entry.amountCents;
    else pending += entry.amountCents;
  }
  const paidOut = payouts._sum.amountCents ?? 0;

  return {
    range,
    totals: {
      views,
      tryOns,
      addToCarts: carts,
      purchases: orders.length,
      revenueCents: revenue,
      followers,
    },
    funnel: [
      { step: 'Viewed', count: views },
      { step: 'Tried on', count: tryOns },
      { step: 'Added to basket', count: carts },
      { step: 'Bought', count: orders.length },
    ],
    daily: [...daily.entries()].map(([day, row]) => ({ day, ...row })),
    topProducts: topIds
      .map((id) => {
        const product = products.find((p) => p.id === id);
        const stats = perProduct.get(id);
        if (!product || !stats) return null;
        return {
          product: productCard(app.storage, product),
          ...stats,
          conversion: stats.views ? stats.purchases / stats.views : 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
    balance: {
      pendingCents: pending,
      availableCents: Math.max(0, available - paidOut),
      paidOutCents: paidOut,
    },
  };
}
