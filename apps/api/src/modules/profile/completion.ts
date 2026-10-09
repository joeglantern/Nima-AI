/**
 * How far through the style questionnaire someone is.
 *
 * Used for the progress ring on the profile card. It is a hint, never a gate:
 * the brief is explicit that an unfinished questionnaire must not block
 * anything, so nothing in the codebase branches on this number.
 */

import type { StyleProfile } from '@nima/db';

/** Groups of fields that each count once, so sizes do not outweigh style. */
const SECTIONS: Array<(profile: StyleProfile) => boolean> = [
  (p) => p.birthYear !== null || p.gender !== null,
  (p) => p.county !== null || p.city !== null,
  (p) => p.aesthetics.length > 0,
  (p) => p.favouriteColours.length > 0,
  (p) => p.occasions.length > 0,
  (p) => p.budgetMinCents !== null || p.budgetMaxCents !== null,
  (p) => p.topSize !== null || p.bottomSize !== null || p.dressSize !== null,
  (p) => p.shoeSizeEu !== null,
];

export function completionOf(profile: StyleProfile | null): number {
  if (!profile) return 0;

  const done = SECTIONS.reduce((count, test) => count + (test(profile) ? 1 : 0), 0);
  return Math.round((done / SECTIONS.length) * 100);
}
