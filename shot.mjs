/* Dev-only screenshot driver. Not shipped. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const OUT = '.shots';
mkdirSync(OUT, { recursive: true });

const jobs = JSON.parse(process.argv[2]);
const proc = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${process.env.TEMP}/nima-shot-profile`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function http(path) {
  for (let i = 0; i < 60; i += 1) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error('chrome did not start');
}

const page = (await http('/json/list')).find((t) => t.type === 'page');
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

await send('Page.enable');
await send('Runtime.enable');

for (const job of jobs) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: job.width ?? 390,
    height: job.height ?? 844,
    deviceScaleFactor: job.scale ?? 1,
    mobile: job.mobile ?? true,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: job.dark ? 'dark' : 'light' }],
  });
  await send('Page.navigate', { url: job.url });
  await sleep(job.wait ?? 5000);
  if (job.prime) {
    await send('Runtime.evaluate', { expression: job.prime, returnByValue: true });
    await sleep(job.settle ?? 1500);
  }
  if (job.eval) {
    const r = await send('Runtime.evaluate', {
      expression: job.eval,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log(`[${job.name}]`, JSON.stringify(r.result.value, null, 2));
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${job.name}.png`, Buffer.from(shot.data, 'base64'));
  console.log('wrote', `${OUT}/${job.name}.png`);
}

ws.close();
proc.kill();
