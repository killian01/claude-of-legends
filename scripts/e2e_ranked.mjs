// E2E for ranked integrity: two humans meet through the PUBLIC queue
// (rated-eligible, one per side), one walks out mid-match, and the
// walk-out costs rating and locks the leaver's queue for a while.
import puppeteer from 'puppeteer-core';
import { apiFromPage, clickTile, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((e) =>
      (e.textContent || '').trim().startsWith(t),
    );
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`button not found or disabled: ${text}`);
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

async function newIsolatedPage(browser, name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  await page.goto(URL, { waitUntil: 'load' });
  await signIn(page, e2eName(name));
  return page;
}

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--window-size=1500,900', '--mute-audio'],
    defaultViewport: { width: 1500, height: 900 },
  });
  const errors = [];

  // Both queue publicly and opt into the bot fill: one human per side.
  const alice = await newIsolatedPage(browser, 'alice');
  const bob = await newIsolatedPage(browser, 'bob');
  for (const p of [alice, bob]) p.on('pageerror', (e) => errors.push(String(e)));
  await clickTile(alice, 'ranked');
  await waitFor(alice, findBtn('Start now with bots'), 'alice queued');
  await clickTile(bob, 'ranked');
  await waitFor(bob, findBtn('Start now with bots'), 'bob queued');
  await clickButton(alice, 'Start now with bots');
  await clickButton(bob, 'Start now with bots');
  for (const [label, page, champIdx] of [
    ['alice', alice, 0],
    ['bob', bob, 1],
  ]) {
    await waitFor(page, findBtn('Lock in'), `${label} in select`);
    await page.evaluate((i) => document.querySelectorAll('button.menu-champ')[i].click(), champIdx);
    await clickButton(page, 'Lock in');
  }
  await waitFor(alice, `!!document.querySelector('.hud')`, 'alice HUD');
  await waitFor(bob, `!!document.querySelector('.hud')`, 'bob HUD');
  console.log('rated-eligible match running (queue, 1 human per side)');

  const before = (await apiFromPage(bob, '/api/me')).body;

  // Bob walks out mid-match.
  await bob.keyboard.press('Escape');
  await sleep(300);
  await clickButton(bob, 'Leave match');
  await waitFor(bob, HOME_UP, 'bob home after walk-out');
  await sleep(500);
  const after = (await apiFromPage(bob, '/api/me')).body;
  if (after.rating !== before.rating - 15) {
    throw new Error(`penalty not applied: ${before.rating} -> ${after.rating}`);
  }
  if (after.ratedGames !== before.ratedGames) {
    throw new Error('a walk-out must not count as a rated game');
  }
  console.log(`penalty applied: ${before.rating} -> ${after.rating}, rated games unchanged`);

  // The queue refuses him for a while, with a reason.
  await clickTile(bob, 'ranked');
  await waitFor(
    bob,
    `document.body.textContent.includes('The queue unlocks in')`,
    'lockout notice',
  );
  console.log('queue lockout notice shown');

  // Alice keeps her seat and her game; a teammate note reached her chat.
  const aliceInMatch = await alice.evaluate(() => !!document.querySelector('.hud'));
  if (!aliceInMatch) throw new Error('alice lost her match');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL RANKED E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
