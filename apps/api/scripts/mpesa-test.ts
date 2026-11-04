/**
 * M-Pesa, end to end, against a fake Safaricom started here.
 *
 *   pnpm --filter @nima/api test:mpesa
 *
 * Runs against the development database and cleans up after itself. The fake
 * answers the OAuth, STK push and STK query endpoints the way Daraja does,
 * on 127.0.0.1, so no request leaves the machine and no shilling moves.
 *
 * What it proves: a callback alone never pays anyone, a callback whose amount
 * disagrees credits nobody, repeats and races credit once, a stuck payment is
 * closed or confirmed with no callback at all, money that arrives late is
 * recorded for a refund by hand, a double tap pushes one prompt, a busy phone
 * is a clear no, a callback without the token is dropped, and a seller cancel
 * records the refund for a person to send.
 */

import { randomUUID } from 'node:crypto';
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

const CONSUMER_KEY = 'ck_placeholder_local';
const CONSUMER_SECRET = 'cs_placeholder_local';
const SHORTCODE = '174379';
const TILL = '5555555';
const PASSKEY = 'passkey_placeholder';
const CALLBACK_TOKEN = 'cbtoken_placeholder_local';
const FAKE_PORT = 3983;

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

// -------------------------------------------------------------- fake daraja ---

interface FakeRequest {
  checkoutRequestId: string;
  amount: number;
  phone: string;
  /** null while pending; a ResultCode once settled */
  resultCode: string | null;
  resultDesc: string;
}

