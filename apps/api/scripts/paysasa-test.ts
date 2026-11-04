/**
 * PaySasa, end to end, against a fake PaySasa started here.
 *
 *   pnpm --filter @nima/api test:paysasa
 *
 * Runs against the development database and cleans up after itself. The fake
 * answers /checkout/sessions, /checkout/sessions/:id/pay and
 * /checkout/sessions/:id the way the docs describe, on 127.0.0.1, so no
 * request leaves the machine and no shilling moves.
 *
 * What it proves: a webhook alone never pays anyone, a session read that
 * disagrees on amount credits nobody, repeats and races credit once, a stuck
 * payment is closed or confirmed without any webhook, money that arrives late
 * is recorded for a refund by hand, a double tap pushes one prompt, a failure
 * before the session is named unwinds cleanly while one after it waits, and
 * a seller cancel records the refund for a person to send.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@nima/config';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from '../src/app.js';
import { BY_HAND } from '../src/services/payment-sync.js';

loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

const API_KEY = 'apk_test_placeholder.local';
const BUSINESS_ID = 'biz_fake_nima';
const WEBHOOK_SECRET = 'whsec_placeholder_local';
const FAKE_PORT = 3981;

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

// -------------------------------------------------------------- fake paysasa ---

interface FakeSession {
  id: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  failure_reason?: string | null;
}

const fake = {
  sessions: new Map<string, FakeSession>(),
  creates: [] as Array<Record<string, unknown>>,
  pays: [] as Array<{ sessionId: string; body: Record<string, unknown>; idempotencyKey: string }>,
  keys: new Set<string>(),
  createMode: 'ok' as 'ok' | '502',
  payMode: 'ok' as 'ok' | 'fail' | '502',
  /** Sessions the fake pretends never existed, for the NOT_FOUND path. */
  forgotten: new Set<string>(),
};

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
  });
}

