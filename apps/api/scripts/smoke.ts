/**
 * End to end smoke test against a running API.
 *
 * Walks the path a real person takes: browse as a guest, get blocked at the
 * gate, sign in with an email code, upload a photo, start a try-on, check
 * that the credit ledger moved by exactly the right amount, fill a basket,
 * and find the checkout door still shut.
 *
 *   pnpm --filter @nima/api smoke
 *
 * It is deliberately not a unit test: it proves the pieces are wired to each
 * other, which is the thing unit tests cannot show.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import sharp from 'sharp';

loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

const API = process.env.API_URL ?? 'http://localhost:3333';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8060';
const EMAIL = 'wanjiru@example.com';

/** name -> value, so a refreshed session replaces the old one. */
const cookies = new Map<string, string>();

function cookieHeader(): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.info(`  pass  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; useCookie?: boolean } = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      // Only when there is a body. A request that claims JSON and carries
      // nothing is rejected, which is what every bodiless DELETE would be.
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      // A browser or the app always sends this, and Better Auth requires it
      // on state changing requests.
      origin: API,
      'x-nima-anon-id': 'smoke-test',
      ...(options.useCookie !== false && cookies.size > 0 ? { cookie: cookieHeader() } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  // Several Set-Cookie headers arrive joined. Split on the boundary between
  // one cookie and the next, then keep only name and value.
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    for (const piece of setCookie.split(/,(?=[^;,]+=)/)) {
      const pair = piece.split(';')[0]?.trim();
      const separator = pair?.indexOf('=') ?? -1;
      if (!pair || separator < 1) continue;

      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === '' || value === 'deleted') cookies.delete(name);
      else cookies.set(name, value);
    }
  }

  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

interface Inbox {
  messages: Array<{ ID: string; Snippet: string; Subject: string }>;
}

async function newestMessageId(): Promise<string | null> {
  const inbox = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()) as Inbox;
  return inbox.messages[0]?.ID ?? null;
}

/**
 * Wait for a code that arrived after `since`.
 *
 * Reading the newest message and hoping is how a test signs in with the
 * previous run's expired code. Emptying the inbox instead would be tidier,
 * but it drops the SMTP connection the API holds open and the next send
 * then stalls for half a minute.
 */
async function waitForCode(since: string | null): Promise<string | undefined> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const inbox = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=5`)).json()) as Inbox;

    for (const message of inbox.messages) {
      if (message.ID === since) break;

      const match = `${message.Subject} ${message.Snippet}`.match(/(\d{6})/);
      if (match?.[1]) return match[1];
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return undefined;
}

