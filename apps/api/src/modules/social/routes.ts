/**
 * Following, activity and messages.
 *
 * Following is one tap and needs no approval. Counts stay private: a person
 * can see their own numbers, nobody else can, which is the line the brief
 * draws.
 *
 * Activity is the notifications table read back with the faces and the
 * looks attached, so a row can say who and show what without a second
 * request per row.
 *
 * Messages are one to one for now. Sharing a look to three friends opens or
 * reuses three conversations and drops the look card into each, which is
 * what the send sheet in the design does.
 */

import {
  conversationListQuerySchema,
  conversationPeerSchema,
  conversationSchema,
  followStateSchema,
  followSummarySchema,
  handleSchema,
  idSchema,
  messageListQuerySchema,
  messageSchema,
  notificationSchema,
  paginationQuerySchema,
  sendMessageSchema,
  shareToPeopleSchema,
  startConversationSchema,
} from '@nima/contracts';
import type { MessageKind, PrismaClient } from '@nima/db';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../lib/errors.js';
import { publicImage } from '../../lib/presenters.js';
import { notify } from '../../services/notify.js';
import { canView } from '../looks/visibility.js';

const peerSelect = {
  id: true,
  profile: { select: { handle: true, displayName: true, avatarKey: true } },
} as const;

interface PeerRow {
  id: string;
  profile: { handle: string; displayName: string; avatarKey: string | null } | null;
}

function peer(app: FastifyInstance, user: PeerRow) {
  return {
    id: user.id,
    handle: user.profile?.handle ?? 'someone',
    displayName: user.profile?.displayName ?? 'Someone',
    avatar: publicImage(app.storage, user.profile?.avatarKey),
  };
}

