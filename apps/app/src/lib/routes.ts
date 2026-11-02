/**
 * Routes the generated types spell differently from how they resolve.
 *
 * app/sell/index.tsx is served at /sell, but the type generator lists it as
 * /sell/index. Going through this keeps the address people see clean.
 */

import type { Href } from 'expo-router';

export const SELL_HOME = '/sell' as Href;

/**
 * Back, with somewhere to go. A screen opened from a shared link has no
 * history behind it, and a Back that does nothing reads as broken.
 */
export function back(router: {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: Href) => void;
}): void {
  if (router.canGoBack()) router.back();
  else router.replace('/' as Href);
}

/** Hung up: the looks and pieces someone kept. Not in the generated types yet. */
export const SAVED = '/saved' as Href;

export function boothReceipt(id: string): Href {
  return { pathname: '/booth/receipt/[id]', params: { id } } as unknown as Href;
}

export function sellOrders(): Href {
  return { pathname: '/sell', params: { tab: 'orders' } } as unknown as Href;
}
