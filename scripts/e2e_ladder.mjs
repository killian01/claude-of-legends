// E2E for the ladder page (docs/design/ladder.md) against a dev server
// (PORT from .env, Vite on 5173): a fresh account reads its place on the
// home card, opens the page, walks the four tabs, finds its own unplaced
// place and the queue button on each, opens the Arena pool, and leaves
// by Back. The page's API is checked from inside the page too: every way
// answers, an unknown way is refused, the home card's route names the
// four ways. Screenshots land in SHOT_DIR when set.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { apiFromPage, e2eName, signIn } from './e2e_signin.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.E2E_URL ?? 'http://localhost:5173';
const SHOT_DIR = process.env.SHOT_DIR ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const visible = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null);
    const label = (e) => (e.textContent || '').trim();
    const b = visible.find((e) => label(e) === t) ?? visible.find((e) => label(e).startsWith(t));
    if (!b) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`button not found: ${text}`);
}

async function waitFor(page, fnBody, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const findBtn = (t) =>
  `[...document.querySelectorAll('button')].some((e) => e.offsetParent !== null && (e.textContent || '').trim().startsWith('${t}'))`;

async function shot(page, name) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

function check(cond, what) {
  if (!cond) throw new Error(`check failed: ${what}`);
  console.log(`ok: ${what}`);
}

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--window-size=1500,860', '--mute-audio'],
    defaultViewport: { width: 1500, height: 860 },
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await signIn(page, e2eName('ladder', Date.now().toString(36).slice(-6)));

  // The home card: your place by hand, unplaced on a fresh account.
  await waitFor(page, findBtn('Open the ladder'), 'the ladder card');
  await waitFor(page, `document.querySelector('.lc-rank') !== null`, 'the place on the card');
  const card = await page.evaluate(() => ({
    tier: document.querySelector('.lc-tier')?.textContent ?? '',
    rank: document.querySelector('.lc-rank')?.textContent ?? '',
    emblem: document.querySelector('.lc .te') !== null,
  }));
  check(card.tier === 'Regular', `the card says the tier (${card.tier})`);
  check(card.rank.startsWith('Unplaced'), `the card says unplaced (${card.rank})`);
  check(card.emblem, 'the card draws the emblem');
  await shot(page, 'ladder_card');

  // The API from inside the page.
  for (const way of ['hand', 'bot', 'arena', 'forge']) {
    const r = await apiFromPage(page, `/api/ladder/page?way=${way}`);
    check(
      r.status === 200 && r.body.way === way && r.body.me !== undefined,
      `/api/ladder/page answers ${way}`,
    );
  }
  const bad = await apiFromPage(page, '/api/ladder/page?way=nope');
  check(bad.status === 400, 'an unknown way is refused');
  const mine = await apiFromPage(page, '/api/ladder/mine');
  check(
    mine.status === 200 && ['hand', 'bot', 'arena', 'forge'].every((w) => mine.body[w]),
    '/api/ladder/mine names the four ways',
  );

  // The page: four tabs, your place and the button on each.
  await clickButton(page, 'Open the ladder');
  await waitFor(page, `document.querySelector('.lp-you') !== null`, 'the ladder page');
  const expectations = {
    'By hand': 'Play online',
    'Bots, live': 'Open the Academy',
    Arena: 'Open the Academy',
    Forge: 'Forge queue',
  };
  for (const [tab, cta] of Object.entries(expectations)) {
    await page.evaluate((t) => {
      [...document.querySelectorAll('.lp-tab')].find((b) => b.textContent === t)?.click();
    }, tab);
    await waitFor(
      page,
      `document.querySelector('.lp-tab.on')?.textContent === ${JSON.stringify(tab)} && document.querySelector('.lp-you') !== null && [...document.querySelectorAll('.lp-cta button')].some((b) => (b.textContent || '').startsWith(${JSON.stringify(cta)}))`,
      `the ${tab} tab with its button`,
    );
    const you = await page.evaluate(() => ({
      tier: document.querySelector('.lp-tier-name')?.textContent ?? '',
      rating: document.querySelector('.lp-you-rating')?.textContent ?? '',
      place: document.querySelector('.lp-you-line b')?.textContent ?? '',
      bar: document.querySelector('.lp-bar i') !== null,
      emblem: document.querySelector('.lp-you .te') !== null,
      pool: document.querySelector('.lb-pool') !== null,
    }));
    check(you.tier === 'Regular' && you.rating === '1000', `${tab}: the place reads Regular 1000`);
    check(you.place.startsWith('Unplaced'), `${tab}: unplaced (${you.place})`);
    check(you.bar && you.emblem, `${tab}: the climb bar and the emblem`);
    if (tab === 'Arena') check(you.pool, 'the Arena tab shows the pool');
    await shot(page, `ladder_${tab.replace(/[^a-z]/gi, '').toLowerCase()}`);
  }

  await clickButton(page, 'Back');
  await waitFor(page, `document.querySelector('.lp') === null`, 'the page closed');
  await waitFor(page, findBtn('Open the ladder'), 'home again');
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  console.log('PASS');
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
