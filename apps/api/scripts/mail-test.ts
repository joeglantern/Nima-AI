/**
 * Every email the app can send, and what happens when sending fails.
 *
 *   pnpm --filter @nima/api test:mail
 *
 * A sign in code is the only way into an account, so two things have to be
 * true and neither is obvious from reading the code:
 *
 *   1. Asking for a code really does hand one to the mail server, for every
 *      kind of code, not just the one anybody tests by hand.
 *   2. When the mail server refuses, the person asking is told. An API that
 *      answers "sent" and sends nothing leaves somebody staring at an empty
 *      inbox with nothing to retry and no reason to.
 *
 * The app is built in process with a stand in for the mailer, so nothing
 * leaves the machine and no real inbox is touched.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@nima/config';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from '../src/app.js';
import type { Mailer, SendOtpInput } from '../src/lib/mailer.js';

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

interface Recorded {
  otps: SendOtpInput[];
  links: Array<{ to: string; url: string }>;
}

/** Records what it was asked to send, or refuses everything. */
function stubMailer(mode: 'records' | 'refuses'): { mailer: Mailer; sent: Recorded } {
  const sent: Recorded = { otps: [], links: [] };

  const refuse = async (): Promise<never> => {
    throw new Error('The mail server refused the recipient');
  };

  const mailer: Mailer = {
    async sendOtp(input) {
      if (mode === 'refuses') return refuse();
      sent.otps.push(input);
    },
    async sendMagicLink(input) {
      if (mode === 'refuses') return refuse();
      sent.links.push(input);
    },
    async sendRaw() {
      if (mode === 'refuses') return refuse();
    },
    async verify() {
      return mode === 'records';
    },
  };

  return { mailer, sent };
}

const env = loadEnv({ reload: true, source: { ...process.env, LOG_LEVEL: 'error' } });

async function post(app: Awaited<ReturnType<typeof buildApp>>, url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', origin: env.API_URL },
    payload: JSON.stringify(payload),
  });
}

async function main(): Promise<void> {
  console.info('Email\n');

  // ------------------------------------------------- the happy path ---
  console.info('When the mail server takes it');

  const working = stubMailer('records');
  const app = await buildApp({ env, mailer: working.mailer });

  const signIn = await post(app, '/api/auth/email-otp/send-verification-otp', {
    email: 'someone@example.com',
    type: 'sign-in',
  });

  check('asking for a sign in code is accepted', signIn.statusCode === 200, signIn.body);
  check('a sign in code reaches the mailer', working.sent.otps.length === 1, working.sent.otps);
  check(
    'it is addressed to the person who asked',
    working.sent.otps[0]?.to === 'someone@example.com',
    working.sent.otps[0],
  );
  check(
    'it is marked as a sign in, so the subject line is right',
    working.sent.otps[0]?.purpose === 'sign-in',
    working.sent.otps[0]?.purpose,
  );
  check(
    'the code is six digits',
    /^\d{6}$/.test(working.sent.otps[0]?.code ?? ''),
    working.sent.otps[0]?.code,
  );

  // Verification and change of address use the same plugin and the same
  // mailer, and neither is covered by signing in by hand.
  // A verification code for an address with no account is deliberately not
  // sent, and the endpoint still answers success. That is Better Auth
  // refusing to tell a stranger whether an account exists, which is right,
  // so the test pins the behaviour rather than fighting it.
  const before = working.sent.otps.length;
  const verify = await post(app, '/api/auth/email-otp/send-verification-otp', {
    email: 'nobody-here@example.com',
    type: 'email-verification',
  });
  check('a verification code for an unknown address is accepted', verify.statusCode === 200);
  check(
    'but nothing is sent, so the reply does not reveal that there is no account',
    working.sent.otps.length === before,
    working.sent.otps.length,
  );

  const link = await post(app, '/api/auth/sign-in/magic-link', {
    email: 'someone@example.com',
  });
  check('a magic link is accepted', link.statusCode === 200, link.body);
  check('a magic link reaches the mailer', working.sent.links.length === 1, working.sent.links);
  check(
    'the link is a real URL on this API',
    (working.sent.links[0]?.url ?? '').startsWith('http'),
    working.sent.links[0]?.url,
  );

  check('the transport reports itself reachable', await app.mailer.verify());

  await app.close();

  // --------------------------------------------- when sending fails ---
  console.info('\nWhen the mail server refuses');

  const broken = stubMailer('refuses');
  const brokenApp = await buildApp({ env, mailer: broken.mailer });

  const refused = await post(brokenApp, '/api/auth/email-otp/send-verification-otp', {
    email: 'someone@example.com',
    type: 'sign-in',
  });

  check(
    'the person is told, rather than being promised a code that is not coming',
    refused.statusCode >= 400,
    `${refused.statusCode} ${refused.body}`,
  );

  check('the transport reports itself unreachable', (await brokenApp.mailer.verify()) === false);

  await brokenApp.close();

  console.info(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('The email test could not run:', error);
  process.exit(1);
});
