/**
 * Paystack, end to end, against a fake Paystack started here.
 *
 *   pnpm --filter @nima/api test:paystack
 *
 * Runs against the development database and cleans up after itself. The fake
 * answers /charge, /transaction/verify, /refund the way the docs describe, on
 * 127.0.0.1, so no request leaves the machine and no shilling moves.
 *
 * What it proves: a webhook alone never pays anyone, a verify that disagrees
 * on amount credits nobody, repeats and races credit once, a stuck payment is
 * closed or confirmed without any webhook, money that arrives late goes back,
 * a double tap charges once, and a seller cancel sends the refund.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@nima/config';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from '../src/app.js';

loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

const SECRET = 'sk_test_fake_secret_for_local_tests';
const FAKE_PORT = 3979;

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

// ------------------------------------------------------------- fake paystack ---

interface VerifyState {
  status: string;
  amount?: number;
  currency?: string;
  reference?: string;
  gateway_response?: string;
}

const fake = {
  charges: [] as Array<Record<string, unknown>>,
  auth: new Set<string>(),
  chargeMode: 'ok' as 'ok' | 'fail' | '502',
  verify: new Map<string, VerifyState>(),
  ids: new Map<string, number>(),
  refunds: [] as Array<{ id: number; transaction: string; amount: number; status: string }>,
};

function txId(reference: string): number {
  if (!fake.ids.has(reference)) fake.ids.set(reference, 5_000_000 + fake.ids.size);
  return fake.ids.get(reference) as number;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
  });
}

function startFakePaystack(): Promise<Server> {
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${FAKE_PORT}`);
    const raw = await readBody(request);
    fake.auth.add(String(request.headers.authorization));

    if (request.method === 'POST' && url.pathname === '/charge') {
      const body = JSON.parse(raw) as { reference: string; amount: number };
      if (fake.chargeMode === '502') return send(502, {});
      if (fake.charges.some((entry) => entry.reference === body.reference)) {
        return send(400, { status: false, message: 'Duplicate Transaction Reference' });
      }
      fake.charges.push(body);
      if (fake.chargeMode === 'fail') {
        return send(200, {
          status: true,
          message: 'Charge attempted',
          data: { reference: body.reference, status: 'failed', message: 'Insufficient funds' },
        });
      }
      fake.verify.set(body.reference, { status: 'ongoing', amount: body.amount });
      return send(200, {
        status: true,
        message: 'Charge attempted',
        data: {
          reference: body.reference,
          status: 'pay_offline',
          display_text: 'Please complete authorization process on your mobile phone',
        },
      });
    }

    const verifyMatch = url.pathname.match(/^\/transaction\/verify\/(.+)$/);
    if (request.method === 'GET' && verifyMatch) {
      const reference = decodeURIComponent(verifyMatch[1] ?? '');
      const state = fake.verify.get(reference);
      if (!state) return send(400, { status: false, message: 'Transaction reference not found' });
      return send(200, {
        status: true,
        message: 'Verification successful',
        data: {
          id: txId(reference),
          domain: 'test',
          status: state.status,
          reference: state.reference ?? reference,
          amount: state.amount,
          currency: state.currency ?? 'KES',
          channel: 'mobile_money',
          gateway_response:
            state.gateway_response ?? (state.status === 'success' ? 'Approved' : null),
          customer: { phone: '+254712345678' },
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/refund') {
      const body = JSON.parse(raw) as { transaction: string; amount: number };
      const refund = {
        id: 900_000 + fake.refunds.length,
        transaction: body.transaction,
        amount: body.amount,
        status: 'pending',
      };
      fake.refunds.push(refund);
      return send(200, {
        status: true,
        message: 'Refund has been queued for processing',
        data: refund,
      });
    }

    const refundMatch = url.pathname.match(/^\/refund\/(\d+)$/);
    if (request.method === 'GET' && refundMatch) {
      const refund = fake.refunds.find((entry) => String(entry.id) === refundMatch[1]);
      return refund ? send(200, { status: true, data: refund }) : send(404, { status: false });
    }

    return send(404, { status: false, message: 'Not found' });
  });

  return new Promise((resolve) => server.listen(FAKE_PORT, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------- the test ---

async function main(): Promise<void> {
  console.info('Paystack, end to end, against a local fake\n');

  const server = await startFakePaystack();
  const startedAt = new Date();

  const app = await buildApp({
    env: loadEnv({
      reload: true,
      source: {
        ...process.env,
        PAYSTACK_SECRET_KEY: SECRET,
        PAYSTACK_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
        PAYMENT_RECONCILE_SECONDS: '0',
        FINGO_API_KEY: '',
        FINGO_WEBHOOK_SECRET: '',
        LOG_LEVEL: 'fatal',
      },
    }),
  });

  const { prisma } = app;
  const sync = app.services.paymentSync;
  check('Paystack is the gateway in use', app.services.payments.name === 'PAYSTACK');

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
      id: `paystest${run}`.padEnd(24, '0'),
      email: `paystack-${run}@example.com`,
      name: 'Paystack Test',
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
      recipientPhone: '254712345678',
      payerPhone: '254712345678',
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

  const webhook = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: '/webhooks/paystack',
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': signature ?? createHmac('sha512', SECRET).update(raw).digest('hex'),
      },
      payload: raw,
    });
  };
  const chargeSuccess = (reference: string, amount: number) =>
    webhook({
      event: 'charge.success',
      data: { id: txId(reference), reference, amount, currency: 'KES', status: 'success' },
    });

  // ---------------------------------------------------------- a clean payment ---

  console.info('A payment that goes through');
  await fill([
    [first, 2],
    [second, 1],
  ]);
  const happy = await start();
  const happyPayment = await paymentOf(happy.id);
  const sent = fake.charges.at(-1) as {
    amount: number;
    currency: string;
    email: string;
    reference: string;
    mobile_money: { phone: string; provider: string };
  };

  check(
    'the payment is waiting on the phone',
    happy.status === 'PROCESSING' && happyPayment.status === 'PROCESSING',
  );
  check('the payment is recorded against Paystack', happyPayment.provider === 'PAYSTACK');
  check(
    'the reference comes from the idempotency key',
    happyPayment.providerRef === `nima-${happyPayment.idempotencyKey}`,
  );
  check('Paystack was sent the same reference', sent.reference === happyPayment.providerRef, sent);
  check('the amount is sent in cents', sent.amount === happy.totalCents, sent);
  check('the currency is KES', sent.currency === 'KES');
  check(
    'the phone carries the country code',
    sent.mobile_money.phone === '+254712345678',
    sent.mobile_money,
  );
  check('the provider is M-Pesa', sent.mobile_money.provider === 'mpesa');
  check("the buyer's email is sent", sent.email === buyer.email);
  check('the secret key is sent as a bearer token', fake.auth.has(`Bearer ${SECRET}`));

  // The webhook arrives before Paystack has the result: nothing happens.
  const early = await chargeSuccess(happyPayment.providerRef as string, happy.totalCents);
  check('a webhook is answered 200', early.statusCode === 200, early.body);
  check(
    'a webhook alone pays nobody while verify still says ongoing',
    (await ordersOf(happy.id)).every((order) => order.status === 'PENDING_PAYMENT'),
  );

  fake.verify.set(happyPayment.providerRef as string, {
    status: 'success',
    amount: happy.totalCents,
  });
  const paid = await webhook({
    event: 'charge.success',
    data: {
      id: txId(happyPayment.providerRef as string) + 1,
      reference: happyPayment.providerRef,
      amount: happy.totalCents,
    },
  });
  check('the confirming webhook is answered 200', paid.statusCode === 200);
  const settled = await ordersOf(happy.id);
  check(
    'verified, every order is paid',
    settled.every((order) => order.status === 'PAID'),
    settled.map((o) => o.status),
  );
  check(
    'each shop gets exactly a sale and a fee',
    settled.every((order) => order.ledgerEntries.length === 2),
    settled.map((order) => order.ledgerEntries.length),
  );
  check(
    'the verify summary is kept, without the phone',
    !JSON.stringify((await paymentOf(happy.id)).raw).includes('12345678'),
  );

  // ------------------------------------------------------- repeats and forgeries ---

  console.info('\nRepeats, races and forgeries');
  for (let i = 0; i < 3; i += 1) {
    await webhook({
      event: 'charge.success',
      data: {
        id: txId(happyPayment.providerRef as string) + 1,
        reference: happyPayment.providerRef,
        amount: happy.totalCents,
      },
    });
  }
  const afterRepeat = await ordersOf(happy.id);
  check(
    'a repeated webhook pays nobody twice',
    afterRepeat.every((order) => order.ledgerEntries.length === 2),
  );
  const rows = await prisma.webhookEvent.count({
    where: {
      provider: 'paystack',
      externalId: `charge.success:${txId(happyPayment.providerRef as string) + 1}`,
    },
  });
  check('a repeated webhook is stored once', rows === 1, rows);

  await fill([[first, 1]]);
  const forgedCheckout = await start();
  const forgedPayment = await paymentOf(forgedCheckout.id);
  fake.verify.set(forgedPayment.providerRef as string, {
    status: 'ongoing',
    amount: forgedCheckout.totalCents,
  });
  const forged = await webhook(
    {
      event: 'charge.success',
      data: { id: 1, reference: forgedPayment.providerRef, amount: forgedCheckout.totalCents },
    },
    'ab'.repeat(64),
  );
  check('a forged webhook is answered 200', forged.statusCode === 200);
  check(
    'a forged webhook changes nothing',
    (await paymentOf(forgedCheckout.id)).status === 'PROCESSING',
  );

  // Webhook, reconcile and a polling screen, all at once.
  fake.verify.set(forgedPayment.providerRef as string, {
    status: 'success',
    amount: forgedCheckout.totalCents,
  });
  await age(forgedPayment.id, 20_000);
  await Promise.allSettled([
    chargeSuccess(forgedPayment.providerRef as string, forgedCheckout.totalCents),
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

  // ------------------------------------------------------------ verify disagrees ---

  console.info('\nVerify disagrees with the order');
  await fill([[first, 1]]);
  const short = await start();
  const shortPayment = await paymentOf(short.id);
  const firstStockHeld = await stockOf(first.id);
  fake.verify.set(shortPayment.providerRef as string, {
    status: 'success',
    amount: short.totalCents - 100,
  });
  await chargeSuccess(shortPayment.providerRef as string, short.totalCents);
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
  fake.verify.set(usdPayment.providerRef as string, {
    status: 'success',
    amount: usd.totalCents,
    currency: 'USD',
  });
  await chargeSuccess(usdPayment.providerRef as string, usd.totalCents);
  check(
    'the right number in the wrong currency credits nobody',
    (await ordersOf(usd.id)).every(
      (order) => order.status === 'CANCELLED' && order.ledgerEntries.length === 0,
    ),
  );

  await fill([[first, 1]]);
  const other = await start();
  const otherPayment = await paymentOf(other.id);
  fake.verify.set(otherPayment.providerRef as string, {
    status: 'success',
    amount: other.totalCents,
    reference: 'nima-someone-else',
  });
  await chargeSuccess(otherPayment.providerRef as string, other.totalCents);
  check(
    'a verify answer for a different reference credits nobody',
    (await ordersOf(other.id)).every((order) => order.status === 'PENDING_PAYMENT'),
  );
  fake.verify.set(otherPayment.providerRef as string, {
    status: 'failed',
    amount: other.totalCents,
  });
  await sync.confirm(otherPayment.providerRef as string, 'reconcile');

  const stranger = await chargeSuccess('T_not_ours_123', 1000);
  check('a reference that is not ours is ignored politely', stranger.statusCode === 200);

  // ----------------------------------------------------- stuck, no webhook ever ---

  console.info('\nNo webhook ever comes');
  await fill([[second, 1]]);
  const broke = await start();
  const brokePayment = await paymentOf(broke.id);
  const secondHeld = await stockOf(second.id);
  fake.verify.set(brokePayment.providerRef as string, {
    status: 'failed',
    amount: broke.totalCents,
    gateway_response: 'Insufficient funds',
  });
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
  fake.verify.set(quietPayment.providerRef as string, {
    status: 'success',
    amount: quiet.totalCents,
  });
  await age(quietPayment.id, 20_000);
  await sync.refreshCheckout(quiet.id);
  check(
    'a polling screen confirms a payment whose webhook never came',
    (await ordersOf(quiet.id)).every(
      (order) => order.status === 'PAID' && order.ledgerEntries.length === 2,
    ),
  );
  await chargeSuccess(quietPayment.providerRef as string, quiet.totalCents);
  check(
    'the late webhook after that pays nobody twice',
    (await ordersOf(quiet.id)).every((order) => order.ledgerEntries.length === 2),
  );

  // ------------------------------------------------- timed out, then paid late ---

  console.info('\nTimed out, then the money arrives');
  await fill([
    [first, 1],
    [second, 1],
  ]);
  const late = await start();
  const latePayment = await paymentOf(late.id);
  fake.verify.set(latePayment.providerRef as string, {
    status: 'abandoned',
    amount: late.totalCents,
  });
  await age(latePayment.id, 60_000);
  await sync.reconcile();
  check(
    'abandoned inside the prompt window still waits',
    (await paymentOf(late.id)).status === 'PROCESSING',
  );
  await age(latePayment.id, 5 * 60_000);
  await sync.reconcile();
  const timedOut = await paymentOf(late.id);
  check('abandoned after the window is closed', timedOut.status === 'FAILED');
  check(
    'with the timeout message',
    (timedOut.failureReason ?? '').includes('timed out'),
    timedOut.failureReason,
  );

  const refundsBefore = fake.refunds.length;
  fake.verify.set(latePayment.providerRef as string, {
    status: 'success',
    amount: late.totalCents,
  });
  await chargeSuccess(latePayment.providerRef as string, late.totalCents);
  await chargeSuccess(latePayment.providerRef as string, late.totalCents);
  const lateRefunds = fake.refunds.slice(refundsBefore);
  check(
    'money that lands on a closed checkout is sent back',
    (await paymentOf(late.id)).status === 'REFUNDED',
  );
  check(
    'in full, once, across both shops',
    lateRefunds.length === 2 &&
      lateRefunds.reduce((sum, entry) => sum + entry.amount, 0) === late.totalCents,
    lateRefunds,
  );
  check(
    'and nobody is credited for it',
    (await ordersOf(late.id)).every((order) => order.ledgerEntries.length === 0),
  );

  // --------------------------------------------------------- refused at charge ---

  console.info('\nRefused, or no clear answer, at the charge');
  await fill([[first, 1]]);
  const stockBeforeDecline = await stockOf(first.id);
  fake.chargeMode = 'fail';
  const declined = await start().then(
    () => null,
    (error: Error) => error,
  );
  fake.chargeMode = 'ok';
  check(
    'a refused charge is an error the buyer can read',
    declined?.message.startsWith('There was not enough') === true,
    declined?.message,
  );
  check('and the stock goes back at once', (await stockOf(first.id)) === stockBeforeDecline);

  await fill([[first, 1]]);
  fake.chargeMode = '502';
  const unclear = await start();
  fake.chargeMode = 'ok';
  const unclearPayment = await paymentOf(unclear.id);
  check(
    'a 502 on the charge leaves the payment waiting, not cancelled',
    unclear.status === 'PROCESSING' && unclearPayment.status === 'PROCESSING',
  );
  check('and the stock stays held for it', (await stockOf(first.id)) === stockBeforeDecline - 1);
  await age(unclearPayment.id, 20_000);
  await sync.reconcile();
  check(
    'Paystack not knowing it yet still waits',
    (await paymentOf(unclear.id)).status === 'PROCESSING',
  );
  await age(unclearPayment.id, 5 * 60_000);
  await sync.reconcile();
  check(
    'a charge Paystack never heard of is closed after the window',
    (await paymentOf(unclear.id)).status === 'FAILED',
  );
  check('and the stock goes back', (await stockOf(first.id)) === stockBeforeDecline);

  // ------------------------------------------------------------- double submit ---

  console.info('\nDouble submit');
  await fill([[second, 1]]);
  const chargesBefore = fake.charges.length;
  const both = await Promise.allSettled([start(), start()]);
  check(
    'two taps on pay place one checkout',
    both.filter((entry) => entry.status === 'fulfilled').length === 1,
    both.map((entry) => (entry.status === 'fulfilled' ? 'ok' : (entry.reason as Error).message)),
  );
  check('and send one prompt', fake.charges.length === chargesBefore + 1);

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
  const boothChargesBefore = fake.charges.length;
  const [boothA, boothB] = await Promise.all([booth(), booth()]);
  const boothC = await booth();
  check(
    'a booth retry with the same key gets the same checkout',
    boothA.id === boothB.id && boothB.id === boothC.id,
  );
  check(
    'and one prompt',
    fake.charges.length === boothChargesBefore + 1,
    fake.charges.length - boothChargesBefore,
  );

  // --------------------------------------------------------- seller cancel refund ---

  console.info('\nA shop cancels a paid order');
  const context = await app.auth.$context;
  const session = await context.internalAdapter.createSession(store.ownerId);
  const signature = createHmac('sha256', context.secret).update(session.token).digest('base64');
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;

  const toCancel = settled.find((order) => order.storeId === store.id);
  if (!toCancel) throw new Error('Expected an order from the first shop');
  const refundCount = fake.refunds.length;
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
  const sentRefund = fake.refunds.slice(refundCount);
  check(
    'one refund is sent to Paystack for that order total',
    sentRefund.length === 1 &&
      sentRefund[0]?.amount === toCancel.totalCents &&
      sentRefund[0]?.transaction === happyPayment.providerRef,
    sentRefund,
  );
  const refundRow = await prisma.refund.findFirstOrThrow({ where: { orderId: toCancel.id } });
  check(
    'the refund is linked to the payment and Paystack id',
    refundRow.paymentId === happyPayment.id && refundRow.providerRef === String(sentRefund[0]?.id),
  );
  check('and waits for Paystack to finish it', refundRow.status === 'PROCESSING');

  // A refund webhook before Paystack's record says processed changes nothing.
  await webhook({
    event: 'refund.processed',
    data: {
      status: 'processed',
      transaction_reference: happyPayment.providerRef,
      amount: String(toCancel.totalCents),
    },
  });
  check(
    'a refund webhook alone is not trusted',
    (await prisma.refund.findUniqueOrThrow({ where: { id: refundRow.id } })).status ===
      'PROCESSING',
  );

  const theirs = fake.refunds.find((entry) => entry.id === sentRefund[0]?.id);
  if (theirs) theirs.status = 'processed';
  await webhook({
    event: 'refund.processed',
    data: {
      status: 'processed',
      transaction_reference: happyPayment.providerRef,
      amount: String(toCancel.totalCents),
      currency: 'KES',
    },
  });
  const refundDone = await prisma.refund.findUniqueOrThrow({
    where: { id: refundRow.id },
    include: { order: true },
  });
  check(
    'once Paystack says processed, the refund is done',
    refundDone.status === 'SUCCEEDED' && refundDone.completedAt !== null,
  );
  check(
    'and the order reads refunded',
    refundDone.order.status === 'REFUNDED',
    refundDone.order.status,
  );

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
    where: { provider: 'paystack', receivedAt: { gte: startedAt } },
  });
  await prisma.session.deleteMany({ where: { token: session.token } });
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
  console.error('The Paystack test could not run:', error);
  process.exit(1);
});
