// E2E for the party queue: a lobby of three (two accounts and a Guest who
// joined through the invitation card on the landing) queues publicly as
// one party, every screen swaps to the queue with its Cancel reading Back
// to the lobby, one member opts into the bot fill, and the match seats the
// party on the same side.
//
// URL overrides the client's address, as in scripts/e2e_academy.mjs.
import puppeteer from 'puppeteer-core';
import { clickTile, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5173';
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
const LOBBY_UP = `/^[A-Z]{5,6}$/.test(document.querySelector('.menu-code')?.textContent ?? '')`;

async function newContextPage(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1500, height: 900 });
  return page;
}

async function newIsolatedPage(browser, name) {
  const page = await newContextPage(browser);
  await page.goto(URL, { waitUntil: 'load' });
  await signIn(page, e2eName(name));
  return page;
}

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    // Software WebGL the way recent Chrome wants it asked for
    // (docs/dev-local.md): plain --use-gl=swiftshader is refused.
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--window-size=1500,900',
      '--mute-audio',
    ],
    defaultViewport: { width: 1500, height: 900 },
  });
  const errors = [];

  const host = await newIsolatedPage(browser, 'chief');
  host.on('pageerror', (e) => errors.push(`host: ${e}`));
  await host.reload({ waitUntil: 'load' });
  await waitFor(host, HOME_UP, 'host home');
  await clickTile(host, 'lobby');
  await waitFor(host, LOBBY_UP, 'lobby code');
  const code = await host.evaluate(() => document.querySelector('.menu-code').textContent);

  const friend = await newIsolatedPage(browser, 'wing');
  friend.on('pageerror', (e) => errors.push(`friend: ${e}`));
  await friend.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(
    friend,
    `document.body.textContent.includes('chief') && document.body.textContent.includes('wing')`,
    'friend in lobby',
  );

  // A Guest with no account, through the invitation card.
  const guest = await newContextPage(browser);
  guest.on('pageerror', (e) => errors.push(`guest: ${e}`));
  await guest.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(guest, findBtn('Join the lobby'), 'the invitation card');
  await clickButton(guest, 'Join the lobby');
  await waitFor(
    guest,
    `${LOBBY_UP} && document.body.textContent.includes('(you)')`,
    'Guest in lobby',
  );
  const guestName = await guest.evaluate(() => {
    const row = [...document.querySelectorAll('.menu-lobby-row')].find((r) =>
      (r.textContent ?? '').includes('(you)'),
    );
    return row?.querySelector('.menu-lobby-who')?.textContent ?? '';
  });
  if (!guestName) throw new Error('the Guest has no row of its own');
  await waitFor(
    host,
    `document.body.textContent.includes(${JSON.stringify(guestName)})`,
    'host sees the Guest',
  );
  console.log('Guest joined through the invitation card as', guestName);

  // Host queues the party: every screen swaps from lobby to queue, and
  // its Cancel goes back to the lobby.
  await clickButton(host, 'Queue as a party');
  for (const [label, page] of [
    ['host', host],
    ['friend', friend],
    ['guest', guest],
  ]) {
    await waitFor(page, findBtn('Start now with bots'), `${label} on the queue screen`);
    if (!(await page.evaluate(findBtn('Back to the lobby')))) {
      throw new Error(`${label}: the party queue offers no Back to the lobby`);
    }
  }
  const count = await host.evaluate(() =>
    document.body.textContent.includes('3 / 10 in queue') ? 3 : 0,
  );
  if (count !== 3) throw new Error('queue does not show the party of three');
  console.log('party of three queued together');

  // The FRIEND (not the host) opts into the bot fill: the whole party goes.
  await clickButton(friend, 'Start now with bots');
  for (const [label, page] of [
    ['host', host],
    ['friend', friend],
    ['guest', guest],
  ]) {
    await waitFor(page, findBtn('Lock in'), `${label} in select`);
  }
  // Same side: every name under the same team column on the host's view.
  const sameSide = await host.evaluate((g) => {
    const blue = document.querySelector('.menu-team.blue')?.textContent ?? '';
    const red = document.querySelector('.menu-team.red')?.textContent ?? '';
    const all = (t) => t.includes('chief') && t.includes('wing') && t.includes(g);
    return all(blue) || all(red);
  }, guestName);
  if (!sameSide) throw new Error('party split across teams in select');
  console.log('select shows the party on one side');

  // Three different champions, the Guest's from its own collection.
  await host.evaluate(() => document.querySelectorAll('button.menu-champ')[0].click());
  await clickButton(host, 'Lock in');
  await friend.evaluate(() => document.querySelectorAll('button.menu-champ')[1].click());
  await clickButton(friend, 'Lock in');
  await guest.evaluate(() => {
    const free = [...document.querySelectorAll('button.menu-champ:not(.locked)')];
    (free[2] ?? free[free.length - 1]).click();
  });
  await clickButton(guest, 'Lock in');
  for (const [label, page] of [
    ['host', host],
    ['friend', friend],
    ['guest', guest],
  ]) {
    await waitFor(page, `!!document.querySelector('.hud')`, `${label} HUD`);
  }
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
