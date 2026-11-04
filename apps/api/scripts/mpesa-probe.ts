/**
 * One real STK push against whatever M-Pesa environment .env points at, then
 * the query until it settles. No database, no checkout: just the gateway.
 *
 *   pnpm --filter @nima/api probe:mpesa [phone] [shillings]
 *
 * On the sandbox the push goes to Safaricom's test number unless a phone is
 * given, and nothing is charged. On production this moves real money, so the
 * amount defaults to KSh 1 and the script says which environment it is on
 * before it does anything.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@nima/config';
import { config as loadDotenv } from 'dotenv';
import { canVerify, createPaymentGateway } from '../src/services/payments/index.js';

loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
  quiet: true,
});

const SANDBOX_TEST_NUMBER = '254708374149';

async function main(): Promise<void> {
  const env = loadEnv({ reload: true });
  const gateway = createPaymentGateway(env);

  if (gateway.name !== 'MPESA' || !canVerify(gateway)) {
    console.error(`The gateway in use is ${gateway.name}. Set the MPESA_ variables in .env first.`);
    process.exit(1);
  }

  const phone = process.argv[2] ?? (gateway.live ? '' : SANDBOX_TEST_NUMBER);
  const shillings = Number(process.argv[3] ?? 1);
  if (!phone) {
    console.error('On production a phone number must be given explicitly.');
    process.exit(1);
  }

  console.info(
    `${gateway.live ? 'PRODUCTION: real money' : 'Sandbox: no money moves'}. ` +
      `Pushing KSh ${shillings} to ${phone} via ${env.MPESA_TILL ? `Till ${env.MPESA_TILL}` : `shortcode ${env.MPESA_SHORTCODE}`}.\n`,
  );

  const started = Date.now();
  const result = await gateway.charge({
    amountCents: Math.round(shillings * 100),
    phone,
    reference: 'NIMA PROBE',
    description: 'Nima probe',
    idempotencyKey: `probe-${started}`,
    callbackUrl: `${env.API_URL}/webhooks/till`,
  });
  console.info('push  ', result);
  if (result.status !== 'PROCESSING') process.exit(1);

  for (let i = 0; i < 18; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const verified = await gateway.verify(result.providerRef);
      console.info(
        `query ${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s `,
        verified.state,
        verified.raw?.resultCode ?? '',
        verified.raw?.resultDesc ?? '',
        verified.failureReason ?? '',
      );
      if (verified.state !== 'PENDING') break;
    } catch (error) {
      console.info(
        `query ${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s `,
        'no answer:',
        (error as Error).message,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error('The probe could not run:', error);
  process.exit(1);
});
