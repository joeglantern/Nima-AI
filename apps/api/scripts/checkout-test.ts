/**
 * The money path, proved end to end.
 *
 * The smoke test walks the HTTP surface. This one does the thing that is
 * actually dangerous: takes stock, places orders across two shops, sends a
 * payment, and settles it on a signed webhook. It checks the numbers that
 * would cost somebody real money if they were wrong.
 *
 *   pnpm --filter @nima/api test:checkout
 *
 * It runs against the development database and cleans up after itself. The
 * payment provider is a stub HTTP server started here, so no request leaves
 * the machine and no shilling moves.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@nima/config';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from '../src/app.js';

loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

const WEBHOOK_SECRET = 'test-webhook-secret';
const STUB_PORT = 3977;

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

/** Stands in for Fingo. Records what it was asked and answers like they do. */
function startProviderStub(): Promise<{ server: Server; seen: unknown[] }> {
  const seen: unknown[] = [];

  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      seen.push(JSON.parse(body || '{}'));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: `fingo_${seen.length}`, status: 'pending' }));
    });
  });

  return new Promise((resolve) => {
    server.listen(STUB_PORT, '127.0.0.1', () => resolve({ server, seen }));
  });
}

async function main(): Promise<void> {
  console.info('Checkout, end to end\n');

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

  const buyer = await prisma.user.findFirstOrThrow({ where: { email: 'wanjiru@example.com' } });

  // Two shops, so the split into separate orders is really exercised.
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, stock: { gte: 3 }, product: { status: 'ACTIVE' } },
    include: { product: { select: { storeId: true, title: true } } },
    orderBy: { id: 'asc' },
  });

  const first = variants[0];
  const second = variants.find((entry) => entry.product.storeId !== first?.product.storeId);

  if (!first || !second) throw new Error('Seed two stores with stock before running this');

  const stockBefore = { first: first.stock, second: second.stock };

  const cart = await prisma.cart.upsert({
    where: { userId: buyer.id },
    create: { userId: buyer.id },
    update: {},
  });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cartItem.createMany({
    data: [
      { cartId: cart.id, productId: first.productId, variantId: first.id, quantity: 2 },
      { cartId: cart.id, productId: second.productId, variantId: second.id, quantity: 1 },
    ],
  });

  const expectedSubtotal = first.priceCents * 2 + second.priceCents;

  // ------------------------------------------------------------- the order ---

  console.info('Placing the order');

  const settings = await app.services.settings.get();
  const checkout = await app.services.checkout.start({
    userId: buyer.id,
    deliveryMethod: 'PICKUP_POINT',
    pickupPointId: 'cbd-moi-avenue',
    recipientName: 'Wanjiru Kamau',
    recipientPhone: '0712345678',
    payerPhone: '0712345678',
  });

  check('the basket became two orders, one per shop', checkout.orderIds.length === 2, checkout);
  check('the subtotal is the sum of the real prices', checkout.subtotalCents === expectedSubtotal, {
    got: checkout.subtotalCents,
    expected: expectedSubtotal,
  });
  check(
    'delivery is charged once for the whole basket',
    checkout.deliveryCents === settings.delivery.pickupPointCents,
    checkout,
  );
  check(
    'the total is the subtotal plus delivery',
    checkout.totalCents === expectedSubtotal + checkout.deliveryCents,
    checkout,
  );

  const orders = await prisma.order.findMany({
    where: { checkoutGroupId: checkout.id },
    include: { items: true },
  });

  check(
    'the orders add up to exactly what was charged',
    orders.reduce((total, order) => total + order.totalCents, 0) === checkout.totalCents,
    orders.map((order) => order.totalCents),
  );
  check(
    'nothing is paid yet',
    orders.every((order) => order.status === 'PENDING_PAYMENT'),
    orders.map((order) => order.status),
  );

  const afterPlacing = await prisma.productVariant.findMany({
    where: { id: { in: [first.id, second.id] } },
    orderBy: { id: 'asc' },
  });

  check(
    'the stock was taken when the order was placed',
    afterPlacing.find((entry) => entry.id === first.id)?.stock === stockBefore.first - 2 &&
      afterPlacing.find((entry) => entry.id === second.id)?.stock === stockBefore.second - 1,
    afterPlacing.map((entry) => entry.stock),
  );

  const emptied = await prisma.cartItem.count({ where: { cartId: cart.id } });
  check('the basket is empty', emptied === 0, emptied);

  check('the provider was asked for exactly one prompt', seen.length === 1, seen);
  check(
    'the provider was sent the total in whole shillings',
    (seen[0] as { amount: number }).amount === Math.round(checkout.totalCents / 100),
    seen[0],
  );
  check(
    'the phone was normalised for Safaricom',
    (seen[0] as { phone: string }).phone === '254712345678',
    seen[0],
  );

  const payment = await prisma.payment.findFirstOrThrow({
    where: { checkoutGroupId: checkout.id },
  });
  check('the payment is waiting on the phone', payment.status === 'PROCESSING', payment.status);

  // --------------------------------------------------------- the money lands ---

  console.info('\nSettling');

  const paidPayload = JSON.stringify({
    eventId: randomUUID(),
    id: payment.providerRef,
    status: 'SUCCESS',
    amount: checkout.totalCents / 100,
  });

  const signed = await app.inject({
    method: 'POST',
    url: '/webhooks/fingo',
    headers: {
      'content-type': 'application/json',
      'x-fingo-signature': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(paidPayload).digest('hex')}`,
    },
    payload: paidPayload,
  });

  check('the webhook is accepted', signed.statusCode === 200, signed.body);

  const settled = await prisma.order.findMany({
    where: { checkoutGroupId: checkout.id },
    include: { ledgerEntries: true, shipment: true },
  });

  check(
    'every order is paid',
    settled.every((order) => order.status === 'PAID' && order.paidAt !== null),
    settled.map((order) => order.status),
  );
  check(
    'each shop gets a sale and a fee on its ledger',
    settled.every(
      (order) =>
        order.ledgerEntries.length === 2 &&
        order.ledgerEntries.some(
          (entry) => entry.kind === 'SALE' && entry.amountCents === order.subtotalCents,
        ) &&
        order.ledgerEntries.some(
          (entry) => entry.kind === 'PLATFORM_FEE' && entry.amountCents === -order.platformFeeCents,
        ),
    ),
    settled.map((order) => order.ledgerEntries),
  );
  check(
    'the fee matches the rate that was set',
    settled.every(
      (order) =>
        order.platformFeeCents ===
        Math.round((order.subtotalCents * settings.platformFeeBps) / 10_000),
    ),
    settled.map((order) => ({ sub: order.subtotalCents, fee: order.platformFeeCents })),
  );
  check(
    'the seller is not credited with the delivery fee',
    settled.every(
      (order) =>
        order.ledgerEntries.find((entry) => entry.kind === 'SALE')?.amountCents ===
        order.subtotalCents,
    ),
  );
  check(
    'nothing is payable until it has been delivered',
    settled.every((order) => order.ledgerEntries.every((entry) => entry.availableAt === null)),
  );
  check(
    'each order has a collection booked',
    settled.every((order) => order.shipment?.pickupPointName === 'Moi Avenue agent'),
    settled.map((order) => order.shipment?.pickupPointName),
  );

  // ----------------------------------------------------------------- replays ---

  console.info('\nReplays and forgeries');

  const ledgerBefore = await prisma.sellerLedgerEntry.count({
    where: { orderId: { in: settled.map((order) => order.id) } },
  });

  const replay = await app.inject({
    method: 'POST',
    url: '/webhooks/fingo',
    headers: {
      'content-type': 'application/json',
      'x-fingo-signature': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(paidPayload).digest('hex')}`,
    },
    payload: paidPayload,
  });

  const ledgerAfter = await prisma.sellerLedgerEntry.count({
    where: { orderId: { in: settled.map((order) => order.id) } },
  });

  check('a replayed webhook is accepted', replay.statusCode === 200);
  check('a replayed webhook pays nobody twice', ledgerAfter === ledgerBefore, {
    before: ledgerBefore,
    after: ledgerAfter,
  });

  const forged = await app.inject({
    method: 'POST',
    url: '/webhooks/fingo',
    headers: { 'content-type': 'application/json', 'x-fingo-signature': 'sha256=deadbeef' },
    payload: JSON.stringify({ eventId: randomUUID(), id: payment.providerRef, status: 'SUCCESS' }),
  });

  const forgedRow = await prisma.webhookEvent.findFirst({
    where: { signatureOk: false },
    orderBy: { receivedAt: 'desc' },
  });

  check('a forged webhook is answered politely', forged.statusCode === 200);
  check('a forged webhook is written down and not acted on', forgedRow !== null);

  // ---------------------------------------------------- when the payment fails ---

  console.info('\nA payment that fails');

  await prisma.cartItem.create({
    data: { cartId: cart.id, productId: first.productId, variantId: first.id, quantity: 1 },
  });

  const doomed = await app.services.checkout.start({
    userId: buyer.id,
    deliveryMethod: 'PICKUP_POINT',
    pickupPointId: 'cbd-moi-avenue',
    recipientName: 'Wanjiru Kamau',
    recipientPhone: '0712345678',
    payerPhone: '0712345678',
  });

  const stockWhileHeld = await prisma.productVariant.findUniqueOrThrow({ where: { id: first.id } });

  const doomedPayment = await prisma.payment.findFirstOrThrow({
    where: { checkoutGroupId: doomed.id },
  });

  const failedPayload = JSON.stringify({
    eventId: randomUUID(),
    id: doomedPayment.providerRef,
    status: 'FAILED',
    message: 'Request cancelled by user',
  });

  await app.inject({
    method: 'POST',
    url: '/webhooks/fingo',
    headers: {
      'content-type': 'application/json',
      'x-fingo-signature': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(failedPayload).digest('hex')}`,
    },
    payload: failedPayload,
  });

  const returned = await prisma.productVariant.findUniqueOrThrow({ where: { id: first.id } });
  const cancelled = await prisma.order.findMany({ where: { checkoutGroupId: doomed.id } });

  check('the stock goes back on the shelf', returned.stock === stockWhileHeld.stock + 1, {
    held: stockWhileHeld.stock,
    returned: returned.stock,
  });
  check(
    'the order is cancelled with a reason the buyer can read',
    cancelled.every(
      (order) => order.status === 'CANCELLED' && order.cancelReason === 'Request cancelled by user',
    ),
    cancelled.map((order) => ({ status: order.status, reason: order.cancelReason })),
  );
  check(
    'no seller was credited for an order nobody paid for',
    (await prisma.sellerLedgerEntry.count({
      where: { orderId: { in: cancelled.map((order) => order.id) } },
    })) === 0,
  );

  // ------------------------------------------------------- an amount that lies ---

  console.info('\nAn amount that does not match');

  await prisma.cartItem.create({
    data: { cartId: cart.id, productId: second.productId, variantId: second.id, quantity: 1 },
  });

  const shortChanged = await app.services.checkout.start({
    userId: buyer.id,
    deliveryMethod: 'PICKUP_POINT',
    pickupPointId: 'cbd-moi-avenue',
    recipientName: 'Wanjiru Kamau',
    recipientPhone: '0712345678',
    payerPhone: '0712345678',
  });

  const shortPayment = await prisma.payment.findFirstOrThrow({
    where: { checkoutGroupId: shortChanged.id },
  });

  const shortPayload = JSON.stringify({
    eventId: randomUUID(),
    id: shortPayment.providerRef,
    status: 'SUCCESS',
    amount: 1,
  });

  await app.inject({
    method: 'POST',
    url: '/webhooks/fingo',
    headers: {
      'content-type': 'application/json',
      'x-fingo-signature': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(shortPayload).digest('hex')}`,
    },
    payload: shortPayload,
  });

  const shortOrders = await prisma.order.findMany({
    where: { checkoutGroupId: shortChanged.id },
  });

  check(
    'one shilling does not buy a sneaker',
    shortOrders.every((order) => order.status === 'CANCELLED'),
    shortOrders.map((order) => order.status),
  );

  // -------------------------------------------------------------- cleaning up ---

  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.checkoutGroup.deleteMany({
    where: { id: { in: [checkout.id, doomed.id, shortChanged.id] } },
  });
  await prisma.productVariant.update({
    where: { id: first.id },
    data: { stock: stockBefore.first },
  });
  await prisma.productVariant.update({
    where: { id: second.id },
    data: { stock: stockBefore.second },
  });
  await app.services.settings.update({ features: before.features }, 'test');

  await app.close();
  server.close();

  console.info(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('The checkout test could not run:', error);
  process.exit(1);
});
