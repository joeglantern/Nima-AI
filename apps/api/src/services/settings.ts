/**
 * Business settings, read through a short lived cache.
 *
 * Credit costs, the free weekly grant, the platform fee and feature flags all
 * live in the database so staff can change them without a deploy. They are
 * read on nearly every request, so they are cached in memory for a minute and
 * invalidated across nodes through Valkey.
 */

import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings, settingsSchema } from '@nima/config';
import type { PrismaClient } from '@nima/db';
import type { Redis } from 'ioredis';

const CACHE_TTL_MS = 60_000;
const INVALIDATION_CHANNEL = 'nima:settings:changed';

export class SettingsService {
  private cache: Settings | null = null;
  private loadedAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async get(): Promise<Settings> {
    if (this.cache && Date.now() - this.loadedAt < CACHE_TTL_MS) {
      return this.cache;
    }

    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });

    if (!row) {
      // First boot: write the defaults so they are visible and editable.
      await this.prisma.appSetting.create({
        data: { key: SETTINGS_KEY, value: DEFAULT_SETTINGS },
      });
      this.cache = DEFAULT_SETTINGS;
      this.loadedAt = Date.now();
      return this.cache;
    }

    const parsed = settingsSchema.safeParse(row.value);
    // A malformed row must not take the API down. Fall back to the defaults
    // and leave the bad value in place for someone to look at.
    this.cache = parsed.success ? parsed.data : DEFAULT_SETTINGS;
    this.loadedAt = Date.now();
    return this.cache;
  }

  async update(patch: Partial<Settings>, updatedBy: string): Promise<Settings> {
    const current = await this.get();
    const next = settingsSchema.parse({ ...current, ...patch });

    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: next, updatedBy },
      update: { value: next, updatedBy },
    });

    this.cache = next;
    this.loadedAt = Date.now();
    await this.redis.publish(INVALIDATION_CHANNEL, '1');
    return next;
  }

  /** Called by the pub/sub listener when another node changes the settings. */
  invalidate(): void {
    this.cache = null;
    this.loadedAt = 0;
  }

  static get invalidationChannel(): string {
    return INVALIDATION_CHANNEL;
  }
}
