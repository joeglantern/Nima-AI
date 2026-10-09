/**
 * The For You feed.
 *
 * Version one is rule based and honest about it. Vectors come later, once
 * there is enough behaviour to learn from; a cold recommender trained on no
 * data is worse than good rules.
 *
 * Candidates come from four places, then one score sorts them:
 *   1. fresh public looks
 *   2. looks from people and stores the viewer follows
 *   3. looks that match the viewer's stated style
 *   4. what is getting engagement right now
 *
 * Signals that lower a score: already seen, dismissed with "not for me",
 * same author twice in a row, and anything from a blocked account.
 */

import type { FastifyInstance } from 'fastify';
import { type Prisma } from '@nima/db';

export interface FeedViewer {
  userId: string | null;
  anonId: string | null;
}

export interface FeedOptions {
  surface: 'foryou' | 'explore' | 'following';
  limit: number;
  occasion?: string;
  /** Looks already returned earlier in this scroll. */
  excludeIds: string[];
}

type LookWithRelations = Prisma.LookGetPayload<{
  include: {
    owner: { include: { profile: true; store: true } };
    _count: { select: { items: true } };
    items: { include: { product: { select: { tags: true; occasions: true; category: true } } } };
  };
}>;

export interface ScoredLook {
  look: LookWithRelations;
  score: number;
  reason: string;
}

const HOUR = 60 * 60 * 1000;

export class FeedService {
  constructor(private readonly app: FastifyInstance) {}

  async build(viewer: FeedViewer, options: FeedOptions): Promise<ScoredLook[]> {
    const [style, follows, dismissed, seen, blocked] = await Promise.all([
      this.styleOf(viewer.userId),
      this.followedAuthorIds(viewer.userId),
      this.dismissedLookIds(viewer.userId),
      this.recentlySeenLookIds(viewer),
      this.blockedUserIds(viewer.userId),
    ]);

    const where: Prisma.LookWhereInput = {
      visibility: 'PUBLIC',
      publishedAt: { not: null },
      coverKey: { not: null },
      ...(options.excludeIds.length || dismissed.size
        ? { id: { notIn: [...new Set([...options.excludeIds, ...dismissed])] } }
        : {}),
      ...(blocked.size ? { ownerId: { notIn: [...blocked] } } : {}),
      ...(options.surface === 'following' && follows.size
        ? { ownerId: { in: [...follows] } }
        : {}),
      ...(options.occasion
        ? { items: { some: { product: { occasions: { has: options.occasion } } } } }
        : {}),
    };

    // Pull a wider pool than needed, then rank. Three times the page size is
    // enough variety without making the query expensive.
    const pool = await this.app.prisma.look.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: Math.min(options.limit * 4, 120),
      include: {
        owner: { include: { profile: true, store: true } },
        _count: { select: { items: true } },
        items: {
          include: { product: { select: { tags: true, occasions: true, category: true } } },
        },
      },
    });

    const now = Date.now();
    const scored: ScoredLook[] = pool.map((look) => {
      let score = 0;
      let reason = 'Fresh on Nima';

      // Freshness: a strong pull for the first day, fading over a week.
      const ageHours = (now - (look.publishedAt ?? look.createdAt).getTime()) / HOUR;
      score += Math.max(0, 40 - ageHours / 4);

      // Engagement, dampened so one viral look does not own the feed.
      score += Math.log1p(look.likeCount * 2 + look.saveCount * 3 + look.tryOnCount * 4) * 8;

      if (look.ownerId && follows.has(look.ownerId)) {
        score += 25;
        reason = 'From someone you follow';
      }

      if (style) {
        const tags = new Set<string>();
        for (const item of look.items) {
          for (const tag of item.product?.tags ?? []) tags.add(tag.toLowerCase());
          for (const occasion of item.product?.occasions ?? []) tags.add(occasion.toLowerCase());
        }

        const styleMatches = style.aesthetics.filter((aesthetic) =>
          tags.has(aesthetic.toLowerCase()),
        ).length;
        const occasionMatches = style.occasions.filter((occasion) =>
          tags.has(occasion.toLowerCase()),
        ).length;

        if (styleMatches > 0) {
          score += styleMatches * 18;
          reason = 'Matches your style';
        }
        if (occasionMatches > 0) {
          score += occasionMatches * 12;
        }
      }

      // Seller and curated content is useful but should not dominate what is
      // meant to feel social.
      if (look.source === 'SELLER') score -= 6;
      if (look.source === 'CURATED') score += 4;

      // Already scrolled past it today.
      if (seen.has(look.id)) score -= 30;

      // A look nobody can shop is less useful on the shopping surface.
      if (look._count.items === 0) score -= 12;

      return { look, score, reason };
    });

    scored.sort((a, b) => b.score - a.score);

    return this.spreadAuthors(scored).slice(0, options.limit);
  }

  /** No two cards in a row from the same person. */
  private spreadAuthors(scored: ScoredLook[]): ScoredLook[] {
    const result: ScoredLook[] = [];
    const held: ScoredLook[] = [];

    for (const entry of scored) {
      const previous = result.at(-1);
      if (previous && previous.look.ownerId && previous.look.ownerId === entry.look.ownerId) {
        held.push(entry);
        continue;
      }
      result.push(entry);

      // Re-insert anything held back as soon as it no longer clashes.
      const index = held.findIndex((candidate) => candidate.look.ownerId !== entry.look.ownerId);
      if (index !== -1) {
        const [release] = held.splice(index, 1);
        if (release) result.push(release);
      }
    }

    return [...result, ...held];
  }

  private async styleOf(userId: string | null) {
    if (!userId) return null;
    return this.app.prisma.styleProfile.findUnique({
      where: { userId },
      select: { aesthetics: true, occasions: true, favouriteColours: true, gender: true },
    });
  }

  private async followedAuthorIds(userId: string | null): Promise<Set<string>> {
    if (!userId) return new Set();

    const follows = await this.app.prisma.follow.findMany({
      where: { followerId: userId },
      select: { followedId: true },
    });

    return new Set(follows.map((f) => f.followedId).filter((id): id is string => id !== null));
  }

  private async dismissedLookIds(userId: string | null): Promise<Set<string>> {
    if (!userId) return new Set();

    const rows = await this.app.prisma.dismissal.findMany({
      where: { userId, lookId: { not: null } },
      select: { lookId: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });

    return new Set(rows.map((row) => row.lookId).filter((id): id is string => id !== null));
  }

  private async blockedUserIds(userId: string | null): Promise<Set<string>> {
    if (!userId) return new Set();

    const [made, against] = await Promise.all([
      this.app.prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
      this.app.prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
    ]);

    return new Set([...made.map((b) => b.blockedId), ...against.map((b) => b.blockerId)]);
  }

  /** Seen in the last day, from the event log. */
  private async recentlySeenLookIds(viewer: FeedViewer): Promise<Set<string>> {
    if (!viewer.userId && !viewer.anonId) return new Set();

    const rows = await this.app.prisma.event.findMany({
      where: {
        ...(viewer.userId ? { userId: viewer.userId } : { anonId: viewer.anonId }),
        type: 'VIEW',
        entityType: 'look',
        createdAt: { gte: new Date(Date.now() - 24 * HOUR) },
      },
      select: { entityId: true },
      take: 300,
      orderBy: { createdAt: 'desc' },
    });

    return new Set(rows.map((row) => row.entityId));
  }
}
