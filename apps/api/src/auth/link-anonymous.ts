/**
 * Moving a guest's history onto their new account.
 *
 * This runs inside Better Auth's `onLinkAccount` hook the moment someone
 * signs up after browsing as a guest. Everything they did while anonymous has
 * to survive, otherwise the progressive sign up the brief asks for feels like
 * a punishment.
 *
 * What moves: cart, saves, likes, dismissals, looks, wardrobe, lookbooks,
 * try-on jobs, credit history, behaviour events, push tokens.
 * What does not: sessions and accounts, which belong to Better Auth.
 *
 * The whole move is one transaction. A half migrated account would be worse
 * than none.
 */

import type { PrismaClient } from '@nima/db';

export interface LinkResult {
  movedCartItems: number;
  movedSaves: number;
  movedLikes: number;
  movedLooks: number;
  movedEvents: number;
}

export async function linkAnonymousAccount(
  prisma: PrismaClient,
  anonymousUserId: string,
  newUserId: string,
): Promise<LinkResult> {
  return prisma.$transaction(async (tx) => {
    // Cart: the guest cart wins if the new account does not have one, and
    // merges item by item if it does.
    const guestCart = await tx.cart.findUnique({
      where: { userId: anonymousUserId },
      include: { items: true },
    });

    let movedCartItems = 0;

    if (guestCart && guestCart.items.length > 0) {
      const targetCart = await tx.cart.upsert({
        where: { userId: newUserId },
        create: { userId: newUserId },
        update: {},
      });

      for (const item of guestCart.items) {
        const existing = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId: targetCart.id, variantId: item.variantId } },
        });

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: Math.min(existing.quantity + item.quantity, 99) },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: targetCart.id,
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
            },
          });
        }
        movedCartItems += 1;
      }

      await tx.cart.delete({ where: { id: guestCart.id } });
    }

    // Saves, likes and dismissals. A unique constraint means the same look
    // could already be saved on the new account, so skip duplicates.
    const [saves, likes, dismissals] = await Promise.all([
      tx.save.findMany({ where: { userId: anonymousUserId } }),
      tx.like.findMany({ where: { userId: anonymousUserId } }),
      tx.dismissal.findMany({ where: { userId: anonymousUserId } }),
    ]);

    let movedSaves = 0;
    for (const save of saves) {
      const moved = await tx.save
        .updateMany({
          where: { id: save.id },
          data: { userId: newUserId },
        })
        .catch(() => ({ count: 0 }));
      movedSaves += moved.count;
    }

    let movedLikes = 0;
    for (const like of likes) {
      const moved = await tx.like
        .updateMany({ where: { id: like.id }, data: { userId: newUserId } })
        .catch(() => ({ count: 0 }));
      movedLikes += moved.count;
    }

    for (const dismissal of dismissals) {
      await tx.dismissal
        .updateMany({ where: { id: dismissal.id }, data: { userId: newUserId } })
        .catch(() => ({ count: 0 }));
    }

    // Content the guest created.
    const [looks, events] = await Promise.all([
      tx.look.updateMany({ where: { ownerId: anonymousUserId }, data: { ownerId: newUserId } }),
      tx.event.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
    ]);

    await Promise.all([
      tx.wardrobeItem.updateMany({
        where: { userId: anonymousUserId },
        data: { userId: newUserId },
      }),
      tx.lookbook.updateMany({ where: { ownerId: anonymousUserId }, data: { ownerId: newUserId } }),
      tx.tryOnJob.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
      tx.userPhoto.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
      tx.creditLedgerEntry.updateMany({
        where: { userId: anonymousUserId },
        data: { userId: newUserId },
      }),
      tx.pushToken.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
      tx.stylistThread.updateMany({
        where: { userId: anonymousUserId },
        data: { userId: newUserId },
      }),
    ]);

    // Fold any credit balance the guest accumulated into the new account.
    const guestBalance = await tx.creditBalance.findUnique({ where: { userId: anonymousUserId } });
    if (guestBalance && guestBalance.balance > 0) {
      await tx.creditBalance.upsert({
        where: { userId: newUserId },
        create: { userId: newUserId, balance: guestBalance.balance },
        update: { balance: { increment: guestBalance.balance } },
      });
    }
    if (guestBalance) {
      await tx.creditBalance.delete({ where: { userId: anonymousUserId } });
    }

    return {
      movedCartItems,
      movedSaves,
      movedLikes,
      movedLooks: looks.count,
      movedEvents: events.count,
    };
  });
}
