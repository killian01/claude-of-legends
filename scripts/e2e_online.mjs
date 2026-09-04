// Online end-to-end check: drives a real headless Chrome through the full
// flow against a running server: home menu, queue, start now, champion
// select, lock, then verifies the game canvas and HUD come up. Usage:
//   node scripts/e2e_online.mjs [url] [screenshot.png]

import puppeteer from 'puppeteer-core';
import { clickTile, e2eName, signIn } from './e2e_signin.mjs';

const url = process.argv[2] ?? 'http://localhost:8787/';
const shot = process.argv[3] ?? 'e2e.png';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const problems = [];
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));

async function clickByText(selector, text) {
  const clicked = await page.evaluate(
    (sel, t) => {
      const els = [...document.querySelectorAll(sel)];
      const el = els.find((e) => e.textContent?.includes(t));
      if (el) {
        el.click();
        return true;
      }
      return false;
    },
    selector,
    text,
  );
  if (!clicked) throw new Error(`could not click "${text}"`);
}

await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
await signIn(page, e2eName('e2ebot'));
await clickTile(page, 'ranked');
await page.waitForFunction(() => document.body.textContent?.includes('in queue'), {
  timeout: 10000,
});
await clickByText('button', 'Start now');
await page.waitForSelector('.menu-champ', { timeout: 10000 });
await page.click('.menu-champ');
await clickByText('button', 'Lock in');
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForSelector('.hud', { timeout: 10000 });
await new Promise((r) => setTimeout(r, 3000));

const info = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return {
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'MISSING',
    hud: document.querySelector('.hud') ? 'present' : 'MISSING',
    menuGone: document.querySelector('.menu') === null,
  };
});

await page.screenshot({ path: shot });
console.log('e2e info:', JSON.stringify(info));
console.log(problems.length ? problems.join('\n') : 'no page errors');
await browser.close();
if (info.canvas === 'MISSING' || info.hud === 'MISSING' || problems.length > 0) {
  process.exit(1);
}
