// E2E for the navigation (src/game/nav.ts, ADR 0020): the browser's Back
// closes the top layer of the app instead of leaving the site, a match
// refuses it and opens the pause menu, and a reload mid-match asks first.
//
// A. home -> Ladder (address #ladder) -> Back closes the ladder, same page.
// B. Ladder -> Academy swaps the one entry: one Back is back on the tiles.
// C. Practice select -> Back leaves the select for the home, no pick.
// D. Practice match -> Back opens the pause menu, the HUD stays; Back again
//    resumes; a reload is refused (the page's own dialog, dismissed here);
//    Leave match -> home, and a further Back leaves the site (nothing open).
// E. Reload on #ladder lands back in the ladder.
import puppeteer from 'puppeteer-core';
import { clickBar, clickTile, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fnBody, label, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

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

const findBtn = (t) =>
  `[...document.querySelectorAll('button')].some((e) => (e.textContent || '').trim().startsWith('${t}'))`;
const LADDER_UP = `document.querySelector('.lp') !== null`;
const ACADEMY_UP = `document.querySelector('.ac') !== null`;
const TILES_UP = `${HOME_UP} && !document.querySelector('.pg.home.with-section')`;
const HUD_UP = `!!document.querySelector('.hud')`;
const PAUSE_UP = `[...document.querySelectorAll('.hud-overlay.open')].some((o) => (o.textContent || '').includes('Leave match'))`;

// The browser's Back, as the person presses it: waits for the app to have
// reacted (a popstate handler runs on the next task).
async function back(page) {
  await page.evaluate(() => history.back());
  await sleep(250);
}

const state = (page) =>
  page.evaluate(() => ({
    hash: location.hash,
    depth: history.state && typeof history.state.loc === 'number' ? history.state.loc : 0,
    marker: window.__navMarker,
  }));

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
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
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const dialogs = [];
  // The reload guard is the browser's own dialog; refusing it keeps the page.
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });

  // A page before the app, so that leaving the site is observable.
  await page.goto('about:blank');
  await page.goto(URL, { waitUntil: 'load' });
  await signIn(page, e2eName('nav', Date.now().toString(36).slice(-6)));
  await waitFor(page, HOME_UP, 'home');
  await page.evaluate(() => {
    window.__navMarker = 'alive';
  });

  // --- A: a section is one entry, and Back closes it ---
  await clickBar(page, 'Ladder');
  await waitFor(page, LADDER_UP, 'ladder open');
  let s = await state(page);
  if (s.hash !== '#ladder' || s.depth !== 1)
    throw new Error(`A: ladder address ${JSON.stringify(s)}`);
  await back(page);
  await waitFor(page, TILES_UP, 'tiles back after Back');
  s = await state(page);
  if (s.marker !== 'alive') throw new Error('A: the page reloaded or left');
  if (s.hash !== '' || s.depth !== 0) throw new Error(`A: root address ${JSON.stringify(s)}`);
  if (await page.evaluate(LADDER_UP)) throw new Error('A: ladder still open');

  // --- B: switching sections swaps the entry ---
  await clickBar(page, 'Ladder');
  await waitFor(page, LADDER_UP, 'ladder open again');
  await clickBar(page, 'Academy');
  await waitFor(page, ACADEMY_UP, 'academy open');
  s = await state(page);
  if (s.hash !== '#academy' || s.depth !== 1)
    throw new Error(`B: swap address ${JSON.stringify(s)}`);
  await back(page);
  await waitFor(page, TILES_UP, 'tiles after one Back from the swapped section');
  s = await state(page);
  if (s.marker !== 'alive' || s.depth !== 0) throw new Error(`B: ${JSON.stringify(s)}`);
  // The section's own Back button walks the history too: no dead entry
  // is left for the browser's Back to eat.
  await clickBar(page, 'Ladder');
  await waitFor(page, LADDER_UP, 'ladder for its own Back');
  await page.evaluate(() => document.querySelector('.lp-back').click());
  await waitFor(page, TILES_UP, 'tiles after the ladder closed itself');
  await sleep(300);
  s = await state(page);
  if (s.depth !== 0 || s.hash !== '')
    throw new Error(`B: own Back left the history at ${JSON.stringify(s)}`);

  // --- C: the practice select is a layer with a way out ---
  await clickTile(page, 'practice');
  await waitFor(page, findBtn('Lock in'), 'champion select');
  if (!(await page.evaluate(findBtn('Back')))) throw new Error('C: no Back on the practice select');
  await back(page);
  await waitFor(page, TILES_UP, 'home after Back from select');
  if (await page.evaluate(findBtn('Lock in'))) throw new Error('C: select still up');
  s = await state(page);
  if (s.marker !== 'alive' || s.depth !== 0) throw new Error(`C: ${JSON.stringify(s)}`);

  // --- D: the match is guarded ---
  await clickTile(page, 'practice');
  await waitFor(page, findBtn('Lock in'), 'champion select again');
  await page.evaluate(() => document.querySelector('button.menu-champ').click());
  await clickButton(page, 'Lock in');
  await waitFor(page, HUD_UP, 'HUD up');
  s = await state(page);
  if (s.depth !== 1) throw new Error(`D: match depth ${JSON.stringify(s)}`);
  await back(page);
  await sleep(300);
  if (!(await page.evaluate(HUD_UP))) throw new Error('D: Back left the match');
  if (!(await page.evaluate(PAUSE_UP))) throw new Error('D: Back did not open the pause menu');
  s = await state(page);
  if (s.depth !== 1 || s.marker !== 'alive')
    throw new Error(`D: entry not put back ${JSON.stringify(s)}`);
  await back(page);
  await sleep(300);
  if (await page.evaluate(PAUSE_UP)) throw new Error('D: second Back did not resume');
  if (!(await page.evaluate(HUD_UP))) throw new Error('D: second Back left the match');
  // A reload mid-match: the page asks, and dismissing keeps the match.
  try {
    await page.reload({ waitUntil: 'load', timeout: 4000 });
  } catch {
    // Expected: the dialog was dismissed, so no load ever completes.
  }
  await sleep(300);
  if (!dialogs.includes('beforeunload')) throw new Error('D: no beforeunload dialog mid-match');
  s = await state(page);
  if (s.marker !== 'alive') throw new Error('D: the reload went through');
  if (!(await page.evaluate(HUD_UP))) throw new Error('D: HUD gone after the refused reload');
  // The deliberate way out.
  await page.keyboard.press('Escape');
  await sleep(200);
  await clickButton(page, 'Leave match');
  await waitFor(page, HOME_UP, 'home after Leave match');
  await sleep(300);
  s = await state(page);
  if (s.depth !== 0) throw new Error(`D: history not back at the root ${JSON.stringify(s)}`);
  // And no guard remains: a reload now goes straight through.
  dialogs.length = 0;
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, HOME_UP, 'home after a free reload');
  if (dialogs.length > 0) throw new Error('D: the home asked before a reload');

  // --- E: the address of a section survives a reload ---
  await clickBar(page, 'Ladder');
  await waitFor(page, LADDER_UP, 'ladder before reload');
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, LADDER_UP, 'ladder reopened by its address');
  s = await state(page);
  if (s.hash !== '#ladder' || s.depth !== 1) throw new Error(`E: ${JSON.stringify(s)}`);
  await back(page);
  await waitFor(page, TILES_UP, 'tiles after Back from the reopened ladder');

  if (errors.length > 0) throw new Error(`page errors: ${errors.join('\n')}`);
  console.log('e2e_nav: OK (A section Back, B swap, C select, D guarded match, E reload address)');
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
