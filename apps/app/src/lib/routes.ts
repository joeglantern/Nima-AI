/**
 * Routes the generated types spell differently from how they resolve.
 *
 * app/sell/index.tsx is served at /sell, but the type generator lists it as
 * /sell/index. Going through this keeps the address people see clean.
 */

import type { Href } from 'expo-router';

export const SELL_HOME = '/sell' as Href;

export function sellOrders(): Href {
  return { pathname: '/sell', params: { tab: 'orders' } } as unknown as Href;
}
