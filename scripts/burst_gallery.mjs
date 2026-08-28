// Burst screenshots of a page in headless Chrome: one shot every 1.2 s,
// eight shots, so every phase of the champions gallery cycle (idle, walk,
// windup, cast) gets captured. Companion to smoke_browser.mjs for visual
// calibration of champion props and animations.
// Usage: node scripts/burst_gallery.mjs <url> <out-prefix>

import puppeteer from 'puppeteer-core';

const url = process.argv[2];
const outBase = process.argv[3] ?? 'burst';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `${outBase}_${i}.png` });
  await new Promise((r) => setTimeout(r, 1200));
}
await browser.close();
console.log('done');
