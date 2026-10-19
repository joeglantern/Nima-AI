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

    // Saves, likes and dismissals. The new account may already have some of
    // the same looks, and a unique constraint would stop the whole move, so
    // the guest's duplicates go first and the rest move in one statement.
    const [savedAlready, likedAlready, dismissedAlready] = await Promise.all([
      tx.save.findMany({ where: { userId: newUserId }, select: { lookId: true, productId: true } }),
      tx.like.findMany({ where: { userId: newUserId }, select: { lookId: true } }),
      tx.dismissal.findMany({
        where: { userId: newUserId },
        select: { lookId: true, productId: true },
      }),
    ]);

    const lookIds = (rows: Array<{ lookId: string | null }>) =>
      rows.map((row) => row.lookId).filter((id): id is string => id !== null);
    const productIds = (rows: Array<{ productId: string | null }>) =>
      rows.map((row) => row.productId).filter((id): id is string => id !== null);

    await tx.save.deleteMany({
      where: {
        userId: anonymousUserId,
        OR: [
          { lookId: { in: lookIds(savedAlready) } },
          { productId: { in: productIds(savedAlready) } },
        ],
      },
    });
    await tx.like.deleteMany({
      where: { userId: anonymousUserId, lookId: { in: lookIds(likedAlready) } },
    });
    await tx.dismissal.deleteMany({
      where: {
        userId: anonymousUserId,
        OR: [
          { lookId: { in: lookIds(dismissedAlready) } },
          { productId: { in: productIds(dismissedAlready) } },
        ],
      },
    });

    const [savesMoved, likesMoved] = await Promise.all([
      tx.save.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
      tx.like.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
      tx.dismissal.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
    ]);
    const movedSaves = savesMoved.count;
    const movedLikes = likesMoved.count;

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
      tx.pushToken.updateMany({ where: { userId: anonymousUserId }, data: { userId: newUserId } }),
      tx.stylistThread.updateMany({
        where: { userId: anonymousUserId },
        data: { userId: newUserId },
      }),
    ]);

    // Credits. A guest is handed the free weekly credits and the welcome
    // bonus on arrival, and every visit starts as a fresh guest. Carrying
    // those across meant every sign in, on every device, added eight free
    // credits to the account. The account gets its own grants on its own
    // schedule, so the guest's are dropped. Anything else on the guest's
    // ledger, such as a refund, still moves across with its balance.
    await tx.creditLedgerEntry.deleteMany({
      where: { userId: anonymousUserId, reason: { in: ['WEEKLY_GRANT', 'SIGNUP_BONUS'] } },
    });
    const carried = await tx.creditLedgerEntry.aggregate({
      where: { userId: anonymousUserId },
      _sum: { delta: true },
    });
    await tx.creditLedgerEntry.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: newUserId },
    });
    const carriedCredits = carried._sum.delta ?? 0;
    if (carriedCredits !== 0) {
      await tx.creditBalance.upsert({
        where: { userId: newUserId },
        create: { userId: newUserId, balance: Math.max(0, carriedCredits) },
        update: { balance: { increment: carriedCredits } },
      });
    }
    await tx.creditBalance.deleteMany({ where: { userId: anonymousUserId } });

    return {
      movedCartItems,
      movedSaves,
      movedLikes,
      movedLooks: looks.count,
      movedEvents: events.count,
    };
  });
}
