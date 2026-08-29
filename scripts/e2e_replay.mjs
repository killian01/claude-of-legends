// E2E for the replay viewer against seeded data (scripts/seed_replay.mjs):
// the career panel shows a Watch button, the viewer runs the recorded
// match with the control bar, speed changes stick, and Exit goes home on
// the same page.
import puppeteer from 'puppeteer-core';
import { signInSeeded } from './e2e_signin.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find(
      (e) => (e.textContent || '').trim() === t || (e.textContent || '').trim().startsWith(t),
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

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--window-size=1500,900', '--mute-audio'],
    defaultViewport: { width: 1500, height: 900 },
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  // The seeded account owns the seeded match record, so its career panel
  // is the one with a Watch button (scripts/seed_replay.ts).
  await signInSeeded(page);
  await page.evaluate(() => {
    window.__lifeMarker = 'alive';
  });
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => {
    window.__lifeMarker = 'alive';
  });
  await waitFor(page, findBtn('Play online'), 'home');

  // The career panel offers the recorded match.
  await clickButton(page, 'Profile and history');
  await waitFor(
    page,
    `!!document.querySelector('.prof-watch')`,
    'watch button on the recent match',
  );
  await page.evaluate(() => document.querySelector('.prof-watch').click());
  await waitFor(page, `!!document.querySelector('.replay-bar')`, 'replay bar up');
  await waitFor(page, `!!document.querySelector('.hud')`, 'replay HUD up');

  // The world advances: the HUD clock moves between two samples.
  const sample = () => page.evaluate(() => document.querySelector('.hud')?.textContent ?? '');
  const before = await sample();
  await sleep(2500);
  const after = await sample();
  if (before === after) throw new Error('replay does not advance');
  console.log('replay advances');

  // Speed to 4x, then pause freezes it.
  await clickButton(page, '4x');
  await sleep(1000);
  await clickButton(page, 'Pause');
  await sleep(500);
  const frozen1 = await sample();
  await sleep(1500);
  const frozen2 = await sample();
  if (frozen1 !== frozen2) throw new Error('pause does not freeze the replay');
  console.log('speed and pause work');

  // Exit lands home on the SAME page, replay artifacts gone.
  await clickButton(page, 'Exit replay');
  await waitFor(page, findBtn('Play online'), 'home after exit');
  const state = await page.evaluate(() => ({
    marker: window.__lifeMarker,
    bar: !!document.querySelector('.replay-bar'),
    hud: !!document.querySelector('.hud'),
  }));
  if (state.marker !== 'alive') throw new Error('page reloaded on exit');
  if (state.bar || state.hud) throw new Error('replay artifacts left behind');
  console.log('exit returns home cleanly');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL REPLAY E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
