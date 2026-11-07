/**
 * The basket service against a basket in memory: a line can only be taken
 * out by the person it belongs to, and Clear basket empties exactly one
 * person's basket in one call.
 */

import { describe, expect, it } from 'vitest';
import { CartService } from '../src/services/cart.js';

interface Row {
  id: string;
  cartId: string;
  quantity: number;
}

/** Two people, two baskets, enough of Prisma for the service to run. */
function world() {
  const carts = [
    { id: 'cart_amina_00000000000000', userId: 'user_amina_000000000000' },
    { id: 'cart_brian_00000000000000', userId: 'user_brian_000000000000' },
  ];
  let rows: Row[] = [
    { id: 'item_amina_dress_000000000', cartId: carts[0]!.id, quantity: 1 },
    { id: 'item_amina_shoes_000000000', cartId: carts[0]!.id, quantity: 2 },
    { id: 'item_brian_shirt_000000000', cartId: carts[1]!.id, quantity: 1 },
  ];

  const ownerOf = (cartId: string) => carts.find((cart) => cart.id === cartId)?.userId;

  const prisma = {
    cart: {
      findUnique: async ({ where }: { where: { userId: string } }) => {
        const cart = carts.find((entry) => entry.userId === where.userId);
        // The service reads the basket back after every change; an empty
        // list is all these tests need from it.
        return cart ? { ...cart, items: [] } : null;
      },
    },
    cartItem: {
      findFirst: async ({ where }: { where: { id: string; cart: { userId: string } } }) => {
        const row = rows.find((entry) => entry.id === where.id);
        if (!row || ownerOf(row.cartId) !== where.cart.userId) return null;
        return { ...row, variant: { stock: 5 } };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        rows = rows.filter((entry) => entry.id !== where.id);
      },
      deleteMany: async ({ where }: { where: { cartId: string } }) => {
        const before = rows.length;
        rows = rows.filter((entry) => entry.cartId !== where.cartId);
        return { count: before - rows.length };
      },
    },
  };

  const service = new CartService(prisma as never, {} as never);
  return { service, rows: () => rows };
}

describe('CartService', () => {
  it('takes a line out for the person it belongs to', async () => {
    const { service, rows } = world();
    const cart = await service.remove('user_amina_000000000000', 'item_amina_dress_000000000');
    expect(rows().map((row) => row.id)).toEqual([
      'item_amina_shoes_000000000',
      'item_brian_shirt_000000000',
    ]);
    expect(cart.itemCount).toBe(0);
  });

  it('refuses a line that belongs to someone else, and leaves it be', async () => {
    const { service, rows } = world();
    await expect(
      service.remove('user_brian_000000000000', 'item_amina_dress_000000000'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(rows()).toHaveLength(3);
  });

  it('empties one basket in one call and answers with the empty basket', async () => {
    const { service, rows } = world();
    const cart = await service.clear('user_amina_000000000000');
    expect(rows().map((row) => row.id)).toEqual(['item_brian_shirt_000000000']);
    expect(cart).toMatchObject({ groups: [], subtotalCents: 0, itemCount: 0, unavailable: [] });
  });

  it('clearing a basket that was never made is nothing to report', async () => {
    const { service, rows } = world();
    const cart = await service.clear('user_nobody_00000000000');
    expect(rows()).toHaveLength(3);
    expect(cart.itemCount).toBe(0);
  });
});
