// E2E for a coach seat (ADR 0013) against a dev server: a fresh account
// makes a bot, queues for the classic match, seats the bot at select and
// coaches it live. Checks the coach bar is up, the controls hint is not,
// no shop opens (the bot buys its own kit), an order from the bar comes
// back in the bot's snapshot, and on a touchscreen the kill feed reads
// under the bar and the touch bar carries no Shop and no Drink. Usage:
//   URL=http://localhost:5173 CHROME=... node scripts/e2e_coach.mjs
// PHONE=1 runs at 844x390 with touch (SCHEME=tap for the tap controls);
// SHOT=path.png keeps a screenshot of the seat.
import puppeteer from 'puppeteer-core';
import { clickTile, e2eName, signIn } from './e2e_signin.mjs';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5173';
const PHONE = process.env.PHONE === '1';
const SCHEME = process.env.SCHEME === 'tap' ? 'tap' : 'thumbs';
const SHOT = process.env.SHOT ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, label, timeout = 40000, arg = null) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await (arg === null ? page.evaluate(fn) : page.evaluate(fn, arg))) return;
    await sleep(300);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

// What the bar says, for a failure that would otherwise say nothing.
const barState = (page) =>
  page.evaluate(() => document.querySelector('.coach-bar .coach-state')?.textContent ?? '');

async function clickText(page, selector, text) {
  const ok = await page.evaluate(
    (sel, t) => {
      const b = [...document.querySelectorAll(sel)].find(
        (e) => e.offsetParent !== null && (e.textContent || '').trim().startsWith(t),
      );
      b?.click();
      return Boolean(b);
    },
    selector,
    text,
  );
  if (!ok) throw new Error(`could not click "${text}"`);
}