/** True when either person has blocked the other. */
async function blockedBetween(prisma: PrismaClient, a: string, b: string): Promise<boolean> {
  const row = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/** A short line for the inbox, whatever the message is. */
function previewOf(kind: MessageKind, body: string | null, snapshot: unknown): string {
  if (kind === 'TEXT') return body ?? '';
  const title = (snapshot as { title?: string | null } | null)?.title;
  if (kind === 'LOOK') return title ? `Shared a look: ${title}` : 'Shared a look';
  if (kind === 'PRODUCT') return title ? `Shared ${title}` : 'Shared a piece';
  return body ?? 'Shared something';
}

interface Snapshot {
  title: string | null;
  subtitle: string | null;
  imageKey: string | null;
  width: number | null;
  height: number | null;
}

export const socialRoutes: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------ following ---

  async function personByHandle(handle: string) {
    const profile = await app.prisma.profile.findUnique({
      where: { handle },
      select: { userId: true, displayName: true },
    });
    if (!profile) throw errors.notFound('That profile');
    return profile;
  }

  app.post(
    '/profiles/:handle/follow',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Follow someone',
        params: z.object({ handle: handleSchema }),
        response: { 200: followStateSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const person = await personByHandle(request.params.handle);

      if (person.userId === user.id) throw errors.badRequest('You cannot follow yourself');
      if (await blockedBetween(app.prisma, user.id, person.userId)) {
        throw errors.notFound('That profile');
      }

      const existing = await app.prisma.follow.findUnique({
        where: { followerId_followedId: { followerId: user.id, followedId: person.userId } },
      });
      if (existing) return { following: true };

      await app.prisma.follow.create({ data: { followerId: user.id, followedId: person.userId } });

      // Following, unfollowing and following again in a minute should not
      // tell them three times.
      const recent = await app.prisma.notification.findFirst({
        where: {
          userId: person.userId,
          type: 'NEW_FOLLOWER',
          createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
          data: { path: ['actorId'], equals: user.id },
        },
        select: { id: true },
      });

      if (!recent) {
        const me = await app.prisma.profile.findUnique({
          where: { userId: user.id },
          select: { displayName: true },
        });
        await notify(app, {
          userId: person.userId,
          type: 'NEW_FOLLOWER',
          title: 'New follower',
          body: `${me?.displayName ?? 'Someone'} started following you`,
          data: { actorId: user.id },
        });
      }

      return { following: true };
    },
  );

  app.delete(
    '/profiles/:handle/follow',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Stop following someone',
        params: z.object({ handle: handleSchema }),
        response: { 200: followStateSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const person = await personByHandle(request.params.handle);

      await app.prisma.follow.deleteMany({
        where: { followerId: user.id, followedId: person.userId },
      });

      return { following: false };
    },
  );

  app.post(
    '/stores/:slug/follow',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Follow a shop',
        params: z.object({ slug: z.string().min(1).max(80) }),
        response: { 200: followStateSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await app.prisma.store.findUnique({ where: { slug: request.params.slug } });
      if (!store) throw errors.notFound('That shop');
      if (store.ownerId === user.id) throw errors.badRequest('This is your own shop');

      await app.prisma.follow.upsert({
        where: { followerId_storeId: { followerId: user.id, storeId: store.id } },
        create: { followerId: user.id, storeId: store.id },
        update: {},
      });

      return { following: true };
    },
  );

  app.delete(
    '/stores/:slug/follow',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Stop following a shop',
        params: z.object({ slug: z.string().min(1).max(80) }),
        response: { 200: followStateSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const store = await app.prisma.store.findUnique({ where: { slug: request.params.slug } });
      if (!store) throw errors.notFound('That shop');

      await app.prisma.follow.deleteMany({ where: { followerId: user.id, storeId: store.id } });
      return { following: false };
    },
  );

  app.get(
    '/me/follows',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'My own follower and following counts',
        description: 'Only for the person themselves. There is no public version of this.',
        response: { 200: followSummarySchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const [followers, following] = await Promise.all([
        app.prisma.follow.count({ where: { followedId: user.id } }),
        app.prisma.follow.count({ where: { followerId: user.id, followedId: { not: null } } }),
      ]);
      return { followers, following };
    },
  );

  app.get(
    '/me/people',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'People to send things to',
        description:
          'Whoever you talked to most recently first, then the people you follow. ' +
          'With q, a search across everyone by name or handle.',
        querystring: z.object({ q: z.string().max(60).optional() }),
        response: {
          200: z.object({
            items: z.array(conversationPeerSchema),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const q = request.query.q?.trim().replace(/^@/, '');

      const blocked = await app.prisma.block.findMany({
        where: { OR: [{ blockerId: user.id }, { blockedId: user.id }] },
        select: { blockerId: true, blockedId: true },
      });
      const hidden = new Set([
        user.id,
        ...blocked.map((b) => (b.blockerId === user.id ? b.blockedId : b.blockerId)),
      ]);

      const seen = new Set<string>();
      const people: PeerRow[] = [];
      const add = (row: PeerRow) => {
        if (hidden.has(row.id) || seen.has(row.id) || !row.profile) return;
        seen.add(row.id);
        people.push(row);
      };

      if (q) {
        const rows = await app.prisma.user.findMany({
          where: {
            isAnonymous: false,
            profile: {
              OR: [
                { handle: { contains: q, mode: 'insensitive' } },
                { displayName: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
          select: peerSelect,
          take: 20,
        });
        rows.forEach(add);
      } else {
        const recent = await app.prisma.conversationMember.findMany({
          where: { userId: user.id, leftAt: null, conversation: { isGroup: false } },
          orderBy: { conversation: { lastMessageAt: { sort: 'desc', nulls: 'last' } } },
          take: 12,
          select: {
            conversation: {
              select: {
                members: {
                  where: { userId: { not: user.id } },
                  select: { user: { select: peerSelect } },
                },
              },
            },
          },
        });
        for (const row of recent) {
          for (const m of row.conversation.members) add(m.user);
        }

        const follows = await app.prisma.follow.findMany({
          where: { followerId: user.id, followedId: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { followed: { select: peerSelect } },
        });
        for (const row of follows) if (row.followed) add(row.followed);
      }

      return { items: people.map((row) => peer(app, row)) };
    },
  );

  // ------------------------------------------------------------- activity ---

  app.get(
    '/notifications',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Activity: loves, comments, followers',
        querystring: paginationQuerySchema,
        response: {
          200: z.object({
            items: z.array(notificationSchema),
            nextCursor: z.string().nullable(),
            unread: z.number().int(),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { limit, cursor } = request.query;

      const [rows, unread] = await Promise.all([
        app.prisma.notification.findMany({
          // Messages have their own inbox and their own badge.
          where: { userId: user.id, type: { not: 'MESSAGE' } },
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
        app.prisma.notification.count({
          where: { userId: user.id, readAt: null, type: { not: 'MESSAGE' } },
        }),
      ]);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const dataOf = (row: (typeof page)[number]) =>
        (row.data ?? {}) as {
          actorId?: string;
          lookId?: string;
          jobId?: string;
          orderId?: string;
          seller?: boolean;
        };

      const actorIds = [...new Set(page.map((r) => dataOf(r).actorId).filter(Boolean))] as string[];
      const lookIds = [...new Set(page.map((r) => dataOf(r).lookId).filter(Boolean))] as string[];

      const [actors, looks, followsBack] = await Promise.all([
        actorIds.length
          ? app.prisma.user.findMany({ where: { id: { in: actorIds } }, select: peerSelect })
          : [],
        lookIds.length
          ? app.prisma.look.findMany({
              where: { id: { in: lookIds } },
              select: { id: true, coverKey: true, width: true, height: true },
            })
          : [],
        actorIds.length
          ? app.prisma.follow.findMany({
              where: { followerId: user.id, followedId: { in: actorIds } },
              select: { followedId: true },
            })
          : [],
      ]);

      const actorById = new Map(actors.map((a) => [a.id, a]));
      const lookById = new Map(looks.map((l) => [l.id, l]));
      const following = new Set(followsBack.map((f) => f.followedId));

      return {
        items: page.map((row) => {
          const data = dataOf(row);
          const actor = data.actorId ? actorById.get(data.actorId) : undefined;
          const look = data.lookId ? lookById.get(data.lookId) : undefined;

          let target: string | null = null;
          if (data.lookId) target = `look/${data.lookId}`;
          else if (row.type === 'NEW_FOLLOWER' && actor?.profile)
            target = `u/${actor.profile.handle}`;
          else if (data.orderId && data.seller) target = 'sell/orders';
          else if (data.orderId) target = `order/${data.orderId}`;

          return {
            id: row.id,
            type: row.type,
            title: row.title,
            body: row.body,
            target,
            read: row.readAt !== null,
            createdAt: row.createdAt.toISOString(),
            actor: actor ? peer(app, actor) : null,
            image: look ? publicImage(app.storage, look.coverKey, look.width, look.height) : null,
            followingBack:
              row.type === 'NEW_FOLLOWER' && data.actorId ? following.has(data.actorId) : null,
          };
        }),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
        unread,
      };
    },
  );

  app.get(
    '/notifications/unread',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'What the bell and the inbox should show',
        response: { 200: z.object({ activity: z.number().int(), messages: z.number().int() }) },
      },
    },
    async (request) => {
      const user = request.requireUser();

      const [activity, memberships] = await Promise.all([
        app.prisma.notification.count({
          where: { userId: user.id, readAt: null, type: { not: 'MESSAGE' } },
        }),
        app.prisma.conversationMember.findMany({
          where: { userId: user.id, leftAt: null },
          select: { conversationId: true, lastReadAt: true },
        }),
      ]);

      // Conversations with something newer than when I last looked, from
      // someone else. Counted as conversations, not messages, like the
      // apps people already use.
      let messages = 0;
      if (memberships.length) {
        const unreadThreads = await Promise.all(
          memberships.map((m) =>
            app.prisma.message.findFirst({
              where: {
                conversationId: m.conversationId,
                senderId: { not: user.id },
                deletedAt: null,
                ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
              },
              select: { id: true },
            }),
          ),
        );
        messages = unreadThreads.filter(Boolean).length;
      }

      return { activity, messages };
    },
  );

  app.post(
    '/notifications/read',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Mark all activity as seen',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      await app.prisma.notification.updateMany({
        where: { userId: user.id, readAt: null, type: { not: 'MESSAGE' } },
        data: { readAt: new Date() },
      });
      return reply.status(204).send(null);
    },
  );

  // ------------------------------------------------------------- messages ---

  /** Finds the one to one conversation between two people, or starts it. */
  async function directConversation(me: string, other: string): Promise<string> {
    const existing = await app.prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [{ members: { some: { userId: me } } }, { members: { some: { userId: other } } }],
      },
      select: { id: true },
    });
    if (existing) {
      // Coming back to a conversation you left puts you back in it.
      await app.prisma.conversationMember.updateMany({
        where: { conversationId: existing.id, userId: me, leftAt: { not: null } },
        data: { leftAt: null },
      });
      return existing.id;
    }

    const created = await app.prisma.conversation.create({
      data: { isGroup: false, members: { create: [{ userId: me }, { userId: other }] } },
      select: { id: true },
    });
    return created.id;
  }

  async function membership(conversationId: string, userId: string) {
    const member = await app.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) throw errors.notFound('That conversation');
    return member;
  }

  /** What a shared look or piece looks like in the thread, frozen in time. */
  async function snapshotOf(
    kind: 'LOOK' | 'PRODUCT',
    refId: string,
    senderId: string,
  ): Promise<Snapshot> {
    if (kind === 'LOOK') {
      const look = await app.prisma.look.findUnique({
        where: { id: refId },
        include: { owner: { select: { profile: { select: { displayName: true } } } } },
      });
      if (!look || !(await canView(app, look, senderId))) throw errors.notFound('That look');
      return {
        title: look.title,
        subtitle: look.owner?.profile?.displayName ?? 'Nima Edit',
        imageKey: look.coverKey,
        width: look.width,
        height: look.height,
      };
    }

    const product = await app.prisma.product.findUnique({
      where: { id: refId },
      include: {
        store: { select: { name: true } },
        images: { orderBy: { position: 'asc' }, take: 1 },
      },
    });
    if (!product) throw errors.notFound('That piece');
    const image = product.images[0];
    return {
      title: product.title,
      subtitle: product.store.name,
      imageKey: image ? (image.processedKey ?? image.originalKey) : null,
      width: image?.width ?? null,
      height: image?.height ?? null,
    };
  }

  async function sendInto(
    conversationId: string,
    senderId: string,
    message: {
      kind: MessageKind;
      body: string | null;
      refId: string | null;
      snapshot: Snapshot | null;
    },
  ) {
    const now = new Date();

    const row = await app.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId,
          kind: message.kind,
          body: message.body,
          refId: message.refId,
          refSnapshot: (message.snapshot ?? undefined) as never,
          createdAt: now,
        },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
      // Sending is reading: your own message never counts as unread.
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId: senderId } },
        data: { lastReadAt: now, leftAt: null },
      });
      return created;
    });

    const others = await app.prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: senderId } },
      select: { userId: true },
    });

    const preview = previewOf(row.kind, row.body, row.refSnapshot);
    await Promise.all(
      others.map((m) =>
        app.realtime.toUser(m.userId, {
          type: 'message.new',
          conversationId,
          messageId: row.id,
          senderId,
          preview,
        }),
      ),
    );

    return row;
  }

  function presentMessage(
    row: {
      id: string;
      kind: MessageKind;
      body: string | null;
      senderId: string;
      refId: string | null;
      refSnapshot: unknown;
      createdAt: Date;
      deletedAt: Date | null;
    },
    viewerId: string,
  ) {
    const snap = row.refSnapshot as Snapshot | null;
    return {
      id: row.id,
      kind: row.kind,
      body: row.deletedAt ? null : row.body,
      senderId: row.senderId,
      mine: row.senderId === viewerId,
      card:
        row.refId && snap && !row.deletedAt
          ? {
              refId: row.refId,
              title: snap.title,
              subtitle: snap.subtitle,
              image: publicImage(app.storage, snap.imageKey, snap.width, snap.height),
              actionable: row.kind === 'LOOK' || row.kind === 'PRODUCT',
            }
          : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  app.get(
    '/conversations',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['messages'],
        summary: 'My inbox',
        querystring: conversationListQuerySchema,
        response: {
          200: z.object({ items: z.array(conversationSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { limit, cursor } = request.query;

      const rows = await app.prisma.conversation.findMany({
        where: {
          members: { some: { userId: user.id, leftAt: null } },
          lastMessageAt: { not: null },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          members: { include: { user: { select: peerSelect } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const items = await Promise.all(
        page.map(async (row) => {
          const mine = row.members.find((m) => m.userId === user.id);
          const last = row.messages[0];
          const unreadCount = await app.prisma.message.count({
            where: {
              conversationId: row.id,
              senderId: { not: user.id },
              deletedAt: null,
              ...(mine?.lastReadAt ? { createdAt: { gt: mine.lastReadAt } } : {}),
            },
          });

          return {
            id: row.id,
            isGroup: row.isGroup,
            title: row.title,
            peers: row.members.filter((m) => m.userId !== user.id).map((m) => peer(app, m.user)),
            lastMessage: last
              ? {
                  kind: last.kind,
                  preview: last.deletedAt
                    ? 'Message removed'
                    : previewOf(last.kind, last.body, last.refSnapshot),
                  senderId: last.senderId,
                  createdAt: last.createdAt.toISOString(),
                }
              : null,
            unreadCount,
            updatedAt: (row.lastMessageAt ?? row.createdAt).toISOString(),
          };
        }),
      );

      return { items, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
    },
  );

  app.post(
    '/conversations',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['messages'],
        summary: 'Open a conversation with someone',
        description: 'Returns the existing one when there already is one.',
        body: startConversationSchema,
        response: { 200: z.object({ id: idSchema }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const other = request.body.userIds.find((id) => id !== user.id);
      if (!other) throw errors.badRequest('Choose someone to message');

      const person = await app.prisma.user.findUnique({
        where: { id: other },
        select: { id: true, isAnonymous: true, profile: { select: { id: true } } },
      });
      if (!person || person.isAnonymous || !person.profile) throw errors.notFound('That person');
      if (await blockedBetween(app.prisma, user.id, other)) throw errors.notFound('That person');

      return { id: await directConversation(user.id, other) };
    },
  );

  app.get(
    '/conversations/:id',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['messages'],
        summary: 'Who a conversation is with',
        params: z.object({ id: idSchema }),
        response: {
          200: z.object({
            id: idSchema,
            peers: z.array(conversationPeerSchema),
            blocked: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      await membership(request.params.id, user.id);

      const members = await app.prisma.conversationMember.findMany({
        where: { conversationId: request.params.id, userId: { not: user.id } },
        include: { user: { select: peerSelect } },
      });

      const first = members[0];
      const blocked = first ? await blockedBetween(app.prisma, user.id, first.userId) : false;

      return {
        id: request.params.id,
        peers: members.map((m) => peer(app, m.user)),
        blocked,
      };
    },
  );

  app.get(
    '/conversations/:id/messages',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['messages'],
        summary: 'Messages, newest first',
        params: z.object({ id: idSchema }),
        querystring: messageListQuerySchema,
        response: {
          200: z.object({ items: z.array(messageSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { limit, cursor } = request.query;
      await membership(request.params.id, user.id);

      const rows = await app.prisma.message.findMany({
        where: { conversationId: request.params.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        items: page.map((row) => presentMessage(row, user.id)),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    '/conversations/:id/messages',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['messages'],
        summary: 'Send a message',
        params: z.object({ id: idSchema }),
        body: sendMessageSchema,
        response: { 201: messageSchema },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      const { id } = request.params;
      await membership(id, user.id);

      const others = await app.prisma.conversationMember.findMany({
        where: { conversationId: id, userId: { not: user.id } },
        select: { userId: true },
      });
      for (const other of others) {
        if (await blockedBetween(app.prisma, user.id, other.userId)) {
          throw errors.forbidden('You can no longer message this person');
        }
      }

      const { kind, body, refId } = request.body;
      if (kind !== 'TEXT' && kind !== 'LOOK' && kind !== 'PRODUCT') {
        throw errors.badRequest('That cannot be sent here');
      }

      const snapshot = kind === 'TEXT' || !refId ? null : await snapshotOf(kind, refId, user.id);
      const row = await sendInto(id, user.id, {
        kind,
        body: body?.trim() || null,
        refId: kind === 'TEXT' ? null : (refId ?? null),
        snapshot,
      });

      return reply.status(201).send(presentMessage(row, user.id));
    },
  );

  app.post(
    '/conversations/:id/read',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['messages'],
        summary: 'I have seen everything here',
        params: z.object({ id: idSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = request.requireUser();
      await membership(request.params.id, user.id);
      const now = new Date();

      await app.prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: request.params.id, userId: user.id } },
        data: { lastReadAt: now },
      });

      const others = await app.prisma.conversationMember.findMany({
        where: { conversationId: request.params.id, userId: { not: user.id } },
        select: { userId: true },
      });
      await Promise.all(
        others.map((m) =>
          app.realtime.toUser(m.userId, {
            type: 'message.read',
            conversationId: request.params.id,
            userId: user.id,
            at: now.getTime(),
          }),
        ),
      );

      return reply.status(204).send(null);
    },
  );

  app.post(
    '/share',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['messages'],
        summary: 'Send a look or a piece to a few people',
        body: shareToPeopleSchema,
        response: { 200: z.object({ sent: z.number().int() }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const { kind, refId, userIds, note } = request.body;

      const snapshot = await snapshotOf(kind, refId, user.id);
      let sent = 0;

      for (const other of [...new Set(userIds)]) {
        if (other === user.id) continue;
        if (await blockedBetween(app.prisma, user.id, other)) continue;
        const person = await app.prisma.user.findUnique({
          where: { id: other },
          select: { isAnonymous: true, profile: { select: { id: true } } },
        });
        if (!person || person.isAnonymous || !person.profile) continue;

        const conversationId = await directConversation(user.id, other);
        await sendInto(conversationId, user.id, { kind, body: null, refId, snapshot });
        if (note?.trim()) {
          await sendInto(conversationId, user.id, {
            kind: 'TEXT',
            body: note.trim(),
            refId: null,
            snapshot: null,
          });
        }
        sent += 1;
      }

      return { sent };
    },
  );

  // ------------------------------------------------------------ blocking ---

  app.post(
    '/profiles/:handle/block',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Block someone',
        description: 'They stop seeing you, and either follow between you is removed.',
        params: z.object({ handle: handleSchema }),
        response: { 200: z.object({ blocked: z.boolean() }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const person = await personByHandle(request.params.handle);
      if (person.userId === user.id) throw errors.badRequest('You cannot block yourself');

      await app.prisma.$transaction([
        app.prisma.block.upsert({
          where: { blockerId_blockedId: { blockerId: user.id, blockedId: person.userId } },
          create: { blockerId: user.id, blockedId: person.userId },
          update: {},
        }),
        app.prisma.follow.deleteMany({
          where: {
            OR: [
              { followerId: user.id, followedId: person.userId },
              { followerId: person.userId, followedId: user.id },
            ],
          },
        }),
      ]);

      return { blocked: true };
    },
  );

  app.delete(
    '/profiles/:handle/block',
    {
      preHandler: app.requireAccount,
      schema: {
        tags: ['social'],
        summary: 'Unblock someone',
        params: z.object({ handle: handleSchema }),
        response: { 200: z.object({ blocked: z.boolean() }) },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const person = await personByHandle(request.params.handle);
      await app.prisma.block.deleteMany({
        where: { blockerId: user.id, blockedId: person.userId },
      });
      return { blocked: false };
    },
  );
};
