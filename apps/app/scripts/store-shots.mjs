// iPhone 6.9" screenshots (1320 x 2868) of the live web app as a guest.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'https://marion-min-carrying-nickname.trycloudflare.com';
const out = process.argv[3] ?? './out';
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.setUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
);

const settle = (ms = 2500) => new Promise((r) => setTimeout(r, ms));
async function shot(name) {
  await settle();
  await page.screenshot({ path: `${out}/${name}.png`, type: 'png' });
  console.log('shot', name);
}

await page.goto(`${base}/welcome`, { waitUntil: 'networkidle2', timeout: 60000 });
await shot('01-welcome');

// Guest in.
const guest = await page.$$('xpath/.//*[contains(text(),"Look around first")]');
if (guest[0]) {
  await guest[0].click();
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
}
await settle(4000);
await shot('02-feed');

const pages = [
  ['03-shop', '/shop'],
  ['04-product', '/product/cmvzsqm2u001fpm0te10o6vso'],
  ['05-look', '/look/cmvzsqncd0061pm0t52y6sc91'],
  ['06-ask', '/ask'],
];
for (const [name, path] of pages) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await settle(3000);
  await shot(name);
}
await browser.close();
