// E2E for lobby team choice and invite links: a host creates a lobby, a
// friend lands in it through the ?join=CODE deep link (stored name, two
// isolated browser contexts), switches to the host's side, and the match
// starts with both players on team 1 (blue).
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

  // Host creates the lobby.
  const host = await newIsolatedPage(browser, 'hostess');
  host.on('pageerror', (e) => errors.push(`host: ${e}`));
  await host.reload({ waitUntil: 'load' });
  await waitFor(host, findBtn('Play online'), 'host home');
  await clickButton(host, 'Create private lobby');
  await waitFor(
    host,
    `document.querySelector('.menu-code') && document.querySelector('.menu-code').textContent.length === 5`,
    'host lobby code',
  );
  const code = await host.evaluate(() => document.querySelector('.menu-code').textContent);
  const hasCopy = await host.evaluate(findBtn('Copy invite link'));
  if (!hasCopy) throw new Error('no Copy invite link button');
  console.log('host lobby up, code', code);

  // Friend arrives through the invite deep link with a stored name:
  // straight into the lobby, no home screen click.
  const friend = await newIsolatedPage(browser, 'buddy');
  friend.on('pageerror', (e) => errors.push(`friend: ${e}`));
  await friend.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(
    friend,
    `document.querySelector('.menu-team.red') && document.querySelector('.menu-team.red').textContent.includes('buddy')`,
    'friend auto-joined on the red side',
  );
  const cleaned = await friend.evaluate(() => window.location.search);
  if (cleaned !== '') throw new Error(`join query not consumed: ${cleaned}`);
  console.log('friend deep-linked into the lobby, url cleaned');

  // Friend moves to the host's side: duo vs bots.
  await friend.evaluate(() => {
    document.querySelector('.menu-team.blue button').click();
  });
  await waitFor(
    host,
    `document.querySelector('.menu-team.blue') && document.querySelector('.menu-team.blue').textContent.includes('buddy')`,
    'host sees the friend on blue',
  );
  console.log('friend switched to the blue side');

  // Start: both must reach select with the SAME team roster.
  await clickButton(host, 'Start match');
  for (const [label, page] of [
    ['host', host],
    ['friend', friend],
  ]) {
    await waitFor(page, findBtn('Lock in'), `${label} in select`);
    const blue = await page.evaluate(
      () => document.querySelector('.menu-team.blue')?.textContent ?? '',
    );
    if (!blue.includes('hostess') || !blue.includes('buddy')) {
      throw new Error(`${label}: select roster does not show the duo on blue: ${blue}`);
    }
  }
  console.log('select roster shows the duo on the same side');

  // Lock different champions and reach the match together.
  await host.evaluate(() => document.querySelectorAll('button.menu-champ')[0].click());
  await clickButton(host, 'Lock in');
  await friend.evaluate(() => document.querySelectorAll('button.menu-champ')[1].click());
  await clickButton(friend, 'Lock in');
  await waitFor(host, `!!document.querySelector('.hud')`, 'host HUD');
  await waitFor(friend, `!!document.querySelector('.hud')`, 'friend HUD');
  console.log('duo match running');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL LOBBY E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
