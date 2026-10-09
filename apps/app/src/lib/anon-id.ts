/**
 * A stable id for this install, used before anyone signs in.
 *
 * It lets the For You page learn from what a visitor looks at during their
 * first session, which is the difference between an empty feed and a useful
 * one. It is random, local, and replaced by the real user id the moment they
 * create an account.
 */

import { sessionStorage } from './session-storage';

const KEY = 'nima.anon-id';

let cached: string | null = null;

function generate(): string {
  // Not security sensitive: it only groups one visitor's own events.
  return `a_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export async function getAnonId(): Promise<string> {
  if (cached) return cached;

  try {
    const stored = await sessionStorage.getItemAsync(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }

    const fresh = generate();
    await sessionStorage.setItemAsync(KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // Private browsing, or storage unavailable. A per session id still works.
    cached ??= generate();
    return cached;
  }
}
