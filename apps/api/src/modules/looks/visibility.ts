/**
 * Who may see a look.
 *
 * One function, used by every read path. Visibility checks scattered through
 * handlers is how private content leaks.
 */

import type { FastifyInstance } from 'fastify';

interface LookLike {
  id: string;
  ownerId: string | null;
  visibility: string;
}

export async function canView(
  app: FastifyInstance,
  look: LookLike,
  viewerId: string | null,
): Promise<boolean> {
  // Your own looks, always.
  if (viewerId && look.ownerId === viewerId) return true;

  // Looks with no owner are curated by Nima.
  if (!look.ownerId) return look.visibility === 'PUBLIC';

  // A block in either direction hides the content both ways.
  if (viewerId) {
    const blocked = await app.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: look.ownerId, blockedId: viewerId },
          { blockerId: viewerId, blockedId: look.ownerId },
        ],
      },
      select: { id: true },
    });
    if (blocked) return false;
  }

  if (look.visibility === 'PUBLIC') {
    // A private account's public looks are still only for followers.
    const owner = await app.prisma.profile.findUnique({
      where: { userId: look.ownerId },
      select: { isPrivate: true },
    });

    if (!owner?.isPrivate) return true;
    if (!viewerId) return false;

    return isFollowing(app, viewerId, look.ownerId);
  }

  if (look.visibility === 'FOLLOWERS') {
    if (!viewerId) return false;
    return isFollowing(app, viewerId, look.ownerId);
  }

  // PRIVATE, and not the owner.
  return false;
}

async function isFollowing(
  app: FastifyInstance,
  followerId: string,
  followedId: string,
): Promise<boolean> {
  const follow = await app.prisma.follow.findUnique({
    where: { followerId_followedId: { followerId, followedId } },
    select: { id: true },
  });

  return follow !== null;
}
