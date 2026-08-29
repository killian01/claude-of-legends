// E2E for the no-reload match lifecycle:
// A. practice -> Esc -> Leave match -> home on the SAME page (marker survives),
//    then practice re-enters cleanly (rebuild works).
// B. online bot match -> Leave match -> Play online again lands in the QUEUE,
//    not back inside the abandoned match (deliberate leave holds no seat).
import puppeteer from 'puppeteer-core';
import { e2eName, signIn } from './e2e_signin.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((e) =>
      (e.textContent || '').trim().startsWith(t),
    );
    if (!b) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`button not found: ${text}`);
}

async function waitFor(page, fnBody, label, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(300);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const findBtn = (t) =>
  `[...document.querySelectorAll('button')].some((e) => (e.textContent || '').trim().startsWith('${t}'))`;

async function enterMatchOffline(page) {
  await clickButton(page, 'Practice vs dummies');
  await waitFor(page, findBtn('Lock in'), 'champion select');
  await page.evaluate(() => document.querySelector('button.menu-champ').click());
  await clickButton(page, 'Lock in');
  await waitFor(page, `!!document.querySelector('.hud')`, 'HUD up (offline match running)');
}

async function leaveViaEscape(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
  await clickButton(page, 'Leave match');
}

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--window-size=1500,900', '--mute-audio'],
    defaultViewport: { width: 1500, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // --- Scenario A: offline lifecycle, same page ---
  await page.goto(URL, { waitUntil: 'load' });
  await waitFor(page, findBtn('Play online'), 'home menu');
  await page.evaluate(() => {
    window.__lifeMarker = 'alive';
  });
  await enterMatchOffline(page);
  await leaveViaEscape(page);
  await waitFor(page, findBtn('Play online'), 'home menu back after leave');
  const a = await page.evaluate(() => ({
    marker: window.__lifeMarker,
    hud: !!document.querySelector('.hud'),
    canvases: document.querySelectorAll('canvas').length,
  }));
  if (a.marker !== 'alive') throw new Error('A: page reloaded (marker lost)');
  if (a.hud) throw new Error('A: HUD still present after leave');
  console.log('A: leave-to-home on same page OK', JSON.stringify(a));

  // Re-enter practice: the lifecycle must rebuild everything cleanly.
  await enterMatchOffline(page);
  const again = await page.evaluate(() => ({
    marker: window.__lifeMarker,
    hud: !!document.querySelector('.hud'),
  }));
  if (again.marker !== 'alive' || !again.hud) throw new Error('A2: re-enter failed');
  console.log('A2: practice re-entered on same page OK');
  await leaveViaEscape(page);
  await waitFor(page, findBtn('Play online'), 'home again');

  // --- Scenario B: online deliberate leave holds no seat ---
  await clickButton(page, 'Play online');
  await waitFor(page, findBtn('Start now with bots'), 'queue screen');
  await clickButton(page, 'Start now with bots');
  await waitFor(page, findBtn('Lock in'), 'online champion select');
  await page.evaluate(() => document.querySelector('button.menu-champ').click());
  await clickButton(page, 'Lock in');
  await waitFor(page, `!!document.querySelector('.hud')`, 'HUD up (online match running)');
  await leaveViaEscape(page);
  await waitFor(page, findBtn('Play online'), 'home back after online leave');

  // Queue again at once: a reserved seat would yank us straight into the
  // abandoned match (HUD, no queue screen). We must see the queue.
  await clickButton(page, 'Play online');
  await waitFor(page, findBtn('Start now with bots'), 'queue screen after leave (no ghost seat)');
  await sleep(2500);
  const b = await page.evaluate(() => ({
    hud: !!document.querySelector('.hud'),
    queue: [...document.querySelectorAll('button')].some((e) =>
      (e.textContent || '').startsWith('Start now with bots'),
    ),
  }));
  if (b.hud) throw new Error('B: pulled back into the abandoned match (reservation leaked)');
  if (!b.queue) throw new Error('B: queue screen not up');
  console.log('B: deliberate leave holds no seat, requeue lands in queue OK');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL LIFECYCLE E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