const viewport = PHONE
  ? { width: 844, height: 390, isMobile: true, hasTouch: true }
  : { width: 1280, height: 720 };
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
    `--window-size=${viewport.width},${viewport.height}`,
  ],
  defaultViewport: viewport,
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The settings are read at boot: the touch scheme is set before the page.
  await page.evaluateOnNewDocument((scheme) => {
    const key = 'loc-settings';
    const s = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...s, touchScheme: scheme }));
  }, SCHEME);
  await page.goto(URL, { waitUntil: 'load' });
  await signIn(page, e2eName('coach', String(Date.now() % 100000)));

  // The bot, made the way the Academy's form makes it.
  const made = await page.evaluate(async () => {
    const res = await fetch('/api/bots/create', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Coachee', championId: 'torv' }),
    });
    return res.json();
  });
  if (!made.ok) throw new Error(`bot not made: ${JSON.stringify(made)}`);

  await clickTile(page, 'ranked');
  // The queue's button reads "Start now with bots", or "Join the bot match"
  // while a bot-filled match is counting down.
  const startNow = () =>
    [...document.querySelectorAll('button')].find(
      (b) => b.offsetParent !== null && /^(Start now|Join the bot match)/.test(b.textContent ?? ''),
    );
  // A match still running on the server from an earlier run takes the
  // account in as a drop-in instead of queueing it: restart the stack.
  await waitFor(page, `(${startNow})() !== undefined`, 'the queue').catch(async (e) => {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
    throw new Error(`${e.message} (a drop-in into a running match?): ${text}`);
  });
  await page.evaluate(`(${startNow})().click()`);
  await waitFor(page, () => document.querySelector('.menu-tab') !== null, 'the select tabs');
  await clickText(page, '.menu-tab', 'Your bots');
  await waitFor(page, () => document.querySelector('.menu-champ.bot') !== null, 'the bot card');
  await page.evaluate(() => document.querySelector('.menu-champ.bot')?.click());
  await clickText(page, 'button', 'Lock in');
  await waitFor(page, () => document.querySelector('.coach-bar') !== null, 'the coach bar', 60000);
  // The HUD up, and a few seconds for the opening shop that a hand seat
  // gets and a coach seat must not.
  await waitFor(page, () => document.querySelector('.hud') !== null, 'the HUD', 60000);
  await sleep(4000);
  const shopAtStart = await page.evaluate(
    () => document.querySelector('.hud-shop')?.classList.contains('open') === true,
  );
  // The shop key (game/input.ts) opens nothing either.
  if (!PHONE) {
    await page.keyboard.press('KeyP');
    await sleep(500);
  }
  const shopOnKey = await page.evaluate(
    () => document.querySelector('.hud-shop')?.classList.contains('open') === true,
  );

  const seat = await page.evaluate(() => {
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const bar = document.querySelector('.coach-bar');
    const stage = bar?.parentElement;
    return {
      bar: rect(bar),
      barClass: bar?.className ?? '',
      buttons: [...(bar?.querySelectorAll('button') ?? [])].map((b) => b.textContent),
      hints: document.querySelector('.hud-hints') !== null,
      feedTop: stage ? getComputedStyle(stage).getPropertyValue('--coach-feed-top').trim() : '',
      feed: rect(document.querySelector('.hud-feed')),
      touchBar: [...document.querySelectorAll('.touchbar-btn')].map((b) => b.textContent),
      kit: document.querySelector('.hud-slots.kit') !== null,
      // A spell not learned yet shows no + to spend a point on.
      faces: [...document.querySelectorAll('.hud-slot-cd')]
        .filter((c) => c.offsetParent !== null)
        .map((c) => c.textContent),
      ranks: [...document.querySelectorAll('.hud-slot-up')].filter((u) => u.offsetParent !== null)
        .length,
    };
  });
  console.log('seat:', JSON.stringify(seat));
  check(seat.buttons.length === 6, 'the bar carries its six orders');
  check(!seat.hints, 'no controls hint in a coach seat');
  check(!shopAtStart, 'no shop opens by itself in a coach seat');
  if (!PHONE) check(!shopOnKey, 'the shop key opens nothing in a coach seat');
  check(seat.kit, 'the spells are a kit to read in a coach seat');
  check(!seat.faces.includes('+'), `no + on a spell not learned yet (${seat.faces.join(' ')})`);
  check(seat.ranks === 0, `no level-up mark in a coach seat (${seat.ranks} shown)`);
  if (PHONE) {
    check(seat.barClass.includes(`touch ${SCHEME}`), `the bar takes the ${SCHEME} layout`);
    check(
      !seat.touchBar.includes('Shop') && !seat.touchBar.includes('Drink'),
      `the touch bar leaves the shop and the drink to the bot (${seat.touchBar.join(', ')})`,
    );
    const under = seat.bar.y + seat.bar.h;
    check(
      seat.feedTop !== '' && Number.parseFloat(seat.feedTop) >= under,
      `the feed's place (${seat.feedTop}) is under the bar (bottom ${under})`,
    );
  } else {
    check(seat.feedTop === '', 'with a mouse the feed keeps its corner');
  }

  if (SHOT) await page.screenshot({ path: SHOT });

  // An order from the bar: the bot's snapshot answers with it, and Free
  // releases it. Software WebGL draws the match at a frame or two a second
  // and the page then reads the snapshots slower than the server sends
  // them; with the tab behind another nothing is drawn and the page
  // catches up, so each answer is awaited there.
  const answered = async (re, label) => {
    const blank = await browser.newPage();
    await blank.bringToFront();
    try {
      await waitFor(
        page,
        (src) =>
          new RegExp(src).test(
            document.querySelector('.coach-bar .coach-state')?.textContent ?? '',
          ),
        label,
        90000,
        re.source,
      );
      check(true, label);
    } catch {
      check(false, `${label} (the bar says "${await barState(page)}")`);
    } finally {
      await page.bringToFront();
      await blank.close();
    }
  };
  console.log('before the order:', await barState(page));
  await clickText(page, '.coach-bar button', 'Hold');
  await answered(/^Hold:/, 'the Hold order comes back in the snapshot');
  await clickText(page, '.coach-bar button', 'Free');
  await answered(/^No order/, 'Free releases the order');
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await browser.close();
}
if (failures.length > 0) process.exit(1);
