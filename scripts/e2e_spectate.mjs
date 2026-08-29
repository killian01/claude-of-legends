// E2E for live spectating: one player runs a bot-filled match, a second
// browser finds it on the home screen's live list, watches team 1's fog,
// follows champions, and stops watching back to home on the same page.
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

  // A player starts a bot-filled match.
  const player = await newIsolatedPage(browser, 'streamer');
  player.on('pageerror', (e) => errors.push(`player: ${e}`));
  await clickButton(player, 'Play online');
  await waitFor(player, findBtn('Start now with bots'), 'queued');
  await clickButton(player, 'Start now with bots');
  await waitFor(player, findBtn('Lock in'), 'select');
  await player.evaluate(() => document.querySelector('button.menu-champ').click());
  await clickButton(player, 'Lock in');
  await waitFor(player, `!!document.querySelector('.hud')`, 'player HUD');
  console.log('live match running');

  // The live API lists it.
  const live = await (await fetch('http://localhost:8787/api/live')).json();
  if (live.length !== 1 || live[0].players[0]?.name !== 'streamer') {
    throw new Error(`bad live list: ${JSON.stringify(live)}`);
  }

  // A spectator finds it on the home screen and watches.
  const spec = await newIsolatedPage(browser, 'couch');
  spec.on('pageerror', (e) => errors.push(`spec: ${e}`));
  await spec.evaluate(() => {
    window.__lifeMarker = 'alive';
  });
  await clickButton(spec, 'Watch a live match');
  await waitFor(spec, `!!document.querySelector('.live-watch')`, 'live row shown');
  await clickButton(spec, 'Watch team 1');
  await waitFor(spec, `!!document.querySelector('.spec-bar')`, 'spectator bar');
  await waitFor(
    spec,
    `document.querySelectorAll('canvas').length >= 2`,
    'renderer and minimap canvases',
  );
  // The scene animates: two frames a second apart differ.
  const shotA = await spec.screenshot();
  await sleep(1200);
  const shotB = await spec.screenshot();
  if (Buffer.compare(Buffer.from(shotA), Buffer.from(shotB)) === 0) {
    throw new Error('spectator view is frozen');
  }
  await clickButton(spec, 'Follow next champion');
  await sleep(600);
  console.log('spectator watching, view alive, follow works');

  // Spectator count reaches the API; stopping goes home on the same page.
  const live2 = await (await fetch('http://localhost:8787/api/live')).json();
  if (live2[0]?.spectators !== 1) throw new Error('spectator not counted');
  await clickButton(spec, 'Stop watching');
  await waitFor(spec, findBtn('Play online'), 'home after stop');
  const state = await spec.evaluate(() => ({
    marker: window.__lifeMarker,
    bar: !!document.querySelector('.spec-bar'),
  }));
  if (state.marker !== 'alive' || state.bar) throw new Error('unclean spectate exit');
  const playerAlive = await player.evaluate(() => !!document.querySelector('.hud'));
  if (!playerAlive) throw new Error('player lost their match');
  console.log('stop watching returns home cleanly, player unaffected');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL SPECTATE E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
