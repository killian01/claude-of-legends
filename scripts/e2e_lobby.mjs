// E2E for private lobbies (ADR 0036): a host creates a lobby, a friend
// lands in it through the ?join=CODE deep link (two isolated browser
// contexts, each signed in) and switches to the host's side, and a Guest
// with no account joins through the invitation card on the landing. The
// match starts with the duo on team 1 (blue). A fourth player who follows
// the link during the match waits in the lobby for the next one. Then
// everyone leaves the match; once the server has reaped it (about 60 s),
// the old link brings each member back on their own side, the opener
// hosting again.
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
const sideHas = (side, name) =>
  `(document.querySelector('.menu-team.${side}')?.textContent ?? '').includes(${JSON.stringify(name)})`;
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

async function leaveViaEscape(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
  await clickButton(page, 'Leave match');
}

// The name on the reader's own row of the lobby.
const ownName = (page) =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('.menu-lobby-row')].find((r) =>
      (r.textContent ?? '').includes('(you)'),
    );
    return row?.querySelector('.menu-lobby-who')?.textContent ?? '';
  });

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

  // Host creates the lobby.
  const host = await newIsolatedPage(browser, 'hostess');
  host.on('pageerror', (e) => errors.push(`host: ${e}`));
  await host.reload({ waitUntil: 'load' });
  await waitFor(host, HOME_UP, 'host home');
  await clickTile(host, 'lobby');
  await waitFor(host, LOBBY_UP, 'host lobby code');
  const code = await host.evaluate(() => document.querySelector('.menu-code').textContent);
  const hasCopy = await host.evaluate(findBtn('Copy invite link'));
  if (!hasCopy) throw new Error('no Copy invite link button');
  console.log('host lobby up, code', code);

  // Friend arrives through the invite deep link, signed in: straight into
  // the lobby, no home screen click.
  const friend = await newIsolatedPage(browser, 'buddy');
  friend.on('pageerror', (e) => errors.push(`friend: ${e}`));
  await friend.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(friend, sideHas('red', 'buddy'), 'friend auto-joined on the red side');
  const cleaned = await friend.evaluate(() => window.location.search);
  if (cleaned !== '') throw new Error(`join query not consumed: ${cleaned}`);
  console.log('friend deep-linked into the lobby, url cleaned');

  // Friend moves to the host's side: duo vs bots.
  await friend.evaluate(() => {
    document.querySelector('.menu-team.blue button.menu-btn').click();
  });
  await waitFor(host, sideHas('blue', 'buddy'), 'host sees the friend on blue');
  console.log('friend switched to the blue side');

  // A Guest, no account: the invitation card on the landing, then Join.
  const guest = await newContextPage(browser);
  guest.on('pageerror', (e) => errors.push(`guest: ${e}`));
  await guest.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(guest, findBtn('Join the lobby'), 'the invitation card');
  const guestSearch = await guest.evaluate(() => window.location.search);
  if (guestSearch !== '') throw new Error(`join query not consumed for the Guest: ${guestSearch}`);
  await clickButton(guest, 'Join the lobby');
  await waitFor(
    guest,
    `${LOBBY_UP} && document.body.textContent.includes('(you)')`,
    'Guest in lobby',
  );
  const guestName = await ownName(guest);
  if (!guestName) throw new Error('the Guest has no row of its own');
  await waitFor(host, sideHas('red', guestName), 'host sees the Guest on red');
  console.log('Guest joined through the invitation card as', guestName);

  // Start: everyone reaches select, the duo on the same side.
  await clickButton(host, 'Start match');
  for (const [label, page] of [
    ['host', host],
    ['friend', friend],
    ['guest', guest],
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

  // Lock different champions and reach the match together. The Guest, on
  // the other side, takes the first champion its collection opens.
  await host.evaluate(() => document.querySelectorAll('button.menu-champ')[0].click());
  await clickButton(host, 'Lock in');
  await friend.evaluate(() => document.querySelectorAll('button.menu-champ')[1].click());
  await clickButton(friend, 'Lock in');
  await guest.evaluate(() => document.querySelector('button.menu-champ:not(.locked)').click());
  await clickButton(guest, 'Lock in');
  for (const [label, page] of [
    ['host', host],
    ['friend', friend],
    ['guest', guest],
  ]) {
    await waitFor(page, `!!document.querySelector('.hud')`, `${label} HUD`);
  }
  console.log('lobby match running');

  // Someone follows the link during the match: they wait in the lobby.
  const waiter = await newIsolatedPage(browser, 'latecomer');
  waiter.on('pageerror', (e) => errors.push(`waiter: ${e}`));
  await waiter.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(
    waiter,
    `document.body.textContent.includes('Your lobby is in a match. You will play the next one.')`,
    'the waiter told the lobby is in a match',
  );
  const waiterStart = await waiter.evaluate(findBtn('Start match'));
  if (waiterStart) throw new Error('the waiter can start while the lobby plays');
  console.log('a waiter waits in the lobby during the match');

  // Everyone leaves the match. Once the server reaps it (about 60 s with
  // nobody on it), the lobby is open again: the waiter, alone in it,
  // hosts for now.
  for (const page of [host, friend, guest]) await leaveViaEscape(page);
  await waitFor(waiter, findBtn('Start match'), 'the lobby open again after the reap', 120000);
  console.log('the reaped match left the lobby open');

  // The old link brings each member back on their own side, and the
  // opener hosts again.
  await host.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(host, `${LOBBY_UP} && ${sideHas('blue', 'hostess')}`, 'host back on blue');
  await friend.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(friend, sideHas('blue', 'buddy'), 'friend back on blue');
  await guest.goto(`${URL}/?join=${code}`, { waitUntil: 'load' });
  await waitFor(guest, findBtn('Join the lobby'), 'the invitation card again');
  await clickButton(guest, 'Join the lobby');
  await waitFor(guest, sideHas('red', guestName), 'Guest back on red');
  await waitFor(host, findBtn('Start match'), 'the opener hosts again');
  await waitFor(waiter, `!(${findBtn('Start match')})`, 'the waiter no longer hosts');
  console.log('the old link restored every side and the host');

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
