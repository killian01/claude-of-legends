// E2E for the Forge editor's Spells tab: a fresh account opens the Forge,
// walks the five slots (the passive, then Q W E R), and every click brings
// that slot's parameters (and, for a spell, its animation pick) up. Then
// the power dial moves a spell and every amount it wrote reads on its step:
// whole damage, hundredth ratios, tick durations, never a tail of decimals.
//
// Runs against the Vite client (E2E_URL, default :5173) over a game server;
// point E2E_URL at a server's own port to test a built dist/ instead.
import puppeteer from 'puppeteer-core';
import { clickBar, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.E2E_URL ?? 'http://localhost:5173';
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

async function waitFor(page, fnBody, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const findH3 = (t) =>
  `[...document.querySelectorAll('h3')].some((e) => (e.textContent || '').trim() === '${t}')`;

// Three or more decimals anywhere in a text: what the creator must never
// read on a spell.
const LONG_TAIL = /\d\.\d{3,}/;

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--window-size=1500,1000', '--mute-audio'],
    defaultViewport: { width: 1500, height: 1000 },
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // The landing page asks /api/me before anyone is signed in (401), and
    // signing in tries to register the name first (409 when it exists):
    // both are the wall working, not page errors.
    if (m.type() === 'error' && !/\b(401|409)\b/.test(m.text())) {
      errors.push(`console: ${m.text()}`);
    }
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.status() !== 401 && r.status() !== 409) {
      errors.push(`response ${r.status()} ${r.url()}`);
    }
  });
  await page.goto(URL, { waitUntil: 'load' });
  const name = await signIn(
    page,
    process.env.E2E_ACCOUNT ?? e2eName('forge', String(Date.now()).slice(-9)),
  );
  await waitFor(page, HOME_UP, 'home');
  console.log('signed in as', name);

  await clickBar(page, 'Forge');
  await waitFor(page, `document.querySelector('.fe-tabs') !== null`, 'forge editor');
  // E2E_DRAFT names a saved draft to open from the rail instead of the
  // fresh one: the tab is then walked with real art and history behind it.
  const draft = process.env.E2E_DRAFT;
  if (draft) {
    await waitFor(
      page,
      `[...document.querySelectorAll('.fe-draft')].some((b) => (b.textContent || '').includes('${draft}'))`,
      `draft ${draft} in the rail`,
    );
    await page.evaluate((d) => {
      [...document.querySelectorAll('.fe-draft')]
        .find((b) => (b.textContent || '').includes(d))
        ?.click();
    }, draft);
    await sleep(800);
    const opened = await page.evaluate(
      () => document.querySelector('.fe-draft.picked')?.textContent ?? '',
    );
    if (!opened.includes(draft)) throw new Error(`draft ${draft} not picked: ${opened}`);
    console.log('opened draft', draft);
  }
  await page.evaluate(() => {
    [...document.querySelectorAll('.fe-tab')]
      .find((b) => (b.textContent || '').includes('Spells'))
      ?.click();
  });
  await waitFor(page, findH3('Spells'), 'spells panel');
  const slotCount = await page.evaluate(() => document.querySelectorAll('.fe-slot').length);
  if (slotCount !== 5) throw new Error(`expected 5 slots, saw ${slotCount}`);
  const icons = await page.evaluate(() => document.querySelectorAll('.fe-slot-img img').length);
  console.log(`${icons} slots wear a generated icon`);
  if (draft && process.env.E2E_ICONS && icons !== Number(process.env.E2E_ICONS)) {
    throw new Error(`expected ${process.env.E2E_ICONS} icons on ${draft}, saw ${icons}`);
  }

  // Every slot in turn, out of order on purpose: each click must bring
  // its own panels up and light its own slot.
  const order = [
    ['W', 2],
    ['R', 4],
    ['P', 0],
    ['E', 3],
    ['Q', 1],
  ];
  for (const [key, index] of order) {
    await page.evaluate((i) => document.querySelectorAll('.fe-slot')[i].click(), index);
    await waitFor(page, findH3(`Parameters (${key})`), `parameters of ${key}`, 5000);
    if (key !== 'P')
      await waitFor(page, findH3(`${key} animation and sound`), `animation of ${key}`, 5000);
    const lit = await page.evaluate(() =>
      [...document.querySelectorAll('.fe-slot')].findIndex((s) => s.classList.contains('on')),
    );
    if (lit !== index) throw new Error(`slot ${key} clicked but slot ${lit} is lit`);
    const panels = await page.evaluate(
      () =>
        [...document.querySelectorAll('h3')].filter((h) =>
          /^Parameters \(/.test(h.textContent || ''),
        ).length,
    );
    if (panels !== 1) throw new Error(`${panels} parameter panels up after clicking ${key}`);
  }
  console.log('slot switching OK: five slots, each brings its own parameters and animation');

  // The key tabs beside the panel titles switch too, from the parameters
  // panel and from the animation panel alike (the passive has no
  // animation panel, so the step after P starts from its parameters),
  // and the slot row follows. Ends on Q for the dial below.
  for (const [key, index, panel] of [
    ['E', 3, 'Parameters ('],
    ['W', 2, ' animation'],
    ['P', 0, 'Parameters ('],
    ['R', 4, 'Parameters ('],
    ['Q', 1, ' animation'],
  ]) {
    const ok = await page.evaluate(
      (k, p) => {
        const h = [...document.querySelectorAll('h3')].find((e) =>
          (e.textContent || '').includes(p),
        );
        const tab = [...(h?.parentElement?.querySelectorAll('.fe-keytab') ?? [])].find(
          (b) => b.textContent === k,
        );
        if (!tab) return false;
        tab.click();
        return true;
      },
      key,
      panel,
    );
    if (!ok) throw new Error(`no ${key} key tab in the ${panel.trim()} panel`);
    await waitFor(page, findH3(`Parameters (${key})`), `parameters of ${key} via key tab`, 5000);
    const lit = await page.evaluate(() =>
      [...document.querySelectorAll('.fe-slot')].findIndex((s) => s.classList.contains('on')),
    );
    if (lit !== index) throw new Error(`key tab ${key} clicked but slot ${lit} is lit`);
  }
  console.log('key tabs OK: the parameters and animation panels switch spells in place');
  // E2E_SHOT names a file for a picture of the parameters panel with its
  // key tabs, the animation panel below it: the PR's before/after.
  if (process.env.E2E_SHOT) {
    await page.evaluate(() => {
      [...document.querySelectorAll('h3')]
        .find((h) => (h.textContent || '').startsWith('Parameters ('))
        ?.scrollIntoView({ block: 'start' });
    });
    await sleep(300);
    await page.screenshot({ path: process.env.E2E_SHOT });
    console.log('screenshot written to', process.env.E2E_SHOT);
  }

  // The dial on Q at an awkward factor: the description and the advanced
  // fields must read on their steps.
  await page.evaluate(() => {
    const dial = document.querySelector('input.fe-dial');
    dial.value = '137';
    dial.dispatchEvent(new Event('input', { bubbles: true }));
    dial.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(200);
  const desc = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((e) => e.textContent === 'Parameters (Q)');
    return h?.parentElement?.querySelector('.fe-desc')?.textContent ?? '';
  });
  if (!desc) throw new Error('no Q description after the dial');
  if (LONG_TAIL.test(desc)) throw new Error(`long decimals in the Q description: ${desc}`);
  await page.evaluate(() => {
    const d = document.querySelector('details.fe-advanced');
    d.open = true;
    d.dispatchEvent(new Event('toggle'));
  });
  await sleep(200);
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('details.fe-advanced input.fe-num')].map((i) => i.value),
  );
  if (values.length === 0) throw new Error('advanced editor shows no number fields');
  const tails = values.filter((v) => LONG_TAIL.test(v));
  if (tails.length > 0) throw new Error(`long decimals in advanced fields: ${tails.join(', ')}`);
  console.log(`dial OK: description and ${values.length} advanced fields read on their steps`);
  console.log('Q reads:', desc.slice(0, 160));

  // A dead session, met the way a playtest met it: the cookie goes away
  // under an open editor, and Save is pressed. The banner must say so in
  // plain sight, and nothing shown may vanish (the slots keep their
  // icons, the rail its drafts).
  const iconsBefore = await page.evaluate(
    () => document.querySelectorAll('.fe-slot-img img').length,
  );
  const draftsBefore = await page.evaluate(() => document.querySelectorAll('.fe-draft').length);
  const cookies = await ctx.cookies();
  await ctx.deleteCookie(...cookies.filter((c) => c.name === 'loc_session'));
  await clickButton(page, 'Save now');
  await waitFor(
    page,
    `(() => { const a = document.querySelector('.fe-alert'); return !!a && !a.hidden && a.textContent.includes('session has ended'); })()`,
    'the session banner',
    5000,
  );
  await page.evaluate(() => {
    document.querySelectorAll('.fe-draft')[0]?.click();
  });
  await sleep(600);
  const iconsAfter = await page.evaluate(
    () => document.querySelectorAll('.fe-slot-img img').length,
  );
  const draftsAfter = await page.evaluate(() => document.querySelectorAll('.fe-draft').length);
  if (iconsAfter !== iconsBefore || draftsAfter !== draftsBefore) {
    throw new Error(
      `a dead session emptied the editor: icons ${iconsBefore} to ${iconsAfter}, drafts ${draftsBefore} to ${draftsAfter}`,
    );
  }
  console.log('dead session OK: the banner says so and nothing shown vanished');

  if (errors.length > 0) {
    console.log('PAGE ERRORS:', errors.join('\n'));
    throw new Error('page errors occurred');
  }
  console.log('ALL FORGE E2E PASSED');
  await browser.close();
};

run().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
