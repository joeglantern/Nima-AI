/**
 * Booth scan to pay, proved end to end over HTTP.
 *
 *   pnpm --filter @nima/api test:booth [path to save the board PNG]
 *
 * Runs against the development database with throwaway buyers and cleans up
 * after itself. The payment provider is a stub HTTP server started here, the
 * same way as checkout-test.ts: the sandbox gateway reports itself unconfigured
 * and cannot settle, so it refuses a checkout by design.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@nima/config';
import { config as loadDotenv } from 'dotenv';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';

loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

const WEBHOOK_SECRET = 'test-webhook-secret';
const STUB_PORT = 3978;
const BOARD_PATH = process.argv[2];

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

function startProviderStub(): Promise<{ server: Server; seen: Array<Record<string, unknown>> }> {
  const seen: Array<Record<string, unknown>> = [];

  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      seen.push({
        ...JSON.parse(body || '{}'),
        idempotencyKey: request.headers['idempotency-key'],
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: `booth_${randomUUID()}`, status: 'pending' }));
    });
  });

  return new Promise((resolve) => {
    server.listen(STUB_PORT, '127.0.0.1', () => resolve({ server, seen }));
  });
}

async function main(): Promise<void> {
  console.info('Booth scan to pay, end to end\n');

  const { server, seen } = await startProviderStub();

  const app = await buildApp({
    env: loadEnv({
      reload: true,
      source: {
        ...process.env,
        FINGO_API_KEY: 'test-key',
        FINGO_WEBHOOK_SECRET: WEBHOOK_SECRET,
        FINGO_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        LOG_LEVEL: 'error',
      },
    }),
  });

  const { prisma } = app;

  // ------------------------------------------------------------ setting up ---

  const before = await app.services.settings.get();
  await app.services.settings.update({ features: { ...before.features, checkout: true } }, 'test');

  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, stock: { gte: 6 }, product: { status: 'ACTIVE' } },
    include: { product: { select: { storeId: true, store: true } } },
    orderBy: { id: 'asc' },
  });

  const mine = variants[0];
  const other = variants.find((entry) => entry.product.storeId !== mine?.product.storeId);
  if (!mine || !other) throw new Error('Seed two stores with stock before running this');

  const store = mine.product.store;
  const stockAtStart = mine.stock;
  const otherStockAtStart = other.stock;

  const run = randomUUID().slice(0, 8);
  const makeBuyer = (label: string) =>
    prisma.user.create({
      data: {
        id: `boothtest${label}${run}`.padEnd(24, '0'),
        email: `booth-${label}-${run}@example.com`,
        name: `Booth ${label}`,
        emailVerified: true,
      },
    });

  const buyer = await makeBuyer('a');
  const secondBuyer = await makeBuyer('b');

  const context = await app.auth.$context;
  const tokens: string[] = [];
  const signedInAs = async (userId: string) => {
    const session = await context.internalAdapter.createSession(userId);
    tokens.push(session.token);
    const signature = createHmac('sha256', context.secret).update(session.token).digest('base64');
    const name = context.authCookies.sessionToken.name;
    return { cookie: `${name}=${encodeURIComponent(`${session.token}.${signature}`)}` };
  };

  const buyerAuth = await signedInAs(buyer.id);
  const secondAuth = await signedInAs(secondBuyer.id);
  const ownerAuth = await signedInAs(store.ownerId);

  // Something saved for later, which a booth purchase must not touch.
  const cart = await prisma.cart.create({ data: { userId: buyer.id } });
  await prisma.cartItem.create({
    data: { cartId: cart.id, productId: other.productId, variantId: other.id, quantity: 1 },
  });

  const url = `/v1/booth/${store.slug}`;
  const stock = async () =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id: mine.id } })).stock;

  const post = (headers: Record<string, string>, body: unknown, path = `${url}/checkout`) =>
    app.inject({ method: 'POST', url: path, headers, payload: body as object });

  const webhook = (payload: string) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/fingo',
      headers: {
        'content-type': 'application/json',
        'x-fingo-signature': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`,
      },
      payload,
    });

  const frames: Array<{ userId: string; frame: { type: string } }> = [];
  const realtime = app.realtime as unknown as {
    toUser: (userId: string, frame: { type: string }) => Promise<void>;
  };
  const toUser = realtime.toUser.bind(realtime);
  realtime.toUser = async (userId, frame) => {
    frames.push({ userId, frame });
    await toUser(userId, frame);
  };

  const groups: string[] = [];

  // -------------------------------------------------------------- the page ---

  console.info('The page behind the QR');

  const page = await app.inject({ method: 'GET', url });
  const pageBody = page.json();
  check('a guest can see the booth page', page.statusCode === 200, page.body);
  check('it names the shop', pageBody.store?.id === store.id, pageBody.store);
  check(
    'it lists the sizes on sale with a price',
    pageBody.items?.some((item: { variants: Array<{ id: string; priceCents: number }> }) =>
      item.variants.some((v) => v.id === mine.id && v.priceCents === mine.priceCents),
    ),
  );
  check('payments read as open', pageBody.paymentsOpen === true, pageBody.paymentsOpen);
  check(
    'the address comes from configuration',
    pageBody.url === `${app.env.API_URL.replace(/\/+$/, '')}/booth/${store.slug}`,
    pageBody.url,
  );
  check('a guest gets no phone number', pageBody.payerPhone === null);
  check(
    'an unknown shop is a 404',
    (await app.inject({ method: 'GET', url: '/v1/booth/no-such-shop-here' })).statusCode === 404,
  );

  // --------------------------------------------------------------- refusals ---

  console.info('\nWhat gets refused');

  const body = (key: string, variantId = mine.id, quantity = 2) => ({
    items: [{ variantId, quantity }],
    payerPhone: '0712345678',
    idempotencyKey: key,
  });

  check(
    'paying needs an account',
    (await post({}, body(`nobody-${run}-0000000`))).statusCode === 401,
  );

  const wrongShop = await post(buyerAuth, body(`wrong-${run}-00000000`, other.id, 1));
  check('an item from another shop is rejected', wrongShop.statusCode === 400, wrongShop.body);

  const mixed = await post(buyerAuth, {
    items: [
      { variantId: mine.id, quantity: 1 },
      { variantId: other.id, quantity: 1 },
    ],
    payerPhone: '0712345678',
    idempotencyKey: `mixed-${run}-00000000`,
  });
  check('one stray item rejects the whole basket', mixed.statusCode === 400, mixed.body);
  check('no prompt was sent for any of that', seen.length === 0, seen);
  check('no stock moved for any of that', (await stock()) === stockAtStart);

  // -------------------------------------------------------------- the sale ---

  console.info('\nThe sale');

  const key = `first-${run}-00000000`;
  const started = await post(buyerAuth, body(key));
  const checkout = started.json();
  groups.push(checkout.id);

  check('the checkout starts', started.statusCode === 200, started.body);
  check('no delivery is charged', checkout.deliveryCents === 0, checkout);
  check('the total is just the goods', checkout.totalCents === mine.priceCents * 2, checkout);
  check('one order for the one shop', checkout.orderIds?.length === 1, checkout.orderIds);
  check('it is not marked paid yet', checkout.status === 'PROCESSING', checkout.status);
  check('the stock falls when the order is placed', (await stock()) === stockAtStart - 2);
  check('one prompt was sent', seen.length === 1, seen);
  check(
    'the prompt is for the right amount and number',
    seen[0]?.amount === Math.round((mine.priceCents * 2) / 100) &&
      seen[0]?.phone === '254712345678',
    seen[0],
  );

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: checkout.orderIds[0] },
    include: { checkoutGroup: true, items: true },
  });
  check('the order is marked as a booth sale', order.channel === 'BOOTH', order.channel);
  check('it belongs to the scanned shop', order.storeId === store.id, order.storeId);
  check('it is tied to the right product', order.items[0]?.productId === mine.productId);
  check('the group says at the booth', order.checkoutGroup.deliveryMethod === 'AT_BOOTH');

  // --------------------------------------------------------------- repeats ---

  console.info('\nA double submit');

  const again = await post(buyerAuth, body(key));
  check('a second submit gets the same checkout', again.json().id === checkout.id, again.body);
  check('a second submit sends no second prompt', seen.length === 1, seen.length);
  check('a second submit takes no more stock', (await stock()) === stockAtStart - 2);

  // ------------------------------------------------------------ the webhook ---

  console.info('\nThe money lands');

  const payment = await prisma.payment.findFirstOrThrow({
    where: { checkoutGroupId: checkout.id },
  });
  const paidPayload = JSON.stringify({
    eventId: randomUUID(),
    id: payment.providerRef,
    status: 'SUCCESS',
    amount: checkout.totalCents / 100,
  });

  frames.length = 0;
  const signed = await webhook(paidPayload);
  check('the webhook is accepted', signed.statusCode === 200, signed.body);

  const settled = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { ledgerEntries: true, shipment: true, checkoutGroup: true },
  });
  const settledPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

  check('the order is paid', settled.status === 'PAID' && settled.paidAt !== null, settled.status);
  check('the payment succeeded', settledPayment.status === 'SUCCEEDED', settledPayment.status);
  check('the group succeeded', settled.checkoutGroup.status === 'SUCCEEDED');
  check(
    'the seller is credited the sale and charged the fee',
    settled.ledgerEntries.some(
      (entry) => entry.kind === 'SALE' && entry.amountCents === settled.subtotalCents,
    ) &&
      settled.ledgerEntries.some(
        (entry) => entry.kind === 'PLATFORM_FEE' && entry.amountCents === -settled.platformFeeCents,
      ) &&
      settled.ledgerEntries.length === 2,
    settled.ledgerEntries,
  );
  check('no courier is booked', settled.shipment === null, settled.shipment);
  check(
    'the seller hears at once over the socket',
    frames.some(({ userId, frame }) => userId === store.ownerId && frame.type === 'order.updated'),
    frames,
  );
  check(
    'the buyer hears at once over the socket',
    frames.some(({ userId, frame }) => userId === buyer.id && frame.type === 'payment.status'),
    frames,
  );

  // The worker writes the row when it is running. Otherwise the job waits for it.
  let notified = false;
  for (let attempt = 0; attempt < 20 && !notified; attempt += 1) {
    const row = await prisma.notification.findFirst({
      where: {
        userId: store.ownerId,
        type: 'ORDER_PLACED',
        body: { contains: order.reference },
      },
    });
    const queued = await app.queues.notification.getJobs(['waiting', 'active', 'delayed']);
    notified =
      row !== null ||
      queued.some(
        (job) => job.data.userId === store.ownerId && job.data.body.includes(order.reference),
      );
    if (!notified) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check('the seller gets the ORDER_PLACED notification', notified);

  const replayLedger = settled.ledgerEntries.length;
  await webhook(paidPayload);
  check(
    'a replayed webhook pays nobody twice',
    (await prisma.sellerLedgerEntry.count({ where: { orderId: order.id } })) === replayLedger,
  );

  const afterPaid = await post(buyerAuth, body(key));
  check(
    'a submit after paying reports paid',
    afterPaid.json().status === 'SUCCEEDED',
    afterPaid.body,
  );
  check('a submit after paying sends no prompt', seen.length === 1, seen.length);

  const items = await prisma.cartItem.findMany({ where: { cartId: cart.id } });
  check(
    'the buyer basket is untouched',
    items.length === 1 && items[0]?.variantId === other.id && items[0]?.quantity === 1,
    items,
  );
  check(
    'the basket item keeps its stock',
    (await prisma.productVariant.findUniqueOrThrow({ where: { id: other.id } })).stock ===
      otherStockAtStart,
  );

  // ---------------------------------------------------------------- receipt ---

  console.info('\nThe receipt and the vendor');

  const receipt = (
    await app.inject({ method: 'GET', url: `/v1/orders/${order.id}`, headers: buyerAuth })
  ).json();
  check(
    'the receipt has shop, items, amount, reference and time',
    receipt.store?.id === store.id &&
      receipt.items?.length === 1 &&
      receipt.totalCents === checkout.totalCents &&
      receipt.reference === order.reference &&
      typeof receipt.paidAt === 'string' &&
      receipt.channel === 'BOOTH',
    receipt,
  );

  const list = await app.inject({ method: 'GET', url: '/v1/seller/orders', headers: ownerAuth });
  const row = list.json().items?.find((entry: { id: string }) => entry.id === order.id);
  check(
    'the vendor sees it, offered only hand over or cancel',
    row?.channel === 'BOOTH' && row?.actions?.join() === 'hand_over,cancel',
    row ?? list.body,
  );

  const action = `/v1/seller/orders/${order.id}/action`;
  const accept = await post(ownerAuth, { action: 'accept' }, action);
  check('a booth sale cannot go to packing', accept.statusCode === 409, accept.body);

  const handed = await post(ownerAuth, { action: 'hand_over' }, action);
  check(
    'handing over closes it',
    handed.statusCode === 200 && handed.json().status === 'DELIVERED',
    handed.body,
  );
  const twice = await post(ownerAuth, { action: 'hand_over' }, action);
  check('it cannot be handed over twice', twice.statusCode === 409, twice.body);

  const known = await app.inject({ method: 'GET', url, headers: buyerAuth });
  check(
    'the number they paid with is offered next time',
    known.json().payerPhone === '254712345678',
    known.json().payerPhone,
  );

  // --------------------------------------------------------------- the race ---

  console.info('\nTwo submits at the same moment');

  const seenBefore = seen.length;
  const stockBefore = await stock();
  const raceKey = `race-${run}-000000000`;
  const [one, two] = await Promise.all([
    post(secondAuth, body(raceKey, mine.id, 1)),
    post(secondAuth, body(raceKey, mine.id, 1)),
  ]);
  groups.push(one.json().id);
  check('both get an answer', one.statusCode === 200 && two.statusCode === 200, [
    one.body,
    two.body,
  ]);
  check('both get the same checkout', one.json().id === two.json().id, [one.body, two.body]);
  check('one prompt between them', seen.length === seenBefore + 1, seen.length - seenBefore);
  check('one piece between them', (await stock()) === stockBefore - 1);

  // -------------------------------------------------------- a failed payment ---

  console.info('\nA payment that fails');

  const racePayment = await prisma.payment.findFirstOrThrow({
    where: { checkoutGroupId: one.json().id },
  });
  await webhook(
    JSON.stringify({
      eventId: randomUUID(),
      id: racePayment.providerRef,
      status: 'FAILED',
      message: 'Request cancelled by user',
    }),
  );
  check('the stock goes back', (await stock()) === stockBefore);
  check(
    'no seller credit for it',
    (await prisma.sellerLedgerEntry.count({
      where: { orderId: { in: one.json().orderIds } },
    })) === 0,
  );

  const sameKey = await post(secondAuth, body(raceKey, mine.id, 1));
  check('the old key reports the failure', sameKey.json().status === 'FAILED', sameKey.body);
  check(
    'and gives the reason',
    sameKey.json().instruction === 'Request cancelled by user',
    sameKey.json().instruction,
  );

  const retry = await post(secondAuth, body(`retry-${run}-00000000`, mine.id, 1));
  groups.push(retry.json().id);
  check('a new try is a new prompt', seen.length === seenBefore + 2, seen.length - seenBefore);
  check('a new try is a new checkout', retry.json().id !== one.json().id);

  // ----------------------------------------------------------- payments off ---

  console.info('\nPayments switched off');

  await app.services.settings.update({ features: { ...before.features, checkout: false } }, 'test');
  const closed = await app.inject({ method: 'GET', url });
  check('the page says payments are off', closed.json().paymentsOpen === false);
  const refused = await post(secondAuth, body(`closed-${run}-0000000`, mine.id, 1));
  check('and a payment is refused', refused.statusCode === 409, refused.body);

  // -------------------------------------------------------------- the board ---

  console.info('\nThe board');

  const board = await app.inject({ method: 'GET', url: `${url}/board.png` });
  const meta = await sharp(board.rawPayload).metadata();
  check('it is a PNG', board.headers['content-type'] === 'image/png', board.headers);
  check(
    'it is at least A5 at 300 dpi',
    (meta.width ?? 0) >= 1748 && (meta.height ?? 0) >= 2480 && meta.density === 300,
    meta,
  );
  const saved = await app.inject({ method: 'GET', url: `${url}/board.png?download=1` });
  check(
    'the print link saves as a file',
    String(saved.headers['content-disposition']).startsWith('attachment'),
    saved.headers,
  );
  console.info(`  note  ${board.rawPayload.length} bytes`);
  if (BOARD_PATH) writeFileSync(BOARD_PATH, board.rawPayload);

  // -------------------------------------------------------------- cleaning up ---

  // The worker may still be writing, so give it a moment before tidying.
  await new Promise((resolve) => setTimeout(resolve, 800));
  await prisma.notification.deleteMany({
    where: { userId: store.ownerId, body: { contains: order.reference } },
  });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: groups } } });
  await prisma.user.deleteMany({ where: { id: { in: [buyer.id, secondBuyer.id] } } });
  await prisma.session.deleteMany({ where: { token: { in: tokens } } });
  await prisma.productVariant.update({ where: { id: mine.id }, data: { stock: stockAtStart } });
  await app.services.settings.update({ features: before.features }, 'test');

  await app.close();
  server.close();

  console.info(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('The booth test could not run:', error);
  process.exit(1);
});