const fake = {
  requests: new Map<string, FakeRequest>(),
  pushes: [] as Array<Record<string, unknown>>,
  tokens: 0,
  bearers: new Set<string>(),
  pushMode: 'ok' as 'ok' | 'busy' | '502',
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

function startFakeDaraja(): Promise<Server> {
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${FAKE_PORT}`);
    const raw = await readBody(request);

    if (request.method === 'GET' && url.pathname === '/oauth/v1/generate') {
      const basic = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
      if (request.headers.authorization !== `Basic ${basic}`) {
        return send(400, {
          errorCode: '400.008.01',
          errorMessage: 'Invalid Authentication passed',
        });
      }
      fake.tokens += 1;
      return send(200, { access_token: `tok_${fake.tokens}`, expires_in: '3599' });
    }

    fake.bearers.add(String(request.headers.authorization));

    if (request.method === 'POST' && url.pathname === '/mpesa/stkpush/v1/processrequest') {
      if (fake.pushMode === '502') return send(502, {});
      const body = JSON.parse(raw) as Record<string, unknown>;
      fake.pushes.push(body);
      if (fake.pushMode === 'busy') {
        return send(500, {
          requestId: randomUUID(),
          errorCode: '500.001.1001',
          errorMessage:
            'Unable to lock subscriber, a transaction is already in process for the current subscriber',
        });
      }
      const checkoutRequestId = `ws_CO_${Date.now()}${fake.requests.size}`;
      fake.requests.set(checkoutRequestId, {
        checkoutRequestId,
        amount: Number(body.Amount),
        phone: String(body.PhoneNumber),
        resultCode: null,
        resultDesc: 'The transaction is being processed',
      });
      return send(200, {
        MerchantRequestID: `${fake.requests.size}-1`,
        CheckoutRequestID: checkoutRequestId,
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing',
        CustomerMessage: 'Success. Request accepted for processing',
      });
    }

    if (request.method === 'POST' && url.pathname === '/mpesa/stkpushquery/v1/query') {
      const body = JSON.parse(raw) as { CheckoutRequestID: string };
      const entry = fake.requests.get(body.CheckoutRequestID);
      if (!entry || fake.forgotten.has(body.CheckoutRequestID)) {
        return send(400, {
          requestId: randomUUID(),
          errorCode: '400.002.02',
          errorMessage: 'Bad Request - Invalid CheckoutRequestID',
        });
      }
      if (entry.resultCode === null) {
        return send(500, {
          requestId: randomUUID(),
          errorCode: '500.001.1001',
          errorMessage: 'The transaction is being processed',
        });
      }
      return send(200, {
        ResponseCode: '0',
        ResponseDescription: 'The service request has been accepted successsfully',
        MerchantRequestID: '1-1',
        CheckoutRequestID: entry.checkoutRequestId,
        ResultCode: entry.resultCode,
        ResultDesc: entry.resultDesc,
      });
    }

    return send(404, { errorMessage: 'Not found' });
  });

  return new Promise((resolve) => server.listen(FAKE_PORT, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------- the test ---

async function main(): Promise<void> {
  console.info('M-Pesa, end to end, against a local fake Safaricom\n');

  const server = await startFakeDaraja();
  const startedAt = new Date();

  const app = await buildApp({
    env: loadEnv({
      reload: true,
      source: {
        ...process.env,
        MPESA_CONSUMER_KEY: CONSUMER_KEY,
        MPESA_CONSUMER_SECRET: CONSUMER_SECRET,
        MPESA_SHORTCODE: SHORTCODE,
        MPESA_TILL: TILL,
        MPESA_PASSKEY: PASSKEY,
        MPESA_CALLBACK_TOKEN: CALLBACK_TOKEN,
        MPESA_ENV: 'sandbox',
        MPESA_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
        PAYSASA_API_KEY: '',
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
  check('M-Pesa is the gateway in use', app.services.payments.name === 'MPESA');

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
      id: `mpesatest${run}`.padEnd(24, '0'),
      email: `mpesa-${run}@example.com`,
      name: 'M-Pesa Test',
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
  const settle = (id: string, resultCode: string, resultDesc: string) => {
    const entry = fake.requests.get(id);
    if (!entry) throw new Error(`The fake has no request ${id}`);
    entry.resultCode = resultCode;
    entry.resultDesc = resultDesc;
    return entry;
  };
  const paidAt = (id: string) => settle(id, '0', 'The service request is processed successfully.');

  const callback = (body: unknown, token: string = CALLBACK_TOKEN) =>
    app.inject({
      method: 'POST',
      url: `/webhooks/till/${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
  const paidCallback = (id: string, amountShillings: number, token?: string) =>
    callback(
      {
        Body: {
          stkCallback: {
            MerchantRequestID: '1-1',
            CheckoutRequestID: id,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: amountShillings },
                { Name: 'MpesaReceiptNumber', Value: `RCT${id.slice(-6)}` },
                { Name: 'TransactionDate', Value: 20261104120000 },
                { Name: 'PhoneNumber', Value: 254712345678 },
              ],
            },
          },
        },
      },
      token,
    );
  const failedCallback = (id: string, code: number, desc: string) =>
    callback({
      Body: {
        stkCallback: {
          MerchantRequestID: '1-1',
          CheckoutRequestID: id,
          ResultCode: code,
          ResultDesc: desc,
        },
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
  const pushed = fake.pushes.at(-1) as Record<string, unknown>;

  check(
    'the payment is waiting on the phone',
    happy.status === 'PROCESSING' && happyPayment.status === 'PROCESSING',
  );
  check('the payment is recorded against M-Pesa', happyPayment.provider === 'MPESA');
  check(
    'the CheckoutRequestID is the reference on the payment',
    typeof happyPayment.providerRef === 'string' && fake.requests.has(happyPayment.providerRef),
    happyPayment.providerRef,
  );
  check('the amount is sent in whole shillings', pushed.Amount === happy.totalCents / 100, pushed);
  check(
    'it is a Buy Goods push to the Till',
    pushed.TransactionType === 'CustomerBuyGoodsOnline' && pushed.PartyB === TILL,
  );
  check('under the store number', pushed.BusinessShortCode === SHORTCODE);
  check(
    'to the phone in 254 form',
    pushed.PhoneNumber === '254712345678' && pushed.PartyA === '254712345678',
  );
  check(
    'the callback URL carries the token',
    String(pushed.CallBackURL).endsWith(`/webhooks/till/${CALLBACK_TOKEN}`),
    pushed.CallBackURL,
  );
  check(
    'the account reference fits in twelve characters',
    String(pushed.AccountReference).length <= 12,
  );
  check(
    'one sign in so far, used as a bearer token',
    fake.tokens === 1 && fake.bearers.has('Bearer tok_1'),
  );

  // The callback arrives before the query shows it paid: nothing happens.
  const early = await paidCallback(happyPayment.providerRef as string, happy.totalCents / 100);
  check(
    'a callback is answered the way Safaricom expects',
    early.statusCode === 200 && early.json().ResultCode === 0,
    early.body,
  );
  check(
    'a callback alone pays nobody while the query still says processing',
    (await ordersOf(happy.id)).every((order) => order.status === 'PENDING_PAYMENT'),
  );

  paidAt(happyPayment.providerRef as string);
  const paid = await paidCallback(happyPayment.providerRef as string, happy.totalCents / 100);
  check('the confirming callback is answered 200', paid.statusCode === 200);
  const settled = await ordersOf(happy.id);
  check(
    'queried as paid, every order is paid',
    settled.every((order) => order.status === 'PAID'),
    settled.map((o) => o.status),
  );
  check(
    'each shop gets exactly a sale and a fee',
    settled.every((order) => order.ledgerEntries.length === 2),
    settled.map((order) => order.ledgerEntries.length),
  );
  const happyRaw = JSON.stringify((await paymentOf(happy.id)).raw);
  check(
    'the receipt is kept, the phone is not',
    happyRaw.includes('RCT') && !happyRaw.includes('12345678'),
    happyRaw,
  );

  // ------------------------------------------------------- repeats and forgeries ---

  console.info('\nRepeats, races and forgeries');
  for (let i = 0; i < 3; i += 1) {
    await paidCallback(happyPayment.providerRef as string, happy.totalCents / 100);
  }
  check(
    'a repeated callback pays nobody twice',
    (await ordersOf(happy.id)).every((order) => order.ledgerEntries.length === 2),
  );
  const rows = await prisma.webhookEvent.count({
    where: { provider: 'mpesa', externalId: `${happyPayment.providerRef}:0` },
  });
  check('a repeated callback is stored once', rows === 1, rows);
  const stored = await prisma.webhookEvent.findFirst({
    where: { provider: 'mpesa', externalId: `${happyPayment.providerRef}:0` },
  });
  check(
    'the stored callback has the phone masked',
    !JSON.stringify(stored?.payload).includes('254712345678'),
  );

  await fill([[first, 1]]);
  const forgedCheckout = await start();
  const forgedPayment = await paymentOf(forgedCheckout.id);
  paidAt(forgedPayment.providerRef as string);
  const forged = await paidCallback(
    forgedPayment.providerRef as string,
    forgedCheckout.totalCents / 100,
    'not-the-token',
  );
  check('a callback without the token is answered 200', forged.statusCode === 200);
  check(
    'and changes nothing, even though the query would say paid',
    (await paymentOf(forgedCheckout.id)).status === 'PROCESSING',
  );
  const badRows = await prisma.webhookEvent.count({
    where: { provider: 'mpesa', signatureOk: false, receivedAt: { gte: startedAt } },
  });
  check('and is written down as unsigned', badRows >= 1, badRows);

  // Callback, reconcile and a polling screen, all at once.
  await age(forgedPayment.id, 20_000);
  await Promise.allSettled([
    paidCallback(forgedPayment.providerRef as string, forgedCheckout.totalCents / 100),
    sync.reconcile(),
    sync.confirm(forgedPayment.providerRef as string, 'poll'),
    sync.confirm(forgedPayment.providerRef as string, 'reconcile'),
  ]);
  const raced = await ordersOf(forgedCheckout.id);
  check(
    'callback, reconcile and poll together credit once',
    raced.every((order) => order.status === 'PAID' && order.ledgerEntries.length === 2),
    raced.map((order) => ({ status: order.status, ledger: order.ledgerEntries.length })),
  );

  // ------------------------------------------------------- the callback disagrees ---

  console.info('\nThe callback disagrees with the order');
  await fill([[first, 1]]);
  const short = await start();
  const shortPayment = await paymentOf(short.id);
  const firstStockHeld = await stockOf(first.id);
  paidAt(shortPayment.providerRef as string);
  await paidCallback(shortPayment.providerRef as string, short.totalCents / 100 - 1);
  const shortOrders = await ordersOf(short.id);
  check(
    'a callback amount that does not match credits nobody',
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
  const other = await start();
  const otherPayment = await paymentOf(other.id);
  const otherEntry = paidAt(otherPayment.providerRef as string);
  otherEntry.checkoutRequestId = 'ws_CO_someone_else';
  await paidCallback(otherPayment.providerRef as string, other.totalCents / 100);
  check(
    'a query that answers about a different request credits nobody',
    (await ordersOf(other.id)).every((order) => order.status === 'PENDING_PAYMENT'),
  );
  otherEntry.checkoutRequestId = otherPayment.providerRef as string;
  settle(otherPayment.providerRef as string, '1032', 'Request cancelled by user');
  await sync.confirm(otherPayment.providerRef as string, 'reconcile');

  const stranger = await paidCallback('ws_CO_not_ours_123', 10);
  check('a request that is not ours is ignored politely', stranger.statusCode === 200);

  // ----------------------------------------------------- stuck, no callback ever ---

  console.info('\nNo callback ever comes');
  await fill([[second, 1]]);
  const broke = await start();
  const brokePayment = await paymentOf(broke.id);
  const secondHeld = await stockOf(second.id);
  settle(
    brokePayment.providerRef as string,
    '1',
    'The balance is insufficient for the transaction',
  );
  await sync.reconcile();
  check(
    'a payment younger than ten seconds is left alone',
    (await paymentOf(broke.id)).status === 'PROCESSING',
  );
  await age(brokePayment.id, 20_000);
  await sync.reconcile();
  const brokeAfter = await paymentOf(broke.id);
  check(
    'reconcile closes a failed payment with no callback',
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
  paidAt(quietPayment.providerRef as string);
  await age(quietPayment.id, 20_000);
  await sync.refreshCheckout(quiet.id);
  check(
    'a polling screen confirms a payment whose callback never came',
    (await ordersOf(quiet.id)).every(
      (order) => order.status === 'PAID' && order.ledgerEntries.length === 2,
    ),
  );
  await paidCallback(quietPayment.providerRef as string, quiet.totalCents / 100);
  check(
    'the late callback after that pays nobody twice',
    (await ordersOf(quiet.id)).every((order) => order.ledgerEntries.length === 2),
  );

  await fill([[second, 1]]);
  const pending = await start();
  const pendingPayment = await paymentOf(pending.id);
  await age(pendingPayment.id, 5 * 60_000);
  await sync.reconcile();
  check(
    'still being processed after five minutes keeps waiting',
    (await paymentOf(pending.id)).status === 'PROCESSING',
  );
  await age(pendingPayment.id, 16 * 60_000);
  await sync.reconcile();
  const givenUp = await paymentOf(pending.id);
  check('and is closed after fifteen', givenUp.status === 'FAILED', givenUp.status);

  // ------------------------------------------------- unreachable, then paid late ---

  console.info('\nThe phone could not be reached, then the money arrives');
  await fill([
    [first, 1],
    [second, 1],
  ]);
  const late = await start();
  const latePayment = await paymentOf(late.id);
  const unreachable = await failedCallback(
    latePayment.providerRef as string,
    1037,
    'DS timeout user cannot be reached',
  );
  check('a failed callback is taken in', unreachable.statusCode === 200);
  check(
    'but the query still deciding keeps it waiting',
    (await paymentOf(late.id)).status === 'PROCESSING',
  );
  settle(latePayment.providerRef as string, '1037', 'DS timeout user cannot be reached');
  await age(latePayment.id, 20_000);
  await sync.reconcile();
  const timedOut = await paymentOf(late.id);
  check('once the query agrees, it is closed', timedOut.status === 'FAILED');
  check(
    'with words about the phone',
    (timedOut.failureReason ?? '').includes('could not be reached'),
    timedOut.failureReason,
  );

  paidAt(latePayment.providerRef as string);
  await paidCallback(latePayment.providerRef as string, late.totalCents / 100);
  await paidCallback(latePayment.providerRef as string, late.totalCents / 100);
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

  // ----------------------------------------------- the request never existed ---

  console.info('\nSafaricom forgets a request');
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

  // --------------------------------------------------------- refused at the push ---

  console.info('\nRefused, or no clear answer, at the push');
  await fill([[first, 1]]);
  const stockBeforeDecline = await stockOf(first.id);
  fake.pushMode = 'busy';
  const busy = await start().then(
    () => null,
    (error: Error) => error,
  );
  fake.pushMode = 'ok';
  check(
    'a busy phone is an error the buyer can read',
    busy?.message.includes('still busy') === true,
    busy?.message,
  );
  check('and the stock goes back at once', (await stockOf(first.id)) === stockBeforeDecline);

  await fill([[first, 1]]);
  fake.pushMode = '502';
  const down = await start().then(
    () => null,
    (error: Error) => error,
  );
  fake.pushMode = 'ok';
  check(
    'Safaricom down is a clean failure',
    down !== null && /not answering/.test(down.message),
    down?.message,
  );
  check('and the stock goes back at once', (await stockOf(first.id)) === stockBeforeDecline);

  // ------------------------------------------------------------- double submit ---

  console.info('\nDouble submit');
  await fill([[second, 1]]);
  const pushesBefore = fake.pushes.length;
  const both = await Promise.allSettled([start(), start()]);
  check(
    'two taps on pay place one checkout',
    both.filter((entry) => entry.status === 'fulfilled').length === 1,
    both.map((entry) => (entry.status === 'fulfilled' ? 'ok' : (entry.reason as Error).message)),
  );
  check('and push one prompt', fake.pushes.length === pushesBefore + 1);

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
  const boothPushesBefore = fake.pushes.length;
  const [boothA, boothB] = await Promise.all([booth(), booth()]);
  const boothC = await booth();
  check(
    'a booth retry with the same key gets the same checkout',
    boothA.id === boothB.id && boothB.id === boothC.id,
  );
  check(
    'and one prompt',
    fake.pushes.length === boothPushesBefore + 1,
    fake.pushes.length - boothPushesBefore,
  );
  check('and still only one sign in to Safaricom', fake.tokens === 1, fake.tokens);

  // --------------------------------------------------------- seller cancel refund ---

  console.info('\nA shop cancels a paid order');
  const context = await app.auth.$context;
  const authSession = await context.internalAdapter.createSession(store.ownerId);
  const { createHmac } = await import('node:crypto');
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
  check('one refund is recorded for that order', refundRows.length === 1, refundRows.length);
  const refundRow = refundRows[0];
  check(
    'for the order total, linked to the payment',
    refundRow?.amountCents === toCancel.totalCents && refundRow.paymentId === happyPayment.id,
    refundRow,
  );
  check(
    'and marked for a person to send',
    refundRow?.status === 'PENDING' && refundRow.providerRef === BY_HAND,
    { status: refundRow?.status, ref: refundRow?.providerRef },
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
    where: { provider: 'mpesa', receivedAt: { gte: startedAt } },
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
  console.error('The M-Pesa test could not run:', error);
  process.exit(1);
});
