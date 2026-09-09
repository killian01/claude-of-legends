// E2E for the Academy against a dev server (PORT from .env, Vite on 5173):
// a fresh account creates a bot, spars it, reads the line the summary
// leads with (result, kills, deaths, assists, creep score, the build as
// icons), asks the coach one thing and finds the log scrolled to the
// answer, then opens the replay and leaves it. Playtest round 3's
// complaints, each pinned by a check. Screenshots land in SHOT_DIR when
// set.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { clickBar, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// Overridable like scripts/e2e_nav.mjs: a second checkout, or a stray dev
// server, will be holding the default port.
const URL = process.env.URL ?? 'http://localhost:5173';
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
    // Software WebGL the way recent Chrome wants it asked for: plain
    // --use-gl=swiftshader is refused by newer builds and every Three.js
    // surface then throws "Error creating WebGL context", which reads like
    // a client bug (docs/dev-local.md says so; the script had not followed).
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--window-size=1500,760',
      '--mute-audio',
    ],
    defaultViewport: { width: 1500, height: 760 },
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.error('console:', m.text().slice(0, 300));
  });
  // A refused API call is the usual reason a step silently does nothing.
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 400) {
      // A body Chrome will not hand over (the 401 before sign-in, on some
      // versions) is a lost diagnostic, not a failed run.
      void res
        .text()
        .then((t) => console.error(`api ${res.status()} ${res.url()}: ${t.slice(0, 200)}`))
        .catch(() => {});
    }
  });
  await page.goto(URL, { waitUntil: 'load' });
  await signIn(page, e2eName('acad', String(Date.now() % 1000000)));
  await waitFor(page, HOME_UP, 'home');
  await clickBar(page, 'Academy');
  await page.waitForSelector('.ac input[placeholder="Name"]', { timeout: 20000 });
  await page.evaluate(() => {
    const input = document.querySelector('.ac input[placeholder="Name"]');
    input.value = 'Nightfall';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickButton(page, 'Create');
  // Created, the Academy lands on the kit step (ui/academy_steps.ts): the
  // step bar lights "The kit" and the catalog is up. The sparring step is
  // two steps on and reached by its entry in the bar.
  try {
    await waitFor(
      page,
      `document.querySelector('.ac-step.on')?.dataset.step === 'kit'`,
      'the bot is open on its kit',
    );
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

  // On to the sparring step by the bar; the coach stands beside it.
  await page.evaluate(() => document.querySelector('.ac-step[data-step="spar"]')?.click());
  await waitFor(page, findBtn('Spar vs house bots'), 'the sparring step');
  const coachBeside = await page.evaluate(
    () => document.querySelector('.ac-chatrow .ac-input') !== null,
  );
  if (!coachBeside) throw new Error('the coach is not beside the sparring step');

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
    // The sparring panel stands in the main column now, on its own step.
    icons: document.querySelectorAll('.ac-spar .hud-score-build img').length,
    slots: document.querySelectorAll('.ac-spar .hud-score-build .slot').length,
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
  // The rail's chip counts rated play alone (server/bots.ts, listBots): a
  // sparring is unrated, so a bot fresh from its first spar wears a chip
  // that names its champion and version and carries no tally at all. Both
  // halves are checked: the shape it should have, and the one it must not.
  if (!/^\S+ · v\d+/.test(line.rail)) throw new Error(`the rail chip drifted: ${line.rail}`);
  if (/ \d+-\d+/.test(line.rail)) throw new Error(`the rail counts unrated sparring: ${line.rail}`);
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
  // The head counts rated play per kind (ui/record_view.ts), rated first:
  // after a fresh bot's one unrated spar the rated tally is empty and says
  // so rather than showing a zero.
  if (!/^(no rated match yet|\d+ won, \d+ lost, rated)$/.test(rec.tally))
    throw new Error(`tally: ${rec.tally}`);
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
  const clockOf = () =>
    page.evaluate(() => document.querySelector('.replay-time')?.textContent ?? '');
  const secondsOf = (clock) => {
    const m = /^(\d+):(\d+)/.exec(clock);
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
  };
  const clock = await clockOf();
  console.log('replay clock:', clock, rec.deathWatch > 0 ? '(opened at a death)' : '');
  if (rec.deathWatch > 0 && secondsOf(clock) < 1)
    throw new Error(`not opened at the death: ${clock}`);

  // The worker's pass: the marks strip fills and the checkpoints cover the
  // match within seconds.
  try {
    await waitFor(
      page,
      `document.querySelectorAll('.replay-slice').length > 0 &&
        parseFloat(document.querySelector('.replay-covered')?.style.width || '0') >= 99`,
      'the checkpoints cover the match',
      90000,
    );
  } catch (e) {
    const dump = await page.evaluate(() => ({
      covered: document.querySelector('.replay-covered')?.style.width,
      slices: document.querySelectorAll('.replay-slice').length,
      clock: document.querySelector('.replay-time')?.textContent,
    }));
    console.error('coverage:', dump, 'page errors:', errors);
    throw e;
  }
  const strip = await page.evaluate(() => ({
    slices: document.querySelectorAll('.replay-slice').length,
    heat: document.querySelectorAll('.replay-heat').length,
    own: document.querySelectorAll('.replay-tick.own').length,
    structures: document.querySelectorAll('.replay-tick.tower, .replay-tick.sanctum').length,
    buttons: [...document.querySelectorAll('.replay-btn')].map((b) => b.textContent),
  }));
  console.log('strip:', strip);
  if (strip.heat === 0) throw new Error('no kill density on the strip');
  if (
    !strip.buttons.includes('-5s') ||
    !strip.buttons.includes('◀ 1x') ||
    !strip.buttons.includes('10x')
  ) {
    throw new Error(`bar buttons: ${strip.buttons.join(' ')}`);
  }

  // Pause, then five seconds back: instant, from a checkpoint.
  await page.keyboard.press('k');
  await sleep(300);
  const beforeText = await clockOf();
  const before = secondsOf(beforeText);
  const t0 = Date.now();
  await page.keyboard.press('ArrowLeft');
  // Wait for the CLOCK to move, not for the seeking class to go: that class
  // is added and removed by the seek itself, so polling for its absence
  // answers true before the seek has begun and then reads the old time. It
  // reported "127 -> 127 in 7 ms" here, a seek that had not happened yet,
  // which docs/dev-local.md had written down as a software-GL quirk.
  await waitFor(
    page,
    `document.querySelector('.replay-time')?.textContent !== ${JSON.stringify(beforeText)}`,
    'the seek to move the clock',
    5000,
  );
  const after = secondsOf(await clockOf());
  const seekMs = Date.now() - t0;
  console.log('seek back 5s:', before, '->', after, `in ${seekMs} ms`);
  if (after !== before - 5) throw new Error(`the seek landed at ${after}, wanted ${before - 5}`);
  if (seekMs > 1500) throw new Error(`the seek took ${seekMs} ms`);

  // A far jump on the slider lands where asked, quickly.
  const farFrom = await clockOf();
  const t1 = Date.now();
  await page.evaluate(() => {
    const s = document.querySelector('.replay-slider');
    s.value = String(Math.floor(Number(s.max) * 0.75));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The clock again, for the reason the seek above gives.
  await waitFor(
    page,
    `document.querySelector('.replay-time')?.textContent !== ${JSON.stringify(farFrom)}`,
    'the far seek to move the clock',
    5000,
  );
  const far = secondsOf(await clockOf());
  console.log('far seek:', far, `in ${Date.now() - t1} ms`);
  if (far < before) throw new Error(`the far seek landed at ${far}`);

  // Reverse playback: J walks backward, the clock decreases, K pauses.
  await page.keyboard.press('j');
  await sleep(1500);
  const backTo = secondsOf(await clockOf());
  await page.keyboard.press('k');
  await sleep(200);
  const paused = secondsOf(await clockOf());
  await sleep(700);
  const stillPaused = secondsOf(await clockOf());
  console.log('reverse:', far, '->', backTo, '| paused at', paused, stillPaused);
  if (!(backTo < far)) throw new Error(`reverse did not walk back: ${far} -> ${backTo}`);
  if (paused !== stillPaused) throw new Error('K did not pause');
  const backOn = await page.evaluate(() => document.querySelector('.replay-btn.back.on') !== null);
  if (backOn) throw new Error('a backward speed stayed lit after K');
  await page.mouse.move(750, 380);
  await shot(page, 'academy-replay');
  await clickButton(page, 'Exit replay');
  // Back in the Academy on the same bot, on the sparring step it left from.
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
