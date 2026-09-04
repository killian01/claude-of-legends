// E2E for the party queue: a lobby of two queues publicly as one party,
// both screens swap to the queue, one member opts into the bot fill, and
// the match seats the duo on the same side.
import puppeteer from 'puppeteer-core';
import { clickTile, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

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

  const host = await newIsolatedPage(browser, 'chief');
  host.on('pageerror', (e) => errors.push(`host: ${e}`));
  await host.reload({ waitUntil: 'load' });
  await waitFor(host, HOME_UP, 'host home');
  await clickTile(host, 'lobby');
  await waitFor(
    host,
    `document.querySelector('.menu-code') && document.querySelector('.menu-code').textContent.length === 5`,
    'lobby code',
  );
  const code = await host.evaluate(() => document.querySelector('.menu-code').textContent);

  const friend = await newIsolatedPage(browser, 'wing');
  friend.on('pageerror', (e) => errors.push(`friend: ${e}`));
  await friend.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(
    friend,
    `document.body.textContent.includes('chief') && document.body.textContent.includes('wing')`,
    'friend in lobby',
  );

  // Host queues the party: both screens swap from lobby to queue.
  await clickButton(host, 'Queue as a party');
  await waitFor(host, findBtn('Start now with bots'), 'host on the queue screen');
  await waitFor(friend, findBtn('Start now with bots'), 'friend on the queue screen');
  const count = await host.evaluate(() =>
    document.body.textContent.includes('2 / 10 in queue') ? 2 : 0,
  );
  if (count !== 2) throw new Error('queue does not show the party of two');
  console.log('party of two queued together');

  // The FRIEND (not the host) opts into the bot fill: the whole party goes.
  await clickButton(friend, 'Start now with bots');
  for (const [label, page] of [
    ['host', host],
    ['friend', friend],
  ]) {
    await waitFor(page, findBtn('Lock in'), `${label} in select`);
  }
  // Same side: both names under the same team column on the host's view.
  const sameSide = await host.evaluate(() => {
    const blue = document.querySelector('.menu-team.blue')?.textContent ?? '';
    const red = document.querySelector('.menu-team.red')?.textContent ?? '';
    return (
      (blue.includes('chief') && blue.includes('wing')) ||
      (red.includes('chief') && red.includes('wing'))
    );
  });
  if (!sameSide) throw new Error('party split across teams in select');
  console.log('select shows the party on one side');

  await host.evaluate(() => document.querySelectorAll('button.menu-champ')[0].click());
  await clickButton(host, 'Lock in');
  await friend.evaluate(() => document.querySelectorAll('button.menu-champ')[1].click());
  await clickButton(friend, 'Lock in');
  await waitFor(host, `!!document.querySelector('.hud')`, 'host HUD');
  await waitFor(friend, `!!document.querySelector('.hud')`, 'friend HUD');
  console.log('party match running');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL PARTY E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
