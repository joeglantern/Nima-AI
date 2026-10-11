/**
 * Carrying out account deletions.
 *
 * Asking to leave marks the account and signs the person out. Signing in
 * again within the grace period clears the mark. Once the period has
 * passed, this removes what was theirs.
 *
 * The user row itself stays, scrubbed: orders hang off it and a shop has to
 * be able to account for what it sold. Everything that was about the person
 * rather than the sale goes: profile, photographs, wardrobe, looks, the
 * files behind them, sessions and sign in methods. Events lose their link
 * to the person and stay as counts.
 *
 * It runs on a timer inside the API, once an hour, behind a short lock so
 * two instances never sweep at once. There is no nightly job runner yet, and
 * a timer is honest about that rather than pretending to be one.
 */

import type { FastifyInstance } from 'fastify';

export const DELETION_GRACE_DAYS = 14;
const HOUR = 60 * 60 * 1000;

export function startDeletionSweep(app: FastifyInstance): void {
  const run = () => {
    sweepDeletedAccounts(app).catch((error) => {
      app.log.error({ err: error }, 'The deletion sweep failed');
    });
  };

  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, HOUR);
  first.unref();
  timer.unref();

  app.addHook('onClose', async () => {
    clearTimeout(first);
    clearInterval(timer);
  });
}

/** Erases every account whose grace period is over. Returns how many. */
export async function sweepDeletedAccounts(app: FastifyInstance): Promise<number> {
  const lock = await app.redis.set('nima:deletion-sweep', '1', 'EX', 55 * 60, 'NX');
  if (!lock) return 0;

  const due = await app.prisma.user.findMany({
    where: { deletionRequestedAt: { lt: new Date(Date.now() - DELETION_GRACE_DAYS * 24 * HOUR) } },
    select: { id: true },
    take: 50,
  });

  for (const { id } of due) {
    await eraseAccount(app, id);
    app.log.info({ userId: id }, 'An account was erased after its grace period');
  }

  return due.length;
}

async function eraseAccount(app: FastifyInstance, userId: string): Promise<void> {
  const { prisma, storage } = app;

  // The files, from the rows that know their keys.
  const [photos, wardrobe, jobs, looks, lookbooks, profile] = await Promise.all([
    prisma.userPhoto.findMany({ where: { userId }, select: { storageKey: true } }),
    prisma.wardrobeItem.findMany({
      where: { userId },
      select: { originalKey: true, cutoutKey: true },
    }),
    prisma.tryOnJob.findMany({ where: { userId }, select: { resultKey: true, sourceKey: true } }),
    prisma.look.findMany({ where: { ownerId: userId }, select: { coverKey: true } }),
    prisma.lookbook.findMany({ where: { ownerId: userId }, select: { coverKey: true } }),
    prisma.profile.findUnique({ where: { userId }, select: { avatarKey: true } }),
  ]);

  const keys = [
    ...photos.map((row) => row.storageKey),
    ...wardrobe.flatMap((row) => [row.originalKey, row.cutoutKey]),
    ...jobs.flatMap((row) => [row.resultKey, row.sourceKey]),
    ...looks.map((row) => row.coverKey),
    ...lookbooks.map((row) => row.coverKey),
    profile?.avatarKey,
  ].filter((key): key is string => typeof key === 'string' && key.startsWith(`users/${userId}/`));

  for (const key of new Set(keys)) {
    await storage.remove(key).catch(() => undefined);
  }

  await prisma.$transaction([
    prisma.userPhoto.deleteMany({ where: { userId } }),
    prisma.wardrobeItem.deleteMany({ where: { userId } }),
    prisma.tryOnJob.deleteMany({ where: { userId } }),
    prisma.look.deleteMany({ where: { ownerId: userId } }),
    prisma.lookbook.deleteMany({ where: { ownerId: userId } }),
    prisma.save.deleteMany({ where: { userId } }),
    prisma.like.deleteMany({ where: { userId } }),
    prisma.dismissal.deleteMany({ where: { userId } }),
    prisma.comment.deleteMany({ where: { authorId: userId } }),
    prisma.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followedId: userId }] } }),
    prisma.pushToken.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.event.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.profile.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.account.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@deleted.nima.app`,
        name: 'Deleted account',
        image: null,
        emailVerified: false,
        deletionRequestedAt: null,
        bannedAt: new Date(),
        bannedReason: 'Account deleted at the owner request',
      },
    }),
  ]);
}
