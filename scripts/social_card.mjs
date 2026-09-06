// Draws public/social-card.jpg, the picture a link to the site turns into
// when it is posted. index.html names it in og:image and twitter:image,
// and tests/social_card.test.ts holds the markup to the file.
//
// It is composed here rather than cropped out of the art because the two
// jobs are different: the landing has a whole screen and a reader who has
// already arrived, this has 1200 by 630 and two seconds of someone
// scrolling a channel. So it carries the crest, the name, one claim and
// the domain, and nothing else.
//
// Everything sits inside the middle 600px on purpose. Platforms crop this
// picture to their own shapes and they do not agree: 1.91:1 on Facebook
// and LinkedIn, near enough 2:1 on X, and a square in a phone's message
// list. A square takes the middle 630 of 1200, so anything outside that
// band is a gamble. The first cut of this card ran the lockup up the left
// edge and the text across the right, and the crops ate one or the other.
//
// Run with the repo's own chrome (SHOT_CHROME or CHROME to point it
// elsewhere), then commit the jpg:
//   node scripts/social_card.mjs
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const OUT = process.argv[2] ?? path.join(ROOT, 'public/social-card.jpg');
const CHROME =
  process.env.SHOT_CHROME ??
  process.env.CHROME ??
  '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

// The declared size in index.html. Changing it means changing both.
const WIDTH = 1200;
const HEIGHT = 630;

const file = (rel) => `file://${path.join(ROOT, rel)}`;

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
@font-face { font-family: 'Cinzel'; src: url('${file('public/fonts/cinzel-latin.woff2')}') format('woff2');
  font-weight: 400 900; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
.card { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; background: #0a1120; overflow: hidden; }
img.art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  object-position: 50% 44%; }
/* Darkest where the words are, so the art still reads at the edges. */
.scrim { position: absolute; inset: 0; background: radial-gradient(ellipse 46% 76% at 50% 50%,
  rgba(4,7,16,0.90) 0%, rgba(4,7,16,0.74) 46%, rgba(4,7,16,0.34) 78%, rgba(4,7,16,0.16) 100%); }
/* The safe band: what a square crop keeps. Nothing that matters leaves it. */
.safe { position: relative; height: 100%; width: 600px; margin: 0 auto; display: flex;
  flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.lock { height: 366px; width: auto; filter: drop-shadow(0 16px 40px rgba(0,0,0,0.75)); }
h1 { font-family: Cinzel, Georgia, serif; font-size: 28px; letter-spacing: 2.1px;
  text-transform: uppercase; color: #e6d7a8; text-align: center; white-space: nowrap;
  text-shadow: 0 3px 18px rgba(4,7,16,0.95); }
.dom { font-family: Cinzel, Georgia, serif; font-size: 20px; letter-spacing: 3.6px;
  text-transform: uppercase; color: #b9cbe4; text-shadow: 0 2px 14px rgba(4,7,16,0.95); }
</style></head>
<body><div class="card">
<img class="art" src="${file('public/art/home_end.jpg')}" alt="">
<div class="scrim"></div>
<div class="safe">
  <img class="lock" src="${file('public/logo.webp')}" alt="">
  <h1>Three lanes. Ten champions.</h1>
  <div class="dom">claudeoflegends.com</div>
</div>
</div></body></html>`;

// The composition is written out because chrome loads the art off disk
// beside it; nothing but this script ever reads the file.
const page = path.join(tmpdir(), 'loc-social-card.html');
writeFileSync(page, html);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // file:// images from a file:// page, which is the whole composition.
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--allow-file-access-from-files',
  ],
});
const tab = await browser.newPage();
await tab.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
await tab.goto(`file://${page}`, { waitUntil: 'networkidle0' });
await tab.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));
await tab.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
await browser.close();
console.log(`social card written to ${OUT}`);
