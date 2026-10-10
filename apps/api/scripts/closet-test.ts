/**
 * Wardrobe and lookbooks, end to end.
 *
 *   pnpm --filter @nima/api test:closet
 *
 * These two are the half of Nima that is not a shop, and both are entirely
 * about things that belong to one person. So most of what is checked here
 * is that they belong to the right one: another account cannot read your
 * wardrobe, cannot put something of yours in their lookbook, and cannot
 * open a lookbook you kept private.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@nima/config';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from '../src/app.js';

loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

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

const env = loadEnv({ reload: true, source: { ...process.env, LOG_LEVEL: 'error' } });

async function main(): Promise<void> {
  console.info('Wardrobe and lookbooks\n');

  const app = await buildApp({ env });
  const { prisma } = app;

  // Two real accounts, because the point of this is who can see what.
  const owner = await prisma.user.findFirstOrThrow({ where: { email: 'wanjiru@example.com' } });
  const stranger = await prisma.user.findFirstOrThrow({
    where: { email: { not: owner.email }, isAnonymous: false, emailVerified: true },
    orderBy: { createdAt: 'asc' },
  });

  console.info(`  as ${owner.email} and ${stranger.email}\n`);

  /**
   * Sign in properly, through the real email code flow.
   *
   * No test only header and no hand written session row. A backdoor added
   * for a test is a backdoor, and a session built by hand would not prove
   * the guards work against the thing a real request carries.
   */
  async function signIn(email: string): Promise<Record<string, string>> {
    const origin = { origin: env.API_URL, 'content-type': 'application/json' };

    await app.inject({
      method: 'POST',
      url: '/api/auth/email-otp/send-verification-otp',
      headers: origin,
      payload: JSON.stringify({ email, type: 'sign-in' }),
    });

    const verification = await prisma.verification.findFirstOrThrow({
      where: { identifier: { contains: email } },
      orderBy: { createdAt: 'desc' },
    });

    const code = verification.value.split(':')[0];

    const result = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      headers: origin,
      payload: JSON.stringify({ email, otp: code }),
    });

    if (result.statusCode !== 200) {
      throw new Error(`Could not sign in as ${email}: ${result.statusCode} ${result.body}`);
    }

    const cookies = result.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

    return { cookie: cookies };
  }

  const ownerAuth = await signIn(owner.email);
  const strangerAuth = await signIn(stranger.email);
  const as = (user: { id: string }) => (user.id === owner.id ? ownerAuth : strangerAuth);

  // --------------------------------------------------------- wardrobe ---
  console.info('Wardrobe');

  await prisma.wardrobeItem.deleteMany({ where: { userId: owner.id, label: 'Test jacket' } });

  const created = await prisma.wardrobeItem.create({
    data: {
      userId: owner.id,
      label: 'Test jacket',
      category: 'OUTERWEAR',
      slot: 'OUTERWEAR',
      originalKey: 'seed/products/ankara-panel-shirt.jpg',
      visibility: 'PRIVATE',
    },
  });

  const mine = await app.inject({ method: 'GET', url: '/v1/wardrobe', headers: as(owner) });
  const minePayload = mine.json() as { items: Array<{ id: string; label: string | null }> };

  check('the owner can read their wardrobe', mine.statusCode === 200, mine.statusCode);
  check(
    'the item they added is in it',
    minePayload.items.some((item) => item.id === created.id),
    minePayload.items.length,
  );

  const theirs = await app.inject({ method: 'GET', url: '/v1/wardrobe', headers: as(stranger) });
  const theirsPayload = theirs.json() as { items: Array<{ id: string }> };

  check(
    'another account sees none of it',
    !theirsPayload.items.some((item) => item.id === created.id),
    theirsPayload.items.length,
  );

  const stolen = await app.inject({
    method: 'PATCH',
    url: `/v1/wardrobe/${created.id}`,
    headers: { ...as(stranger), 'content-type': 'application/json' },
    payload: JSON.stringify({ label: 'Mine now' }),
  });
  check('another account cannot rename it', stolen.statusCode === 404, stolen.statusCode);

  const deleted = await app.inject({
    method: 'DELETE',
    url: `/v1/wardrobe/${created.id}`,
    headers: as(stranger),
  });
  check('another account cannot delete it', deleted.statusCode === 404, deleted.statusCode);

  // -------------------------------------------------------- lookbooks ---
  console.info('\nLookbooks');

  await prisma.lookbook.deleteMany({ where: { ownerId: owner.id, title: 'Test trip' } });

  const made = await app.inject({
    method: 'POST',
    url: '/v1/lookbooks',
    headers: { ...as(owner), 'content-type': 'application/json' },
    payload: JSON.stringify({ title: 'Test trip', visibility: 'PRIVATE' }),
  });

  check('a lookbook can be started', made.statusCode === 201, made.body);
  const book = made.json() as { id: string; entryCount: number };
  check('it starts empty', book.entryCount === 0, book);

  const look = await prisma.look.findFirstOrThrow({ where: { visibility: 'PUBLIC' } });

  const added = await app.inject({
    method: 'POST',
    url: `/v1/lookbooks/${book.id}/entries`,
    headers: { ...as(owner), 'content-type': 'application/json' },
    payload: JSON.stringify({ lookId: look.id }),
  });
  check('a public look can be added to it', added.statusCode === 201, added.body);

  const read = await app.inject({
    method: 'GET',
    url: `/v1/lookbooks/${book.id}`,
    headers: as(owner),
  });
  const readPayload = read.json() as {
    lookbook: { entryCount: number };
    entries: Array<{ id: string; look: { id: string } | null }>;
  };

  check('the owner can open it', read.statusCode === 200, read.statusCode);
  check('what was added is in it', readPayload.entries.length === 1, readPayload.entries);
  check(
    'the look comes back resolved, not as a bare id',
    readPayload.entries[0]?.look?.id === look.id,
    readPayload.entries[0],
  );

  const peeked = await app.inject({
    method: 'GET',
    url: `/v1/lookbooks/${book.id}`,
    headers: as(stranger),
  });
  check(
    'a private lookbook is invisible to anyone else',
    peeked.statusCode === 404,
    peeked.statusCode,
  );

  const intruder = await app.inject({
    method: 'POST',
    url: `/v1/lookbooks/${book.id}/entries`,
    headers: { ...as(stranger), 'content-type': 'application/json' },
    payload: JSON.stringify({ lookId: look.id }),
  });
  check('nobody else can add to it', intruder.statusCode === 404, intruder.statusCode);

  // A wardrobe item belonging to someone else must not become readable by
  // being put in a lookbook.
  const theirItem = await prisma.wardrobeItem.create({
    data: {
      userId: stranger.id,
      label: 'Not yours',
      category: 'TOP',
      slot: 'TOP',
      originalKey: 'seed/products/boxy-logo-tee.jpg',
      visibility: 'PRIVATE',
    },
  });

  const borrowed = await app.inject({
    method: 'POST',
    url: `/v1/lookbooks/${book.id}/entries`,
    headers: { ...as(owner), 'content-type': 'application/json' },
    payload: JSON.stringify({ wardrobeItemId: theirItem.id }),
  });
  check(
    "someone else's wardrobe item cannot be added",
    borrowed.statusCode === 404,
    borrowed.statusCode,
  );

  // ------------------------------------------------------- cleaning up ---
  await prisma.wardrobeItem.deleteMany({ where: { id: { in: [created.id, theirItem.id] } } });
  await prisma.lookbook.deleteMany({ where: { id: book.id } });

  await app.close();

  console.info(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('The closet test could not run:', error);
  process.exit(1);
});
