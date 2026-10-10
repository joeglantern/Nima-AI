/**
 * Credits.
 *
 * One rule, and the whole feature depends on it: **every path that spends an
 * AI call goes through `charge()`**. The previous codebase had four ways to
 * generate an image for free (recreate, retry, chat looks, wardrobe) and it
 * cost real money.
 *
 * The ledger is append only. A balance is never written on its own: it is
 * updated in the same transaction as the entry that explains it, and a check
 * constraint stops it going negative.
 *
 * Granting is lazy. Rather than a weekly cron over every user, the grant is
 * applied the first time a user is seen in a new week, which also means a
 * dormant account costs nothing.
 */

import type { CreditReason, Prisma, PrismaClient } from '@nima/db';
import { errors } from '../lib/errors.js';
import type { SettingsService } from './settings.js';

export interface ChargeInput {
  userId: string;
  amount: number;
  reason: CreditReason;
  refType?: string;
  refId?: string;
  note?: string;
}

export interface BalanceView {
  balance: number;
  nextGrantAt: Date | null;
  freeWeeklyCredits: number;
}

/** Monday 00:00 in East Africa Time, which is how a Kenyan week reads. */
export function startOfWeek(now: Date = new Date()): Date {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = eat.getUTCDay(); // 0 is Sunday
  const daysSinceMonday = (day + 6) % 7;
  const monday = Date.UTC(
    eat.getUTCFullYear(),
    eat.getUTCMonth(),
    eat.getUTCDate() - daysSinceMonday,
  );
  return new Date(monday - 3 * 60 * 60 * 1000);
}

export function nextWeeklyGrant(now: Date = new Date()): Date {
  return new Date(startOfWeek(now).getTime() + 7 * 24 * 60 * 60 * 1000);
}

export class CreditsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Current balance, applying the weekly grant if it is due. Safe to call on
   * every request: the grant only writes when a new week has started.
   */
  async balanceFor(userId: string): Promise<BalanceView> {
    const settings = await this.settings.get();
    const weekStart = startOfWeek();

    const existing = await this.prisma.creditBalance.findUnique({ where: { userId } });

    if (existing && existing.freeGrantedAt && existing.freeGrantedAt >= weekStart) {
      return {
        balance: existing.balance,
        nextGrantAt: nextWeeklyGrant(),
        freeWeeklyCredits: settings.freeWeeklyCredits,
      };
    }

    const isFirstEver = !existing;
    const grant = settings.freeWeeklyCredits + (isFirstEver ? settings.signupBonusCredits : 0);

    if (grant <= 0) {
      return {
        balance: existing?.balance ?? 0,
        nextGrantAt: nextWeeklyGrant(),
        freeWeeklyCredits: settings.freeWeeklyCredits,
      };
    }

    const balance = await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction so two parallel requests cannot both
      // grant for the same week.
      const row = await tx.creditBalance.findUnique({ where: { userId } });
      if (row?.freeGrantedAt && row.freeGrantedAt >= weekStart) return row.balance;

      await tx.creditLedgerEntry.create({
        data: {
          userId,
          delta: settings.freeWeeklyCredits,
          reason: 'WEEKLY_GRANT',
          note: 'Weekly free credits',
        },
      });

      if (isFirstEver && settings.signupBonusCredits > 0) {
        await tx.creditLedgerEntry.create({
          data: {
            userId,
            delta: settings.signupBonusCredits,
            reason: 'SIGNUP_BONUS',
            note: 'Welcome to Nima',
          },
        });
      }

      const updated = await tx.creditBalance.upsert({
        where: { userId },
        create: { userId, balance: grant, freeGrantedAt: new Date() },
        update: { balance: { increment: grant }, freeGrantedAt: new Date() },
      });

      return updated.balance;
    });

    return {
      balance,
      nextGrantAt: nextWeeklyGrant(),
      freeWeeklyCredits: settings.freeWeeklyCredits,
    };
  }

  /** How much an action costs right now. */
  async costOf(
    action: keyof Awaited<ReturnType<SettingsService['get']>>['creditCosts'],
  ): Promise<number> {
    const settings = await this.settings.get();
    return settings.creditCosts[action];
  }

  /**
   * Take credits. Throws 402 with a readable message when there are not
   * enough, which the app turns into the buy credits sheet.
   *
   * Pass an open transaction when the charge has to be atomic with the work
   * it pays for, which is the normal case: charge and enqueue together, so a
   * crash between the two cannot take credits without doing the work.
   */
  async charge(input: ChargeInput, tx?: Prisma.TransactionClient): Promise<number> {
    if (input.amount <= 0) {
      throw new Error('charge() needs a positive amount');
    }

    const run = async (client: Prisma.TransactionClient): Promise<number> => {
      const row = await client.creditBalance.findUnique({ where: { userId: input.userId } });
      const balance = row?.balance ?? 0;

      if (balance < input.amount) {
        throw errors.insufficientCredits(input.amount, balance);
      }

      await client.creditLedgerEntry.create({
        data: {
          userId: input.userId,
          delta: -input.amount,
          reason: input.reason,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          note: input.note ?? null,
        },
      });

      const updated = await client.creditBalance.update({
        where: { userId: input.userId },
        data: { balance: { decrement: input.amount } },
      });

      return updated.balance;
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  /**
   * Give credits back. Used when a job fails, and it is idempotent per
   * reference so a retried failure cannot refund twice.
   */
  async refund(input: ChargeInput): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      if (input.refId) {
        const already = await tx.creditLedgerEntry.findFirst({
          where: { userId: input.userId, reason: 'REFUND', refId: input.refId },
        });
        if (already) {
          const row = await tx.creditBalance.findUnique({ where: { userId: input.userId } });
          return row?.balance ?? 0;
        }
      }

      await tx.creditLedgerEntry.create({
        data: {
          userId: input.userId,
          delta: input.amount,
          reason: 'REFUND',
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          note: input.note ?? 'Refunded because the image could not be made',
        },
      });

      const updated = await tx.creditBalance.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, balance: input.amount },
        update: { balance: { increment: input.amount } },
      });

      return updated.balance;
    });
  }

  /** Credits bought with money. Called after a payment is confirmed. */
  async grantPurchase(userId: string, credits: number, purchaseId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const already = await tx.creditLedgerEntry.findFirst({
        where: { userId, reason: 'PURCHASE', refId: purchaseId },
      });
      if (already) {
        const row = await tx.creditBalance.findUnique({ where: { userId } });
        return row?.balance ?? 0;
      }

      await tx.creditLedgerEntry.create({
        data: {
          userId,
          delta: credits,
          reason: 'PURCHASE',
          refType: 'credit_purchase',
          refId: purchaseId,
          note: `${credits} credits`,
        },
      });

      const updated = await tx.creditBalance.upsert({
        where: { userId },
        create: { userId, balance: credits },
        update: { balance: { increment: credits } },
      });

      return updated.balance;
    });
  }

  async history(userId: string, limit: number, cursor?: string) {
    return this.prisma.creditLedgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