function startFakePaysasa(): Promise<Server> {
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${FAKE_PORT}`);
    const raw = await readBody(request);
    fake.keys.add(String(request.headers['x-api-key']));

    if (request.method === 'POST' && url.pathname === '/api/v1/checkout/sessions') {
      if (fake.createMode === '502') return send(502, {});
      const body = JSON.parse(raw) as Record<string, unknown>;
      fake.creates.push(body);
      const session: FakeSession = {
        id: `ses_${randomUUID().slice(0, 12)}`,
        reference: `CHK-${fake.sessions.size + 1}`,
        status: 'pending',
        amount: Number(body.amount),
        currency: String(body.currency),
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      };
      fake.sessions.set(session.id, session);
      return send(201, {
        session: {
          ...session,
          hosted_url: `http://127.0.0.1:${FAKE_PORT}/checkout/${session.id}`,
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
      });
    }

    const payMatch = url.pathname.match(/^\/api\/v1\/checkout\/sessions\/([^/]+)\/pay$/);
    if (request.method === 'POST' && payMatch) {
      const sessionId = decodeURIComponent(payMatch[1] ?? '');
      const session = fake.sessions.get(sessionId);
      if (!session) return send(404, { error: 'Session not found' });
      if (fake.payMode === '502') return send(502, {});
      const body = JSON.parse(raw) as Record<string, unknown>;
      const idempotencyKey = String(request.headers['x-idempotency-key']);
      const earlier = fake.pays.find((entry) => entry.idempotencyKey === idempotencyKey);
      fake.pays.push({ sessionId, body, idempotencyKey });
      if (earlier) {
        return send(200, { status: 'processing', idempotent_replay: true });
      }
      if (fake.payMode === 'fail') {
        return send(422, { error: 'Insufficient balance', code: 'insufficient_funds' });
      }
      session.status = 'processing';
      return send(200, { status: 'processing', checkout_request_id: `ws_CO_${sessionId}` });
    }

    const getMatch = url.pathname.match(/^\/api\/v1\/checkout\/sessions\/([^/]+)$/);
    if (request.method === 'GET' && getMatch) {
      const sessionId = decodeURIComponent(getMatch[1] ?? '');
      const session = fake.sessions.get(sessionId);
      if (!session || fake.forgotten.has(sessionId)) {
        return send(404, { error: 'Session not found' });
      }
      return send(200, { session });
    }

    return send(404, { error: 'Not found' });
  });

  return new Promise((resolve) => server.listen(FAKE_PORT, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------- the test ---

async function main(): Promise<void> {
  console.info('PaySasa, end to end, against a local fake\n');

  const server = await startFakePaysasa();
  const startedAt = new Date();

  const app = await buildApp({
    env: loadEnv({
      reload: true,
      source: {
        ...process.env,
        PAYSASA_API_KEY: API_KEY,
        PAYSASA_BUSINESS_ID: BUSINESS_ID,
        PAYSASA_WEBHOOK_SECRET: WEBHOOK_SECRET,
        PAYSASA_BASE_URL: `http://127.0.0.1:${FAKE_PORT}/api/v1`,
        PAYSTACK_SECRET_KEY: '',
        PAYMENT_RECONCILE_SECONDS: '0',
        FINGO_API_KEY: '',
        FINGO_WEBHOOK_SECRET: '',
        LOG_LEVEL: 'fatal',
      },
    }),
  });

  const { prisma } = app;
  const sync = app.services.paymentSync;
  check('PaySasa is the gateway in use', app.services.payments.name === 'PAYSASA');

  const before = await app.services.settings.get();
  await app.services.settings.update({ features: { ...before.features, checkout: true } }, 'test');

  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, stock: { gte: 8 }, product: { status: 'ACTIVE' } },
    include: { product: { select: { storeId: true, store: true } } },
    orderBy: { id: 'asc' },
  });
  const first = variants[0];
  const second = variants.find((entry) => entry.product.storeId !== first?.product.storeId);
  if (!first || !second) throw new Error('Seed two stores with stock before running this');
  const stockAtStart = { first: first.stock, second: second.stock };

  const run = randomUUID().slice(0, 8);
  const buyer = await prisma.user.create({
    data: {
      id: `sasatest${run}`.padEnd(24, '0'),
      email: `paysasa-${run}@example.com`,
      name: 'PaySasa Test',
      emailVerified: true,
    },
  });
  const cart = await prisma.cart.create({ data: { userId: buyer.id } });

  const fill = async (items: Array<[typeof first, number]>) => {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cartItem.createMany({
      data: items.map(([variant, quantity]) => ({
        cartId: cart.id,
        productId: variant.productId,
        variantId: variant.id,
        quantity,
      })),
    });
  };

  const start = () =>
    app.services.checkout.start({
      userId: buyer.id,
      deliveryMethod: 'PICKUP_POINT',
      pickupPointId: 'cbd-moi-avenue',
      recipientName: 'Wanjiru Kamau',
      recipientPhone: '0712345678',
      payerPhone: '0712345678',
    });

  const paymentOf = (checkoutId: string) =>
    prisma.payment.findFirstOrThrow({ where: { checkoutGroupId: checkoutId } });
  const ordersOf = (checkoutId: string) =>
    prisma.order.findMany({
      where: { checkoutGroupId: checkoutId },
      include: { ledgerEntries: true, shipment: true, refunds: true },
    });
  const age = (paymentId: string, ms: number) =>
    prisma.payment.update({
      where: { id: paymentId },
      data: { createdAt: new Date(Date.now() - ms) },
    });
  const stockOf = async (id: string) =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
  const session = (id: string) => {
    const found = fake.sessions.get(id);
    if (!found) throw new Error(`The fake has no session ${id}`);
    return found;
  };
  const mark = (id: string, status: string, patch: Partial<FakeSession> = {}) =>
    Object.assign(session(id), { status }, patch);

  const webhook = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: '/webhooks/paysasa',
      headers: {
        'content-type': 'application/json',
        'x-paysasa-signature':
          signature ?? `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`,
      },
      payload: raw,
    });
  };
  const checkoutPaid = (sessionId: string, amount: number) =>
    webhook({
      event: 'checkout.paid',
      created_at: new Date().toISOString(),
      data: {
        session_id: sessionId,
        reference: fake.sessions.get(sessionId)?.reference ?? 'CHK-?',
        amount,
        currency: 'KES',
        payment_method: 'm_pesa',
        metadata: fake.sessions.get(sessionId)?.metadata ?? {},
      },
    });

  // ---------------------------------------------------------- a clean payment ---

  console.info('A payment that goes through');
  await fill([
    [first, 2],
    [second, 1],
  ]);
  const happy = await start();
  const happyPayment = await paymentOf(happy.id);
  const created = fake.creates.at(-1) as {
    amount: number;
    currency: string;
    business_id: string;
    allow_methods: string[];
    metadata: { source: string; idempotencyKey: string };
  };
  const pushed = fake.pays.at(-1);

  check(
    'the payment is waiting on the phone',
    happy.status === 'PROCESSING' && happyPayment.status === 'PROCESSING',
  );
  check('the payment is recorded against PaySasa', happyPayment.provider === 'PAYSASA');
  check(
    'the session id is the reference on the payment',
    typeof happyPayment.providerRef === 'string' && fake.sessions.has(happyPayment.providerRef),
    happyPayment.providerRef,
  );
  check('the amount is sent in cents', created.amount === happy.totalCents, created);
  check('the currency is KES', created.currency === 'KES');
  check('the session is created under our business', created.business_id === BUSINESS_ID);
  check('only M-Pesa is offered', created.allow_methods.join() === 'm_pesa', created.allow_methods);
  check(
    'our idempotency key rides along in the metadata',
    created.metadata.idempotencyKey === happyPayment.idempotencyKey,
    created.metadata,
  );
  check(
    'the prompt goes to the phone in 254 form',
    pushed?.body.payment_method === 'm_pesa' && pushed.body.phone === '254712345678',
    pushed?.body,
  );
  check(
    'the pay call carries the idempotency key',
    pushed?.idempotencyKey === happyPayment.idempotencyKey,
  );
  check('the key is sent as x-api-key', fake.keys.has(API_KEY));

  // The webhook arrives before PaySasa shows it paid: nothing happens.
  const early = await checkoutPaid(happyPayment.providerRef as string, happy.totalCents);
  check('a webhook is answered 200', early.statusCode === 200, early.body);
  check(
    'a webhook alone pays nobody while the session still says processing',
    (await ordersOf(happy.id)).every((order) => order.status === 'PENDING_PAYMENT'),
  );

  mark(happyPayment.providerRef as string, 'paid');
  const paid = await checkoutPaid(happyPayment.providerRef as string, happy.totalCents);
  check('the confirming webhook is answered 200', paid.statusCode === 200);
  const settled = await ordersOf(happy.id);
  check(
    'read back as paid, every order is paid',
    settled.every((order) => order.status === 'PAID'),
    settled.map((o) => o.status),
  );
  check(
    'each shop gets exactly a sale and a fee',
    settled.every((order) => order.ledgerEntries.length === 2),
    settled.map((order) => order.ledgerEntries.length),
  );
  check(
    'the session summary is kept, without the phone',
    !JSON.stringify((await paymentOf(happy.id)).raw).includes('12345678') &&
      JSON.stringify((await paymentOf(happy.id)).raw).includes('paysasaReference'),
  );

  // ------------------------------------------------------- repeats and forgeries ---

  console.info('\nRepeats, races and forgeries');
  for (let i = 0; i < 3; i += 1) {
    await checkoutPaid(happyPayment.providerRef as string, happy.totalCents);
  }
  const afterRepeat = await ordersOf(happy.id);
  check(
    'a repeated webhook pays nobody twice',
    afterRepeat.every((order) => order.ledgerEntries.length === 2),
  );
  const rows = await prisma.webhookEvent.count({
    where: { provider: 'paysasa', externalId: `checkout.paid:${happyPayment.providerRef}` },
  });
  check('a repeated webhook is stored once', rows === 1, rows);

  await fill([[first, 1]]);
  const forgedCheckout = await start();
  const forgedPayment = await paymentOf(forgedCheckout.id);
  const forged = await webhook(
    {
      event: 'checkout.paid',
      data: { session_id: forgedPayment.providerRef, amount: forgedCheckout.totalCents },
    },
    'ab'.repeat(32),
  );
  check('a forged webhook is answered 200', forged.statusCode === 200);
  check(
    'a forged webhook changes nothing',
    (await paymentOf(forgedCheckout.id)).status === 'PROCESSING',
  );
  const unsigned = await webhook(
    { event: 'checkout.paid', data: { session_id: forgedPayment.providerRef } },
    createHmac('sha512', WEBHOOK_SECRET).update('{}').digest('hex'),
  );
  check('the wrong hash is a bad signature too', unsigned.statusCode === 200);

  // Webhook, reconcile and a polling screen, all at once.
  mark(forgedPayment.providerRef as string, 'paid');
  await age(forgedPayment.id, 20_000);
  await Promise.allSettled([
    checkoutPaid(forgedPayment.providerRef as string, forgedCheckout.totalCents),
    sync.reconcile(),
    sync.confirm(forgedPayment.providerRef as string, 'poll'),
    sync.confirm(forgedPayment.providerRef as string, 'reconcile'),
  ]);
  const raced = await ordersOf(forgedCheckout.id);
  check(
    'webhook, reconcile and poll together credit once',
    raced.every((order) => order.status === 'PAID' && order.ledgerEntries.length === 2),
    raced.map((order) => ({ status: order.status, ledger: order.ledgerEntries.length })),
  );

  // ------------------------------------------------------- the read disagrees ---

  console.info('\nThe session read disagrees with the order');
  await fill([[first, 1]]);
  const short = await start();
  const shortPayment = await paymentOf(short.id);
  const firstStockHeld = await stockOf(first.id);
  mark(shortPayment.providerRef as string, 'paid', { amount: short.totalCents - 100 });
  await checkoutPaid(shortPayment.providerRef as string, short.totalCents);
  const shortOrders = await ordersOf(short.id);
  check(
    'an amount that does not match credits nobody',
    shortOrders.every((order) => order.ledgerEntries.length === 0),
  );
  check(
    'and the order does not go through',
    shortOrders.every((order) => order.status === 'CANCELLED'),
  );
  check('and the stock goes back', (await stockOf(first.id)) === firstStockHeld + 1);
  check(
    'and no automatic refund is guessed at',
    shortOrders.every((order) => order.refunds.length === 0),
  );

  await fill([[first, 1]]);
  const usd = await start();
  const usdPayment = await paymentOf(usd.id);
  mark(usdPayment.providerRef as string, 'paid', { currency: 'USD' });
  await checkoutPaid(usdPayment.providerRef as string, usd.totalCents);
  check(
    'the right number in the wrong currency credits nobody',
    (await ordersOf(usd.id)).every(
      (order) => order.status === 'CANCELLED' && order.ledgerEntries.length === 0,
    ),
  );

  await fill([[first, 1]]);
  const other = await start();
  const otherPayment = await paymentOf(other.id);
  mark(otherPayment.providerRef as string, 'paid', { id: 'ses_someone_else' });
  await checkoutPaid(otherPayment.providerRef as string, other.totalCents);
  check(
    'a read that answers about a different session credits nobody',
    (await ordersOf(other.id)).every((order) => order.status === 'PENDING_PAYMENT'),
  );
  mark(otherPayment.providerRef as string, 'failed', { id: otherPayment.providerRef as string });
  await sync.confirm(otherPayment.providerRef as string, 'reconcile');

  const stranger = await checkoutPaid('ses_not_ours_123', 1000);
  check('a session that is not ours is ignored politely', stranger.statusCode === 200);

  // ----------------------------------------------------- stuck, no webhook ever ---

  console.info('\nNo webhook ever comes');
  await fill([[second, 1]]);
  const broke = await start();
  const brokePayment = await paymentOf(broke.id);
  const secondHeld = await stockOf(second.id);
  mark(brokePayment.providerRef as string, 'failed', { failure_reason: 'Insufficient funds' });
  await sync.reconcile();
  check(
    'a payment younger than ten seconds is left alone',
    (await paymentOf(broke.id)).status === 'PROCESSING',
  );
  await age(brokePayment.id, 20_000);
  await sync.reconcile();
  const brokeAfter = await paymentOf(broke.id);
  check(
    'reconcile closes a failed payment with no webhook',
    brokeAfter.status === 'FAILED',
    brokeAfter.status,
  );
  check(
    'the buyer is told what to do in plain words',
    (brokeAfter.failureReason ?? '').startsWith('There was not enough in that M-Pesa account'),
    brokeAfter.failureReason,
  );
  check('the stock goes back', (await stockOf(second.id)) === secondHeld + 1);

  await fill([[second, 1]]);
  const quiet = await start();
  const quietPayment = await paymentOf(quiet.id);
  mark(quietPayment.providerRef as string, 'paid');
  await age(quietPayment.id, 20_000);
  await sync.refreshCheckout(quiet.id);
  check(
    'a polling screen confirms a payment whose webhook never came',
    (await ordersOf(quiet.id)).every(
      (order) => order.status === 'PAID' && order.ledgerEntries.length === 2,
    ),
  );
  await checkoutPaid(quietPayment.providerRef as string, quiet.totalCents);
  check(
    'the late webhook after that pays nobody twice',
    (await ordersOf(quiet.id)).every((order) => order.ledgerEntries.length === 2),
  );

  await fill([[second, 1]]);
  const pending = await start();
  const pendingPayment = await paymentOf(pending.id);
  await age(pendingPayment.id, 5 * 60_000);
  await sync.reconcile();
  check(
    'still processing after five minutes keeps waiting',
    (await paymentOf(pending.id)).status === 'PROCESSING',
  );
  await age(pendingPayment.id, 16 * 60_000);
  await sync.reconcile();
  const givenUp = await paymentOf(pending.id);
  check('and is closed after fifteen', givenUp.status === 'FAILED', givenUp.status);
  check(
    'with words that promise the money back if it ever left',
    (givenUp.failureReason ?? '').includes('sent back'),
    givenUp.failureReason,
  );

  // ------------------------------------------------- expired, then paid late ---

  console.info('\nExpired, then the money arrives');
  await fill([
    [first, 1],
    [second, 1],
  ]);
  const late = await start();
  const latePayment = await paymentOf(late.id);
  mark(latePayment.providerRef as string, 'expired');
  await age(latePayment.id, 20_000);
  await sync.reconcile();
  const expired = await paymentOf(late.id);
  check('an expired session is closed at once', expired.status === 'FAILED', expired.status);
  check(
    'with the expiry message',
    (expired.failureReason ?? '').includes('expired'),
    expired.failureReason,
  );
  const expiredEvent = await webhook({
    event: 'checkout.expired',
    data: { session_id: latePayment.providerRef },
  });
  check('a checkout.expired webhook is taken in', expiredEvent.statusCode === 200);

  mark(latePayment.providerRef as string, 'paid');
  await checkoutPaid(latePayment.providerRef as string, late.totalCents);
  await checkoutPaid(latePayment.providerRef as string, late.totalCents);
  const lateRefunds = await prisma.refund.findMany({
    where: { paymentId: latePayment.id },
    orderBy: { createdAt: 'asc' },
  });
  check(
    'money that lands on a closed checkout is marked for return',
    (await paymentOf(late.id)).status === 'REFUNDED',
  );
  check(
    'in full, once, across both shops, each for a person to send',
    lateRefunds.length === 2 &&
      lateRefunds.reduce((sum, entry) => sum + entry.amountCents, 0) === late.totalCents &&
      lateRefunds.every((entry) => entry.status === 'PENDING' && entry.providerRef === BY_HAND),
    lateRefunds.map((entry) => ({
      amount: entry.amountCents,
      status: entry.status,
      ref: entry.providerRef,
    })),
  );
  check(
    'and nobody is credited for it',
    (await ordersOf(late.id)).every((order) => order.ledgerEntries.length === 0),
  );
  const refundsBeforeSweep = await prisma.refund.count({
    where: { paymentId: latePayment.id, providerRef: BY_HAND },
  });
  await sync.reconcile();
  check(
    'the timer leaves refunds by hand alone',
    (await prisma.refund.count({ where: { paymentId: latePayment.id, providerRef: BY_HAND } })) ===
      refundsBeforeSweep,
  );

  // ----------------------------------------------- the session never existed ---

  console.info('\nPaySasa forgets a session');
  await fill([[first, 1]]);
  const lost = await start();
  const lostPayment = await paymentOf(lost.id);
  const heldForLost = await stockOf(first.id);
  fake.forgotten.add(lostPayment.providerRef as string);
  await age(lostPayment.id, 60_000);
  await sync.reconcile();
  check(
    'not found inside the prompt window still waits',
    (await paymentOf(lost.id)).status === 'PROCESSING',
  );
  await age(lostPayment.id, 5 * 60_000);
  await sync.reconcile();
  check('not found after the window is closed', (await paymentOf(lost.id)).status === 'FAILED');
  check('and the stock goes back', (await stockOf(first.id)) === heldForLost + 1);

  // --------------------------------------------------------- refused at charge ---

  console.info('\nRefused, or no clear answer, at the charge');
  await fill([[first, 1]]);
  const stockBeforeDecline = await stockOf(first.id);
  fake.payMode = 'fail';
  const declined = await start().then(
    () => null,
    (error: Error) => error,
  );
  fake.payMode = 'ok';
  check(
    'a refused prompt is an error the buyer can read',
    declined?.message.startsWith('There was not enough') === true,
    declined?.message,
  );
  check('and the stock goes back at once', (await stockOf(first.id)) === stockBeforeDecline);

  await fill([[first, 1]]);
  fake.createMode = '502';
  const noSession = await start().then(
    () => null,
    (error: Error) => error,
  );
  fake.createMode = 'ok';
  check(
    'a 502 before the session is named is a clean failure',
    noSession !== null && /PaySasa did not answer clearly/.test(noSession.message),
    noSession?.message,
  );
  check('and the stock goes back at once', (await stockOf(first.id)) === stockBeforeDecline);

  await fill([[first, 1]]);
  fake.payMode = '502';
  const unclear = await start();
  fake.payMode = 'ok';
  const unclearPayment = await paymentOf(unclear.id);
  check(
    'a 502 on the prompt leaves the payment waiting, not cancelled',
    unclear.status === 'PROCESSING' && unclearPayment.status === 'PROCESSING',
  );
  check(
    'under the session id written before the prompt was asked for',
    typeof unclearPayment.providerRef === 'string' && fake.sessions.has(unclearPayment.providerRef),
    unclearPayment.providerRef,
  );
  check('and the stock stays held for it', (await stockOf(first.id)) === stockBeforeDecline - 1);
  await age(unclearPayment.id, 20_000);
  await sync.reconcile();
  check(
    'PaySasa still showing it pending keeps it waiting',
    (await paymentOf(unclear.id)).status === 'PROCESSING',
  );
  mark(unclearPayment.providerRef as string, 'paid');
  await sync.reconcile();
  check(
    'and when PaySasa shows it paid, the order is paid with no webhook at all',
    (await ordersOf(unclear.id)).every((order) => order.status === 'PAID'),
  );

  // ------------------------------------------------------------- double submit ---

  console.info('\nDouble submit');
  await fill([[second, 1]]);
  const paysBefore = fake.pays.length;
  const both = await Promise.allSettled([start(), start()]);
  check(
    'two taps on pay place one checkout',
    both.filter((entry) => entry.status === 'fulfilled').length === 1,
    both.map((entry) => (entry.status === 'fulfilled' ? 'ok' : (entry.reason as Error).message)),
  );
  check('and push one prompt', fake.pays.length === paysBefore + 1);

  const store = first.product.store;
  const boothKey = `booth-${randomUUID()}`;
  const booth = () =>
    app.services.checkout.startBooth({
      userId: buyer.id,
      slug: store.slug,
      items: [{ variantId: first.id, quantity: 1 }],
      payerPhone: '254712345678',
      idempotencyKey: boothKey,
    });
  const boothPaysBefore = fake.pays.length;
  const [boothA, boothB] = await Promise.all([booth(), booth()]);
  const boothC = await booth();
  check(
    'a booth retry with the same key gets the same checkout',
    boothA.id === boothB.id && boothB.id === boothC.id,
  );
  check(
    'and one prompt',
    fake.pays.length === boothPaysBefore + 1,
    fake.pays.length - boothPaysBefore,
  );

  // --------------------------------------------------------- seller cancel refund ---

  console.info('\nA shop cancels a paid order');
  const context = await app.auth.$context;
  const authSession = await context.internalAdapter.createSession(store.ownerId);
  const signature = createHmac('sha256', context.secret).update(authSession.token).digest('base64');
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${authSession.token}.${signature}`)}`;

  const toCancel = settled.find((order) => order.storeId === store.id);
  if (!toCancel) throw new Error('Expected an order from the first shop');
  const cancel = () =>
    app.inject({
      method: 'POST',
      url: `/v1/seller/orders/${toCancel.id}/action`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { action: 'cancel', reason: 'Sold out at the stand' },
    });
  const [cancelA, cancelB] = await Promise.all([cancel(), cancel()]);
  check(
    'two cancels at once: one goes through, one is told it moved on',
    [cancelA.statusCode, cancelB.statusCode].sort().join() === '200,409',
    [cancelA.statusCode, cancelB.statusCode],
  );
  const refundRows = await prisma.refund.findMany({ where: { orderId: toCancel.id } });
  check('one refund is recorded for that order total', refundRows.length === 1, refundRows.length);
  const refundRow = refundRows[0];
  check(
    'for the order total, linked to the payment',
    refundRow?.amountCents === toCancel.totalCents && refundRow.paymentId === happyPayment.id,
    refundRow,
  );
  check(
    'and marked for a person to send, since PaySasa has no refund API',
    refundRow?.status === 'PENDING' && refundRow.providerRef === BY_HAND,
    { status: refundRow?.status, ref: refundRow?.providerRef },
  );
  const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: toCancel.id } });
  check('the order reads cancelled meanwhile', cancelled.status === 'CANCELLED', cancelled.status);

  // -------------------------------------------------------------- cleaning up ---

  const groups = await prisma.checkoutGroup.findMany({
    where: { buyerId: buyer.id },
    select: { id: true },
  });
  const orderIds = (
    await prisma.order.findMany({ where: { buyerId: buyer.id }, select: { id: true } })
  ).map((order) => order.id);
  await prisma.sellerLedgerEntry.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.checkoutGroup.deleteMany({ where: { id: { in: groups.map((group) => group.id) } } });
  await prisma.webhookEvent.deleteMany({
    where: { provider: 'paysasa', receivedAt: { gte: startedAt } },
  });
  await prisma.session.deleteMany({ where: { token: authSession.token } });
  await prisma.cart.deleteMany({ where: { userId: buyer.id } });
  await prisma.user.delete({ where: { id: buyer.id } });
  await prisma.productVariant.update({
    where: { id: first.id },
    data: { stock: stockAtStart.first },
  });
  await prisma.productVariant.update({
    where: { id: second.id },
    data: { stock: stockAtStart.second },
  });
  await app.services.settings.update({ features: before.features }, 'test');

  await app.close();
  server.close();

  console.info(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('The PaySasa test could not run:', error);
  process.exit(1);
});