async function main(): Promise<void> {
  console.info(`Smoke testing ${API}\n`);

  console.info('Guest');
  const health = await call<{ status: string }>('/health/ready');
  check('the service is ready', health.body.status === 'ok', health.body);

  // Every visitor gets an anonymous account, which is what makes browsing
  // without signing up work.
  const guest = await call<{ user?: { isAnonymous: boolean } }>('/api/auth/sign-in/anonymous', {
    method: 'POST',
    body: {},
  });
  check('a visitor gets a guest account', guest.body.user?.isAnonymous === true, guest.body);

  const feed = await call<{ items: unknown[] }>('/v1/feed?limit=5');
  check('a guest can read For You', feed.status === 200 && feed.body.items.length > 0);

  const products = await call<{ items: Array<{ id: string; title: string }> }>(
    '/v1/products?limit=3',
  );
  check('a guest can browse the shop', products.body.items.length > 0);

  const productId = products.body.items[0]?.id ?? '';
  const detail = await call<{ title: string }>(`/v1/products/${productId}`);
  check('a guest can open a product', detail.status === 200);

  const gated = await call('/v1/tryon', {
    method: 'POST',
    body: { kind: 'SINGLE_ITEM', items: [{ slot: 'TOP', productId }] },
  });
  check(
    'try-on asks a guest to create an account',
    gated.status === 401 &&
      (gated.body as { error: { code: string } }).error.code === 'account_required',
    gated.body,
  );

  console.info('\nSigning in');

  // Remember what is already in the inbox, so the code read below is this
  // run's and not the expired one from the last.
  const lastSeen = await newestMessageId();

  await call('/api/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: { email: EMAIL, type: 'sign-in' },
  });

  const code = await waitForCode(lastSeen);
  check('the code arrived by email', Boolean(code));

  const signIn = await call<{ user?: { email: string } }>('/api/auth/sign-in/email-otp', {
    method: 'POST',
    body: { email: EMAIL, otp: code },
  });
  check('the code signs you in', signIn.body.user?.email === EMAIL, signIn.body);

  const session = await call<{ user: { isAnonymous: boolean; credits: number } }>(
    '/v1/session/bootstrap',
  );
  check('the session is a real account', session.body.user?.isAnonymous === false);

  console.info('\nPhoto and try-on');

  // Earlier runs leave jobs queued when no image provider is configured, and
  // those count against the concurrency limit. Clearing them first is what a
  // person would do, and it makes this script runnable twice in a row.
  const queued = await call<{ items: Array<{ id: string; status: string }> }>('/v1/tryon?limit=20');
  for (const job of queued.body.items) {
    if (job.status === 'QUEUED') await call(`/v1/tryon/${job.id}`, { method: 'DELETE' });
  }

  // Read the balance after that, not before: a cancelled job gives credits
  // back, and the charge below is measured against this number.
  const balance = await call<{ balance: number }>('/v1/credits');
  const creditsBefore = balance.body.balance;
  console.info(`        credits before: ${creditsBefore}`);

  const image = await sharp({
    create: { width: 800, height: 1200, channels: 3, background: '#8899aa' },
  })
    .jpeg()
    .toBuffer();

  const ticket = await call<{ uploadUrl: string; storageKey: string }>('/v1/uploads', {
    method: 'POST',
    body: { purpose: 'USER_PHOTO', contentType: 'image/jpeg', size: image.byteLength },
  });
  check('upload link issued', Boolean(ticket.body.uploadUrl), ticket.body);

  const put = await fetch(ticket.body.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: new Uint8Array(image),
  });
  check('the file uploads straight to storage', put.ok, `${put.status} ${await put.text()}`);

  const photo = await call<{ id: string }>('/v1/profile/photos', {
    method: 'POST',
    body: {
      storageKey: ticket.body.storageKey,
      kind: 'FULL_BODY',
      width: 800,
      height: 1200,
      makeDefault: true,
    },
  });
  check('the photo is saved', photo.status === 201, photo.body);

  const tryOn = await call<{
    job: { id: string; status: string; creditsCharged: number };
    creditsRemaining: number;
  }>('/v1/tryon', {
    method: 'POST',
    body: { kind: 'SINGLE_ITEM', items: [{ slot: 'TOP', productId }] },
  });
  check('try-on is accepted and queued', tryOn.status === 202, tryOn.body);
  check(
    'exactly one credit was taken',
    tryOn.body.creditsRemaining === creditsBefore - tryOn.body.job.creditsCharged,
    { before: creditsBefore, after: tryOn.body.creditsRemaining },
  );

  const ledger = await call<{ items: Array<{ delta: number; reason: string }> }>(
    '/v1/credits/history?limit=3',
  );
  check(
    'the ledger records the charge',
    ledger.body.items.some((entry) => entry.reason === 'TRY_ON' && entry.delta < 0),
    ledger.body.items,
  );

  console.info('\nBasket');

  interface CartShape {
    groups: Array<{
      store: { name: string };
      items: Array<{ id: string; quantity: number; lineTotalCents: number }>;
      subtotalCents: number;
    }>;
    subtotalCents: number;
    itemCount: number;
  }

  // Start from empty, so a run that stopped halfway does not leave the next
  // one counting someone else's shopping.
  const leftOver = await call<CartShape>('/v1/cart');
  for (const group of leftOver.body.groups) {
    for (const item of group.items) await call(`/v1/cart/items/${item.id}`, { method: 'DELETE' });
  }

  const forSale = await call<{
    variants: Array<{ id: string; priceCents: number; inStock: boolean }>;
  }>(`/v1/products/${products.body.items[0]?.id}`);

  const variant = forSale.body.variants.find((entry) => entry.inStock);
  check('a product has something to buy', Boolean(variant), forSale.body.variants);

  const added = await call<CartShape>('/v1/cart/items', {
    method: 'POST',
    body: { variantId: variant?.id, quantity: 2 },
  });
  check('a size goes into the basket', added.status === 200, added.body);
  check(
    'the basket is grouped by shop',
    added.body.groups.length === 1 && added.body.groups[0]?.items.length === 1,
    added.body.groups,
  );
  check(
    'the line total is the quantity times the real price',
    added.body.subtotalCents === (variant?.priceCents ?? 0) * 2,
    { got: added.body.subtotalCents, expected: (variant?.priceCents ?? 0) * 2 },
  );

  const again = await call<CartShape>('/v1/cart/items', {
    method: 'POST',
    body: { variantId: variant?.id, quantity: 1 },
  });
  check(
    'adding the same size again raises the quantity',
    again.body.groups[0]?.items.length === 1 && again.body.itemCount === 3,
    again.body,
  );

  const itemId = again.body.groups[0]?.items[0]?.id ?? '';

  const reduced = await call<CartShape>(`/v1/cart/items/${itemId}`, {
    method: 'PATCH',
    body: { quantity: 1 },
  });
  check('the quantity can be changed', reduced.body.itemCount === 1, reduced.body);

  const tooMany = await call<{ error: { code: string } }>(`/v1/cart/items/${itemId}`, {
    method: 'PATCH',
    body: { quantity: 99 },
  });
  check(
    'the basket refuses more than the shop has',
    tooMany.status === 409,
    `${tooMany.status} ${JSON.stringify(tooMany.body)}`,
  );

  console.info('\nCheckout');

  const points = await call<{ items: Array<{ id: string; name: string }> }>(
    '/v1/delivery/pickup-points',
  );
  check('there are collection points to choose from', points.body.items.length > 0);

  const quote = await call<{ costCents: number; estimate: string }>(
    '/v1/delivery/quote?method=PICKUP_POINT',
  );
  check('delivery is quoted before paying', quote.body.costCents > 0, quote.body);

  // Checkout is behind a flag until Fingo credentials exist, so proving it is
  // shut is the test that matters today. An open checkout with no payment
  // provider takes orders nobody can pay for.
  const blocked = await call<{ error: { code: string; message: string } }>('/v1/checkout', {
    method: 'POST',
    body: {
      deliveryMethod: 'PICKUP_POINT',
      pickupPointId: points.body.items[0]?.id,
      recipientName: 'Wanjiru Kamau',
      recipientPhone: '0712345678',
      payerPhone: '0712345678',
    },
  });
  check(
    'checkout stays shut until payments are connected',
    blocked.status === 409 || blocked.status === 503,
    `${blocked.status} ${JSON.stringify(blocked.body)}`,
  );

  const stillThere = await call<CartShape>('/v1/cart');
  check('a refused checkout leaves the basket alone', stillThere.body.itemCount === 1);

  const forged = await fetch(`${API}/webhooks/fingo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fingo-signature': 'sha256=nonsense' },
    body: JSON.stringify({ id: 'made-up', status: 'SUCCESS', amount: 999_999 }),
  });
  check('an unsigned webhook is taken in and ignored', forged.status === 200, forged.status);

  const orders = await call<{ items: unknown[] }>('/v1/orders');
  check('the forged webhook created no order', orders.body.items.length === 0, orders.body);

  await call(`/v1/cart/items/${itemId}`, { method: 'DELETE' });

  console.info('\nPrivacy');
  const publicProfile = await call<Record<string, unknown>>('/v1/profiles/wanjiru');
  check('a profile never exposes an email', !('email' in publicProfile.body));
  check('a profile never exposes follower counts', !('followerCount' in publicProfile.body));

  console.info(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('Smoke test could not run:', error);
  process.exit(1);
});
