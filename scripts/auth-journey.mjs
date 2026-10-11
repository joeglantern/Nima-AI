/**
 * The whole way in, driven through the real app.
 *
 *   node scripts/auth-journey.mjs
 *
 * Not the API: the app, in a browser, clicking what a person clicks. Every
 * bug this has caught so far was in the gap between the two. The API has
 * answered 200 the entire time while the screen did nothing useful.
 *
 * It walks: arrive as a visitor, browse without an account, hit the gate,
 * sign up with an address nobody has used, land in the app, keep the
 * session across a reload, set up a profile, sign out, and sign back in to
 * find everything still there.
 *
 * Needs the stack, the API and Metro running. Mailpit stands in for a real
 * inbox, which is where development mail goes.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const APP = 'http://localhost:8081';
const MAILPIT = 'http://localhost:8060';
const EMAIL = `journey-${Date.now()}@example.com`;

mkdirSync('.shots', { recursive: true });

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.info(`  pass  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

const proc = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    /*
     * A throwaway profile, so every run arrives as a stranger.
     *
     * Reusing one meant the second run started signed in from the first,
     * and every check about what a visitor sees passed for the wrong
     * reason.
     */
    `--user-data-dir=${process.env.TEMP}/nima-journey-${Date.now()}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function devtools(path) {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error('chrome did not start');
}

const page = (await devtools('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.once('open', r));

let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const run = async (expression) => {
  try {
    const result = await Promise.race([
      send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
      sleep(15_000).then(() => null),
    ]);
    return result?.result?.value;
  } catch {
    // A navigation mid evaluate kills the call. The step fails, which is
    // the right outcome, rather than the run hanging on a dead promise.
    return undefined;
  }
};

const text = async () => (await run('document.body.innerText.replace(/\\s+/g, " ")')) ?? '';

/*
 * Click the label itself and let it bubble.
 *
 * React Native Web puts the handler on the pressable element, so a click
 * on the text inside reaches it. An earlier version walked up looking for
 * role="button" and clicked that instead, which quietly missed every
 * control with a different role, the style tiles among them, and made the
 * app look as though it was not saving.
 */
const tap = (label) =>
  run(`(() => {
    const hit = [...document.querySelectorAll('div,span')]
      .find((n) => n.textContent === ${JSON.stringify(label)} && n.children.length === 0);
    if (!hit) return false;
    hit.click();
    return true;
  })()`);

const fill = (value) =>
  run(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const input = inputs[inputs.length - 1];
    if (!input) return false;
    input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      .set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

const go = async (path, wait = 7000) => {
  await send('Page.navigate', { url: `${APP}${path}` });
  await sleep(wait);
};

const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`.shots/${name}.png`, Buffer.from(s.data, 'base64'));
};

async function codeFrom(since) {
  for (let i = 0; i < 40; i += 1) {
    const inbox = await (await fetch(`${MAILPIT}/api/v1/messages?limit=5`)).json();
    for (const message of inbox.messages ?? []) {
      if (message.ID === since) break;
      const match = `${message.Subject} ${message.Snippet}`.match(/(\d{6})/);
      if (match) return match[1];
    }
    await sleep(500);
  }
  return undefined;
}

const newestMail = async () =>
  (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()).messages[0]?.ID ?? null;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});

console.info(`Signing up as ${EMAIL}\n`);

// ------------------------------------------------- arriving as a visitor ---
console.info('Arriving');
await go('/', 26000);

const landed = await text();
check(
  'a first visit opens on the welcome screen',
  landed.includes('Your personal AI stylist'),
  landed.slice(0, 80),
);

check('there is a way past it without an account', await tap('Look around first'));
await sleep(5000);

const feed = await text();
check(
  'looking around reaches the app',
  !feed.includes('Your personal AI stylist'),
  feed.slice(0, 80),
);

await go('/shop', 6000);
const shop = await text();
check('a visitor can browse the shop', shop.includes('KSh'), shop.slice(0, 80));

// --------------------------------------------------------------- the gate ---
console.info('\nThe gate');
await go('/store', 6000);
check('a visitor is offered an account', (await text()).includes('Create an account'));
check('the offer opens the sheet', await tap('Create an account'));
await sleep(2500);
// With no Google or Apple set up on this server, there is nothing to choose
// between, so the sheet opens on the address field itself.
const sheet = await text();
check(
  'the sheet says what it is for',
  sheet.includes('Create an account') && sheet.includes('Send me a code'),
  sheet.slice(0, 90),
);

// -------------------------------------------------------------- signing up ---
console.info('\nSigning up');
check(
  'email is offered without a detour',
  (await text()).includes('Send me a code') || (await tap('Continue with email')),
);
await sleep(2000);

const before = await newestMail();
check('the address can be typed', await fill(EMAIL));
await sleep(600);
check('a code can be asked for', await tap('Send me a code'));
await sleep(5000);
await shot('journey-1-code');

const code = await codeFrom(before);
check('a code arrives', Boolean(code), code);

check('the code can be typed', await fill(code ?? '000000'));
// Nothing is tapped here on purpose: the sixth digit submits itself.
await sleep(7000);
await shot('journey-2-signed-in');

const afterSignIn = await text();
check(
  'the sheet closes on its own, with no button to find',
  !afterSignIn.includes('Continue with email'),
  afterSignIn.slice(0, 90),
);
check(
  'the account is real, so the offer is gone',
  !afterSignIn.includes('Create an account'),
  afterSignIn.slice(0, 90),
);

// ------------------------------------------------------ keeping the session ---
console.info('\nKeeping the session');
await go('/store', 7000);
check('the account survives moving around', !(await text()).includes('Create an account'));

await run('location.reload()');
await sleep(11000);
const reloaded = await text();
check(
  'the account survives a reload',
  !reloaded.includes('Create an account'),
  reloaded.slice(0, 90),
);
check(
  'and the welcome screen does not come back',
  !reloaded.includes('See yourself in every outfit'),
);

// ------------------------------------------------------------- the profile ---
console.info('\nSetting up');
await go('/style', 7000);
check('the questionnaire opens', (await text()).includes('Styles you reach for'));

check('a style can be chosen', await tap('Streetwear'));
await sleep(2500);
check('a colour can be chosen', await tap('Black'));
await sleep(2500);
await shot('journey-3-questionnaire');

await go('/style', 7000);
const saved = await run(`(() => {
  const m = document.body.innerText.match(/(\\d+) percent done/);
  return m ? Number(m[1]) : 0;
})()`);
check('what was answered is still there after leaving', saved > 0, `${saved} percent`);

await go('/store', 7000);
const profile = await text();
check(
  'the profile knows who this is',
  profile.includes(EMAIL.split('@')[0]) || profile.includes('@'),
  profile.slice(0, 90),
);

// ---------------------------------------------------------------- signing out ---
console.info('\nSigning out and back in');
await go('/settings', 6000);
check('settings can be reached', (await text()).includes('Sign out'), (await text()).slice(0, 90));
check('sign out works', await tap('Sign out'));
await sleep(7000);

await go('/store', 7000);
check('signing out really signs out', (await text()).includes('Create an account'));

await tap('Create an account');
await sleep(2500);
await tap('Continue with email');
await sleep(2000);

const before2 = await newestMail();
await fill(EMAIL);
await sleep(600);
await tap('Send me a code');
await sleep(5000);

const code2 = await codeFrom(before2);
check('a returning person can ask for another code', Boolean(code2), code2);
await fill(code2 ?? '000000');
await sleep(7000);

await go('/style', 7000);
const kept = await run(`(() => {
  const m = document.body.innerText.match(/(\\d+) percent done/);
  return m ? Number(m[1]) : 0;
})()`);
check('their answers are still on the account', kept === saved && kept > 0, `${kept} percent`);
await shot('journey-4-back-in');

console.info(`\n${passed} passed, ${failed} failed`);

ws.close();
proc.kill();
process.exit(failed > 0 ? 1 : 0);
