/**
 * Picking a handle.
 *
 * Used when someone signs up (we need something to show immediately) and when
 * the handle they asked for is taken.
 */

import type { PrismaClient } from '@nima/db';

const RESERVED = new Set([
  'nima',
  'admin',
  'support',
  'help',
  'about',
  'shop',
  'store',
  'explore',
  'foryou',
  'settings',
  'login',
  'signup',
  'api',
  'www',
]);

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18);

  return base.length >= 3 ? base : `friend${base}`;
}

export async function suggestHandle(prisma: PrismaClient, seed: string): Promise<string> {
  const base = slugify(seed);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    // First try the plain handle, then add a short number.
    const candidate = attempt === 0 ? base : `${base}${Math.floor(Math.random() * 9000) + 100}`;

    if (RESERVED.has(candidate)) continue;

    const taken = await prisma.profile.findUnique({
      where: { handle: candidate },
      select: { userId: true },
    });

    if (!taken) return candidate;
  }

  // Twelve collisions means the name is very common. Fall back to something
  // guaranteed to be free.
  return `${base}${Date.now().toString(36).slice(-5)}`;
}
