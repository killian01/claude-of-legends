// Browser smoke check: builds are assumed done; serves dist/ via vite
// preview (started by the caller) or takes a URL argument. Loads the page in
// headless Chrome, reports every console message and page error, and saves a
// screenshot. Usage: node scripts/smoke_browser.mjs [url] [screenshot.png]

import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:4173/';
const shot = process.argv[3] ?? 'smoke.png';
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const problems = [];
page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') problems.push(`[console.${type}] ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) =>
  problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ''}`),
);

await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise((r) => setTimeout(r, 4000));

const info = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const hud = document.querySelector('.hud');
  return {
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'MISSING',
    hud: hud ? 'present' : 'MISSING',
    hudChildren: hud ? hud.children.length : 0,
    bodyChildren: document.body.children.length,
  };
});

await page.screenshot({ path: shot });
console.log('page info:', JSON.stringify(info));
console.log(problems.length ? problems.join('\n') : 'no console errors');
await browser.close();
