// Film a saved replay. Signs into the local dev stack, opens the replay
// viewer on REPLAY_ID, fast-forwards to REPLAY_AT (seconds of sim time),
// then records CDP screencast frames at 1x for REPLAY_FOR seconds into
// SHOT_DIR.
//
// The frames become an animated WebP:
//   ffmpeg -framerate 8.33 -i docs/screenshots/frame-%04d.jpg \
//     -vf scale=720:-2 -vcodec libwebp_anim -q:v 72 -loop 0 \
//     -preset picture docs/screenshots/clip.webp
// WebP rather than GIF: 121 frames are 2.8 MB instead of 8, and without
// the palette dither that GIF puts on the water and the grass.
//
// The README used to open on one of these and no longer does: at the
// width a clip has to be encoded to before it is a reasonable download,
// the game reads as a blur, and the page stutters while it loops. A still
// of the same fight says more, so what the README shows is a screenshot
// from scripts/shot_readme.mjs.
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { e2eName, signIn } from './e2e_signin.mjs';

const OUT = process.env.SHOT_DIR ?? 'docs/screenshots';
const CHROME =
  process.env.SHOT_CHROME ??
  process.env.CHROME ??
  '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const BASE = process.env.SHOT_URL ?? 'http://localhost:5173';
const REPLAY_ID = Number(process.env.REPLAY_ID ?? 2);
const AT = Number(process.env.REPLAY_AT ?? 570);
const FOR = Number(process.env.REPLAY_FOR ?? 45);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 800, height: 450 },
});
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await signIn(page, e2eName('shotreplay'), 15000).catch(async () => {
  // First run registers; helper signature: fill the register tab by hand
  // is what signIn already does. A throw here means neither worked.
  throw new Error('sign-in failed');
});
console.log('signed in');
await page.waitForSelector('.pg.home', { timeout: 15000 });
await page.evaluate((id) => {
  window.dispatchEvent(new CustomEvent('loc:replay', { detail: id }));
}, REPLAY_ID);
await page.waitForSelector('.replay-bar', { timeout: 20000 });
console.log('replay viewer up');
await sleep(3000);

const clickSpeed = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll('.replay-btn')].find((x) => x.textContent === l);
    if (!b) throw new Error(`no speed ${l}`);
    b.click();
  }, label);

// The opening shop auto-opens in the replay viewer too; keep it shut.
const closeShop = () =>
  page.evaluate(() => {
    const open = document.querySelector('.hud-shop.open');
    const b =
      open && [...open.querySelectorAll('button')].find((x) => x.textContent?.includes('Close'));
    if (b) b.click();
  });

// The top clock (.hud-teamscore-clock) shows elapsed sim time as M:SS.
const simTime = () =>
  page.evaluate(() => {
    const clock = document.querySelector('.hud-teamscore-clock');
    const t = clock?.textContent?.match(/(\d{1,2}):(\d{2})/);
    return t ? Number(t[1]) * 60 + Number(t[2]) : -1;
  });

await clickSpeed('4x');
for (;;) {
  await closeShop();
  const t = await simTime();
  if (t < 0) console.log('clock not found yet');
  else if (t >= AT) break;
  await sleep(1000);
}
await clickSpeed('1x');
await closeShop();
// The control bar reads REPLAY across the top of every frame; hide it
// (and the keybind hints) while recording so the gif is pure gameplay.
await page.evaluate(() => {
  for (const el of document.querySelectorAll('.replay-bar, .hud-hints')) {
    el.style.display = 'none';
  }
});
console.log(`at ${AT}s, recording ${FOR}s`);

const cdp = await page.createCDPSession();
let frame = 0;
cdp.on('Page.screencastFrame', async (ev) => {
  await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  await writeFile(
    `${OUT}/frame-${String(frame++).padStart(4, '0')}.jpg`,
    Buffer.from(ev.data, 'base64'),
  );
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
await sleep(FOR * 1000);
await cdp.send('Page.stopScreencast');
console.log(`captured ${frame} frames`);
await browser.close();
