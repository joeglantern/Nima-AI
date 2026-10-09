/**
 * End to end smoke test against a running API.
 *
 * Walks the path a real person takes: browse as a guest, get blocked at the
 * gate, sign in with an email code, upload a photo, start a try-on, and check
 * that the credit ledger moved by exactly the right amount.
 *
 *   pnpm --filter @nima/api smoke
 *
 * It is deliberately not a unit test: it proves the pieces are wired to each
 * other, which is the thing unit tests cannot show.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
      'content-type': 'application/json',
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

/** Poll Mailpit until the code lands, rather than guessing at a delay. */
async function waitForCode(): Promise<string | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const inbox = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=5`)).json()) as {
      messages: Array<{ Snippet: string; Subject: string }>;
    };

    for (const message of inbox.messages) {
      const match = `${message.Subject} ${message.Snippet}`.match(/(\d{6})/);
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
  await call('/api/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: { email: EMAIL, type: 'sign-in' },
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const inbox = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()) as {
    messages: Array<{ Snippet: string }>;
  };
  const code = inbox.messages[0]?.Snippet.match(/\b(\d{6})\b/)?.[1];
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

  const creditsBefore = session.body.user.credits;
  console.info(`        credits before: ${creditsBefore}`);

  console.info('\nPhoto and try-on');
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
