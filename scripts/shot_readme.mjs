// Capture script for the README screenshots. Drives the real client
// headless: landing page, then an offline practice match walked to the
// mid lane fight. Run with the dev stack up (vite on 5173); SHOT_URL
// switches the landing shot to another host (the live server), and
// SHOT_HOME_ONLY=1 stops after it.
import puppeteer from 'puppeteer-core';

const OUT = process.env.SHOT_DIR ?? 'docs/screenshots';
const CHROME =
  process.env.SHOT_CHROME ?? '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1720, height: 960 },
});
const page = await browser.newPage();
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
  await browser.close();
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
  await page.mouse.click(1606, 886, { button: 'right' });
  await sleep(2000);
}
console.log('at lane, fighting');
const shopOpen = () => page.evaluate(() => document.querySelector('.hud-shop.open') !== null);
// Fight in front of the tower: recenter on our champion, attack-move up
// the lane, cast toward the enemies, screenshot only with a clear HUD.
for (let i = 0; i < 20; i++) {
  await closeShop();
  await levelUp();
  await page.keyboard.press('Space');
  await sleep(200);
  const tx = 1000 + (i % 3) * 90;
  const ty = 320 + (i % 2) * 80;
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
await browser.close();
