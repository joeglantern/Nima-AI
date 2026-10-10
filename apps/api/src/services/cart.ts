/**
 * The cart.
 *
 * Two rules, both of which the previous codebase broke.
 *
 * **The client never sends a price.** A cart row stores a variant and a
 * quantity, nothing else. Every total on the way out is recomputed from the
 * row in the database at the moment it is read. A price the seller changed
 * yesterday cannot be bought at the old number because it was sitting in
 * someone's cart, and a crafted request cannot buy a sneaker for one shilling.
 *
 * **The cart is grouped by store.** Nima is a marketplace: one basket becomes
 * one order per shop, because each shop packs, ships and is paid separately.
 * Grouping at read time rather than at checkout means the buyer sees the
 * shape of what they are about to do before they commit to it.
 */

import type { Prisma, PrismaClient } from '@nima/db';
import { errors } from '../lib/errors.js';
import { productCard, storeCard } from '../lib/presenters.js';
import type { Storage } from '../lib/storage.js';

const cartInclude = {
  items: {
    orderBy: { addedAt: 'asc' },
    include: {
      variant: true,
      product: {
        include: {
          store: true,
          images: { orderBy: { position: 'asc' }, take: 1 },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type CartItemRow = CartRow['items'][number];

export class CartService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
  ) {}

  /** The cart as the app renders it: grouped, totalled, honest about stock. */
  async read(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: cartInclude,
    });

    return this.present(cart?.items ?? []);
  }

  async add(userId: string, variantId: string, quantity: number) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { id: true, status: true, title: true } } },
    });

    if (!variant?.isActive || variant.product.status !== 'ACTIVE') {
      throw errors.notFound('That item');
    }

    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      select: { id: true, quantity: true },
    });

    // Adding the same size twice means two of them, not a second row.
    const wanted = (existing?.quantity ?? 0) + quantity;

    if (wanted > variant.stock) {
      throw errors.conflict(
        variant.stock === 0
          ? `${variant.product.title} has just sold out`
          : `Only ${variant.stock} left of that size`,
      );
    }

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: wanted },
      });
    } else {
      await this.prisma.cartItem.create({
        data: { cartId: cart.id, productId: variant.productId, variantId, quantity },
      });
    }

    return this.read(userId);
  }

  async setQuantity(userId: string, itemId: string, quantity: number) {
    const item = await this.ownedItem(userId, itemId);

    if (quantity > item.variant.stock) {
      throw errors.conflict(`Only ${item.variant.stock} left of that size`);
    }

    await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    return this.read(userId);
  }

  async remove(userId: string, itemId: string) {
    const item = await this.ownedItem(userId, itemId);
    await this.prisma.cartItem.delete({ where: { id: item.id } });
    return this.read(userId);
  }

  async clear(userId: string): Promise<void> {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    if (cart) await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  async count(userId: string): Promise<number> {
    const rows = await this.prisma.cartItem.aggregate({
      where: { cart: { userId } },
      _sum: { quantity: true },
    });

    return rows._sum.quantity ?? 0;
  }

  /**
   * A row belongs to this person, or it does not exist as far as they are
   * concerned. Looking the item up by id alone and trusting it is how one
   * person ends up editing another person's basket.
   */
  private async ownedItem(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      include: { variant: { select: { stock: true } } },
    });

    if (!item) throw errors.notFound('That item');
    return item;
  }

  private present(items: CartItemRow[]) {
    const available: CartItemRow[] = [];
    const unavailable: CartItemRow[] = [];

    for (const item of items) {
      const sellable =
        item.product.status === 'ACTIVE' && item.variant.isActive && item.variant.stock > 0;

      (sellable ? available : unavailable).push(item);
    }

    // Insertion order of a Map is the order stores were first seen, which is
    // the order the buyer added things. Sorting by name would shuffle the
    // basket every time a shop was renamed.
    const byStore = new Map<string, CartItemRow[]>();

    for (const item of available) {
      const key = item.product.storeId;
      const bucket = byStore.get(key);
      if (bucket) bucket.push(item);
      else byStore.set(key, [item]);
    }

    const groups = [...byStore.values()].flatMap((bucket) => {
      const first = bucket[0];
      if (!first) return [];

      return {
        store: storeCard(this.storage, first.product.store),
        items: bucket.map((item) => this.line(item)),
        subtotalCents: bucket.reduce(
          (total, item) => total + item.variant.priceCents * item.quantity,
          0,
        ),
      };
    });

    return {
      groups,
      subtotalCents: groups.reduce((total, group) => total + group.subtotalCents, 0),
      itemCount: available.reduce((total, item) => total + item.quantity, 0),
      unavailable: unavailable.map((item) => this.line(item)),
    };
  }

  private line(item: CartItemRow) {
    return {
      id: item.id,
      product: productCard(this.storage, item.product),
      variant: {
        id: item.variant.id,
        size: item.variant.size,
        colour: item.variant.colour,
        priceCents: item.variant.priceCents,
        inStock: item.variant.stock > 0 && item.variant.isActive,
        // Only shown once it is low enough to matter. "847 left" is noise,
        // and it tells a competitor exactly how much stock a shop holds.
        stockLeft: item.variant.stock > 0 && item.variant.stock <= 5 ? item.variant.stock : null,
      },
      quantity: item.quantity,
      lineTotalCents: item.variant.priceCents * item.quantity,
    };
  }
}

/** The image an order item keeps a copy of, so a receipt never goes blank. */
export function primaryImageKey(
  images: Array<{ processedKey: string | null; originalKey: string }>,
): string | null {
  const first = images[0];
  return first ? (first.processedKey ?? first.originalKey) : null;
}
