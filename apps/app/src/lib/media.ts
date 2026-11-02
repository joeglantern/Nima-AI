/**
 * Images at the size they are shown.
 *
 * Photos are stored at full size. Asking the API for a copy no wider than
 * the space on screen is the difference between a feed that costs a few
 * hundred kilobytes and one that costs several megabytes, which on a
 * pay-per-megabyte bundle is the difference between opening Nima and not.
 * The API makes each size once and keeps it.
 */

export type ImageWidth = 240 | 480 | 720 | 1080;

/** Only our own media takes the hint; any other address is left alone. */
export function sized(url: string, width: ImageWidth): string {
  if (!url.includes('/v1/media/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
}
