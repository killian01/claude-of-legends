// Capture script for the README screenshots. Drives the real client
// headless: landing page, then an offline practice match walked to the
// mid lane fight. Run with the dev stack up (vite on 5173); SHOT_URL
// switches the landing shot to another host (the live server), and
// SHOT_HOME_ONLY=1 stops after it.
//
// The README's match shot is no longer one of these: it is a frame of a
// saved replay's fight, taken by scripts/tour_match.mjs with TOUR_ZOOM
// (docs/making-a-clip.md), where a real ten-champion match is at hand.
import puppeteer from 'puppeteer-core';

const OUT = process.env.SHOT_DIR ?? 'docs/screenshots';
const CHROME =
  process.env.SHOT_CHROME ??
  process.env.CHROME ??
  '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const VP = (process.env.SHOT_VP ?? '1720x960').split('x').map(Number);
// SHOT_WS: attach to a chrome started by hand (needed for the GIF: the
// CDP screencast records the real window, and a self-started chrome is
// the only way to make that window the wanted size; puppeteer's launch
// path pins it at 800x600 whatever args it gets). Otherwise launch, with
// an emulated viewport, which page.screenshot captures correctly.
const browser = process.env.SHOT_WS
  ? await puppeteer.connect({ browserURL: process.env.SHOT_WS, defaultViewport: null })
  : await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      defaultViewport: { width: VP[0], height: VP[1] },
    });
// When attached, reuse the initial tab: a newPage would open a second
// window at the 800x600 default instead of the one sized by the flags.
const done = () => (process.env.SHOT_WS ? browser.disconnect() : browser.close());
const page = process.env.SHOT_WS ? (await browser.pages())[0] : await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickButton = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(l));
    if (!b) throw new Error(`no button ${l}`);
    b.click();
  }, label);

const BASE = process.env.SHOT_URL ?? 'http://localhost:5173';
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.auth-form, .menu-btn', { timeout: 20000 });
await sleep(7000); // let the showcase models and fonts land
await page.screenshot({ path: `${OUT}/shot-home.png` });
console.log('home captured');
if (process.env.SHOT_HOME_ONLY) {
  await done();
  process.exit(0);
}

await clickButton('Play offline now');
await page.waitForSelector('.menu-champ', { timeout: 20000 });
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.menu-champ')].find((c) =>
    c.textContent?.includes('Torv'),
  );
  (card ?? document.querySelector('.menu-champ')).click();
});
await sleep(500);
await page.screenshot({ path: `${OUT}/shot-select.png` });
await clickButton('Lock in');
console.log('locked, waiting for the match');
await sleep(9000); // load-in

// The shop opens on its own at the fountain; close it or every click
// lands on the overlay instead of the ground.
// The closed shop keeps its DOM (display none), so openness is the
// .hud-shop.open class, never the Close button's existence.
const closeShop = () =>
  page.evaluate(() => {
    const open = document.querySelector('.hud-shop.open');
    if (!open) return;
    const b = [...open.querySelectorAll('button')].find((x) =>
      x.textContent?.includes('Close (P)'),
    );
    if (b) b.click();
  });
await closeShop();
await sleep(500);

// Spend any pending skill points (Alt+key levels the ability).
const levelUp = async () => {
  for (const k of ['q', 'w', 'e']) {
    await page.keyboard.down('Alt');
    await page.keyboard.press(k);
    await page.keyboard.up('Alt');
    await sleep(120);
  }
};
await levelUp();

// Walk to our own outer mid tower (right-click on the minimap orders a
// move to that world point, src/ui/minimap.ts). Staying on our side of
// the lane keeps a level 1 champion alive; the wave fight comes to us.
for (let i = 0; i < 22; i++) {
  await closeShop();
  await page.mouse.click(VP[0] - 114, VP[1] - 74, { button: 'right' });
  await sleep(2000);
}
console.log('at lane, fighting');
const shopOpen = () => page.evaluate(() => document.querySelector('.hud-shop.open') !== null);

// GIF mode: instead of stills, grab frames continuously while driving one
// fight sequence, for ffmpeg to assemble (SHOT_GIF=1).
if (process.env.SHOT_GIF) {
  // page.screenshot is seconds per frame under swiftshader; the CDP
  // screencast pushes JPEG frames as they render instead.
  const { writeFile } = await import('node:fs/promises');
  const cdp = await page.createCDPSession();
  let frame = 0;
  const t0 = Date.now();
  cdp.on('Page.screencastFrame', async (ev) => {
    await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    const n = frame++;
    await writeFile(
      `${OUT}/frame-${String(n).padStart(4, '0')}.jpg`,
      Buffer.from(ev.data, 'base64'),
    );
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 85,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1,
  });
  const grabber = sleep(16000).then(async () => {
    await cdp.send('Page.stopScreencast');
    console.log(`gif: ${frame} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  });
  for (let i = 0; i < 8; i++) {
    await closeShop();
    await levelUp();
    await page.keyboard.press('Space');
    await sleep(200);
    const tx = Math.round((1000 + (i % 3) * 90) * (VP[0] / 1720));
    const ty = Math.round((320 + (i % 2) * 80) * (VP[1] / 960));
    await page.mouse.move(tx, ty);
    await page.keyboard.press('a');
    await page.mouse.click(tx, ty);
    await sleep(500);
    await page.keyboard.press(i % 2 === 0 ? 'q' : 'w');
    await sleep(1300);
  }
  await grabber;
  console.log(`gif frames: ${frame}`);
  await done();
  process.exit(0);
}

// Fight in front of the tower: recenter on our champion, attack-move up
// the lane, cast toward the enemies, screenshot only with a clear HUD.
for (let i = 0; i < 20; i++) {
  await closeShop();
  await levelUp();
  await page.keyboard.press('Space');
  await sleep(200);
  const tx = Math.round((1000 + (i % 3) * 90) * (VP[0] / 1720));
  const ty = Math.round((320 + (i % 2) * 80) * (VP[1] / 960));
  await page.mouse.move(tx, ty);
  await page.keyboard.press('a');
  await page.mouse.click(tx, ty);
  await sleep(400);
  await page.keyboard.press(i % 2 === 0 ? 'q' : 'w');
  await sleep(700);
  await page.keyboard.press('Space');
  await sleep(150);
  await closeShop();
  await sleep(200);
  if (await shopOpen()) {
    console.log(`shot ${i}: shop stuck open (dead?), skipping`);
  } else {
    await page.screenshot({ path: `${OUT}/shot-match-${String(i).padStart(2, '0')}.png` });
  }
  await sleep(1800);
}
console.log('done');
await done();
