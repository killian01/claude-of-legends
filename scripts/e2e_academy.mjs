// E2E for the Academy against a dev server (PORT from .env, Vite on 5173):
// a fresh account creates a bot, spars it, reads the line the summary
// leads with (result, kills, deaths, assists, creep score, the build as
// icons), asks the coach one thing and finds the log scrolled to the
// answer, then opens the replay and leaves it. Playtest round 3's
// complaints, each pinned by a check. Screenshots land in SHOT_DIR when
// set.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { e2eName, signIn } from './e2e_signin.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173';
const SHOT_DIR = process.env.SHOT_DIR ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The exact label first: the home screen stays in the DOM under the
// Academy overlay, and its "Create a lobby" would take a "Create" click.
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

async function waitFor(page, fnBody, label, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(300);
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

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--window-size=1500,760', '--mute-audio'],
    defaultViewport: { width: 1500, height: 760 },
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // A refused API call is the usual reason a step silently does nothing.
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 400) {
      void res
        .text()
        .then((t) => console.error(`api ${res.status()} ${res.url()}: ${t.slice(0, 200)}`));
    }
  });
  await page.goto(URL, { waitUntil: 'load' });
  await signIn(page, e2eName('acad', String(Date.now() % 1000000)));
  await waitFor(page, findBtn('Open the Academy'), 'home');
  await clickButton(page, 'Open the Academy');
  await page.waitForSelector('.ac input[placeholder="Name"]', { timeout: 20000 });
  await page.evaluate(() => {
    const input = document.querySelector('.ac input[placeholder="Name"]');
    input.value = 'Nightfall';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickButton(page, 'Create');
  try {
    await waitFor(page, findBtn('Spar vs house bots'), 'the bot is open');
  } catch (e) {
    const dump = await page.evaluate(() => ({
      status: [...document.querySelectorAll('.ac-status')].map((s) => s.textContent),
      buttons: [...document.querySelectorAll('.ac button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => (b.textContent || '').trim()),
      rail: document.querySelector('.ac-rail')?.innerText.slice(0, 300),
    }));
    console.error(JSON.stringify(dump, null, 1));
    await shot(page, 'academy-fail');
    throw e;
  }

  // The kit: the catalog's cards write the build by sight, the same item
  // twice included (the working playbook is what the sparring plays).
  await page.waitForSelector('.ic-card[data-item="warbrand"]', { timeout: 10000 });
  const roleSlots = await page.evaluate(() => document.querySelectorAll('.ic-slot').length);
  await page.evaluate(() => document.querySelector('.ic-card[data-item="warbrand"]').click());
  await sleep(200);
  await page.evaluate(() => document.querySelector('.ic-card[data-item="warbrand"]').click());
  await sleep(200);
  const kit = await page.evaluate(() => ({
    slots: document.querySelectorAll('.ic-slot').length,
    warbrands: document.querySelectorAll('.ic-slot[data-item="warbrand"]').length,
    badge: document.querySelector('.ic-card[data-item="warbrand"] .ic-count')?.textContent ?? '',
    tools: document.querySelectorAll('.ic-slot-tools').length,
  }));
  if (kit.slots !== roleSlots + 2) throw new Error(`slots: ${roleSlots} then ${kit.slots}`);
  if (kit.warbrands !== 2 || kit.badge !== 'x2')
    throw new Error(`warbrands: ${JSON.stringify(kit)}`);
  if (kit.tools !== kit.slots) throw new Error('the owner build has no tools');
  console.log('kit:', kit);
  await shot(page, 'academy-kit');

  // Sparring: the summary leads with the line.
  await clickButton(page, 'Spar vs house bots');
  await waitFor(
    page,
    `document.querySelector('.ac-line .kda') !== null`,
    'the sparring summary',
    120000,
  );
  // The Record's head in the Sparring panel: kind, result, the line, the
  // build, the way into the sheet and the replay, no Dismiss anywhere.
  const line = await page.evaluate(() => ({
    kind: document.querySelector('.ac-line .dim')?.textContent ?? '',
    verdict: document.querySelector('.ac-line .verdict')?.textContent ?? '',
    kda: document.querySelector('.ac-line .kda')?.textContent ?? '',
    cs:
      [...document.querySelectorAll('.ac-line .dim')]
        .map((e) => e.textContent)
        .find((t) => /cs$/.test(t ?? '')) ?? '',
    icons: document.querySelectorAll('.ac-side .hud-score-build img').length,
    slots: document.querySelectorAll('.ac-side .hud-score-build .slot').length,
    dismiss: [...document.querySelectorAll('.ac button')].some((b) => b.textContent === 'Dismiss'),
    rail: document.querySelector('.ac-bot.picked small')?.textContent ?? '',
  }));
  if (line.kind !== 'Sparring') throw new Error(`kind: ${line.kind}`);
  if (!/^(Won|Lost|No winner) after /.test(line.verdict))
    throw new Error(`verdict: ${line.verdict}`);
  if (!/^\d+ \/ \d+ \/ \d+$/.test(line.kda)) throw new Error(`kda: ${line.kda}`);
  if (!/^\d+ cs$/.test(line.cs)) throw new Error(`cs: ${line.cs}`);
  if (line.icons + line.slots !== 6)
    throw new Error(`build row: ${line.icons} icons, ${line.slots} slots`);
  if (line.dismiss) throw new Error('a Dismiss button survived');
  if (!/ \d+-\d+/.test(line.rail)) throw new Error(`the rail has no tally: ${line.rail}`);
  console.log(
    'summary:',
    line.verdict,
    '|',
    line.kda,
    '|',
    line.cs,
    '| icons',
    line.icons,
    '| rail',
    line.rail,
  );
  await shot(page, 'academy-summary');

  // The Record: the big view over the center and the side, the list and
  // the sheet, the deaths as links into the replay.
  await clickButton(page, 'The Record');
  await page.waitForSelector('.rv-table tr.row', { timeout: 10000 });
  await waitFor(page, `document.querySelector('.rv-sheet .rv-line') !== null`, 'the sheet', 15000);
  const rec = await page.evaluate(() => ({
    rows: document.querySelectorAll('.rv-list tr.row').length,
    tally: document.querySelector('.rv-tally')?.textContent ?? '',
    sheetRes: document.querySelector('.rv-sheet .rv-res')?.textContent ?? '',
    scoreRows: document.querySelectorAll('.rv-sheet .rv-table tr.self').length,
    sections: [...document.querySelectorAll('.rv-sheet h4')].map((h) => h.textContent),
    deathWatch: [...document.querySelectorAll('.rv-sheet button')].filter(
      (b) => b.textContent === 'Watch',
    ).length,
    mainHidden: getComputedStyle(document.querySelector('.ac-main')).display === 'none',
  }));
  console.log('record:', rec);
  if (rec.rows < 1) throw new Error('the Record lists nothing');
  if (!/^\d+ won, \d+ lost$/.test(rec.tally)) throw new Error(`tally: ${rec.tally}`);
  if (!/^(Won|Lost|No winner) after /.test(rec.sheetRes)) throw new Error(`sheet: ${rec.sheetRes}`);
  if (rec.scoreRows !== 1) throw new Error(`the bot's row is not marked once: ${rec.scoreRows}`);
  if (rec.sections.join() !== 'Scoreboard,Plays,Deaths')
    throw new Error(`sections: ${rec.sections}`);
  if (!rec.mainHidden) throw new Error('the playbook column is still shown under the Record');
  await shot(page, 'academy-record');
  // A death's Watch opens the replay a few seconds before it; the sheet's
  // own Watch otherwise.
  if (rec.deathWatch > 0) {
    await page.evaluate(() => {
      [...document.querySelectorAll('.rv-sheet button')]
        .find((b) => b.textContent === 'Watch')
        ?.click();
    });
  } else await clickButton(page, 'Watch the replay');
  await page.waitForSelector('.replay-bar', { timeout: 30000 });
  await sleep(3000);
  const clock = await page.evaluate(
    () => document.querySelector('.replay-time')?.textContent ?? '',
  );
  console.log('replay clock:', clock, rec.deathWatch > 0 ? '(opened at a death)' : '');
  await clickButton(page, 'Exit replay');
  await waitFor(page, findBtn('Spar vs house bots'), 'back in the Academy', 30000);

  // The coach: the log follows the answer to its end.
  await page.evaluate(() => {
    const input = document.querySelector('.ac-chatrow .ac-input');
    // Long enough that the log overflows its box, so the scroll check bites.
    input.value =
      'Farm safely until level six and never fight alone before that. Then look for fights ' +
      'beside an ally, join any fight within forty, and back off under the enemy tower ' +
      'when outnumbered. Take the Warden whenever it is up and the team is healthy.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickButton(page, 'Send');
  // Answered: the send button reads Send again (Asking... while it streams).
  await waitFor(
    page,
    `document.querySelectorAll('.ac-chatlog .ac-bubble.ai').length >= 1 &&
      (document.querySelector('.ac-chatrow button')?.textContent ?? '') === 'Send'`,
    'the coach answered',
    180000,
  );
  const scroll = await page.evaluate(() => {
    const log = document.querySelector('.ac-chatlog');
    return {
      top: log.scrollTop,
      client: log.clientHeight,
      height: log.scrollHeight,
      bubbles: document.querySelectorAll('.ac-bubble').length,
      last: (
        [...document.querySelectorAll('.ac-chatlog .ac-bubble.ai')].pop()?.textContent ?? ''
      ).slice(0, 80),
    };
  });
  console.log('chat:', scroll);
  if (scroll.bubbles < 2) {
    const bad = await page.evaluate(
      () => document.querySelector('.ac-status.bad')?.textContent ?? 'no error shown',
    );
    throw new Error(`the coach did not answer: ${bad}`);
  }
  if (scroll.height > scroll.client && scroll.top + scroll.client < scroll.height - 12) {
    throw new Error(`the log did not follow the answer: ${JSON.stringify(scroll)}`);
  }
  await shot(page, 'academy-coach');

  if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('e2e_academy: ok');
};

run().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
