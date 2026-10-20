// E2E for a Thornfray in the browser (ADR 0035, docs/plan-thornfray.md slices
// 6 and 7): a Guest enters through the landing's Thornfray way in, Starts
// now from the gathering, and plays bouts on one socket and one guarded
// match layer until it has seen a Lastwick and a Starglean: each Lull's card
// names its bout, the browser's Back in a Lull
// opens the pause menu (and Back again resumes), and a fall in a Starglean
// bout raises the return globe. The champion walks out of the Thornyard in
// a Respawn bout to fall to the Dusk if no bot takes it first.
//
// Any stack will do: the released kinds open the mode.
//
//   CHROME=<chrome> URL=http://localhost:5173 node scripts/e2e_thornfray.mjs
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5173';
const W = 1280;
const H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fnBody, label, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const END_UP = `!!document.querySelector('.br-end')`;

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      `--window-size=${W},${H}`,
      '--mute-audio',
    ],
    defaultViewport: { width: W, height: H },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // How many game sockets the page opens (the server's /ws, not the dev
  // server's own): one for the whole Thornfray.
  await page.evaluateOnNewDocument(() => {
    const Native = window.WebSocket;
    window.__sockets = 0;
    window.WebSocket = class extends Native {
      constructor(url, ...rest) {
        super(url, ...rest);
        if (new URL(String(url), location.href).pathname === '/ws') window.__sockets += 1;
      }
    };
  });
  // What the page showed, recorded by the page itself as the HUD writes it:
  // software WebGL draws a frame or two a second, and a poll from outside
  // can miss a whole Lull. Its top line names the bout coming through the
  // whole Lull ("Starglean · Bout 2 of 6"); its card names it too; the
  // wait's globe is the death wash's 'returning'. The first card seen
  // presses the browser's Back at once, as a person would, and Back again
  // once the pause menu is up: the Lull's ten seconds hold both.
  await page.evaluateOnNewDocument(() => {
    window.__tf = { lulls: [], cards: [], globe: false, back: 'none' };
    const pauseUp = () =>
      [...document.querySelectorAll('.hud-overlay.open')].some((o) =>
        (o.textContent || '').includes('Leave match'),
      );
    const note = () => {
      const tf = window.__tf;
      const count = document.querySelector('.br-count')?.textContent ?? '';
      const lull = /^(\w+) · (Bout \d of 6|the Final)/.exec(count);
      if (lull && !tf.lulls.includes(lull[1])) tf.lulls.push(lull[1]);
      const card = document.querySelector('.lull:not([hidden]) .lull-title b')?.textContent;
      if (card && !tf.cards.includes(card)) tf.cards.push(card);
      if (document.querySelector('.hud-overlay.returning')) tf.globe = true;
      if (card && tf.back === 'none') {
        tf.back = 'pressed';
        history.back();
      } else if (tf.back === 'pressed' && pauseUp()) {
        tf.back = 'paused';
        history.back();
      } else if (tf.back === 'paused' && !pauseUp()) {
        tf.back = document.querySelector('.hud.thornfray') ? 'resumed' : 'left';
      }
    };
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(note).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    });
  });
  page.on('dialog', (d) => void d.dismiss());

  await page.goto(URL, { waitUntil: 'load' });
  await waitFor(page, `!!document.querySelector('.pg-way[data-way="thornfray"]')`, 'the way in');
  await page.evaluate(() => document.querySelector('.pg-way[data-way="thornfray"]').click());
  await waitFor(page, `!!document.querySelector('.br-pick-play')`, 'the quick pick');
  if (await page.evaluate(`!!document.querySelector('.br-pick-crew')`)) {
    throw new Error('the quick pick shows a Crew row in a Thornfray');
  }
  await page.evaluate(() => document.querySelector('.br-pick-play').click());
  await waitFor(
    page,
    `[...document.querySelectorAll('.tf-gather button')].some((b) => b.textContent.trim() === 'Start now' && !b.hidden)`,
    'the gathering and its Start now',
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('.tf-gather button')]
      .find((b) => b.textContent.trim() === 'Start now')
      .click(),
  );
  await waitFor(page, `!!document.querySelector('.hud.thornfray')`, 'the match', 180000);

  // Bout by bout, until a Lastwick and a Starglean were both played and a
  // fall in a Starglean raised the globe.
  let seen = { lulls: [], cards: [], globe: false, back: 'none' };
  const t0 = Date.now();
  while (Date.now() - t0 < 9 * 60 * 1000) {
    if (await page.evaluate(END_UP)) break;
    const now = await page.evaluate(() => ({
      count: document.querySelector('.br-count')?.textContent ?? '',
      tf: window.__tf,
    }));
    for (const kind of now.tf.lulls) {
      if (!seen.lulls.includes(kind)) console.log(`a Lull before a ${kind}`);
    }
    for (const card of now.tf.cards) {
      if (!seen.cards.includes(card)) console.log(`its card: ${card}`);
    }
    if (now.tf.globe && !seen.globe) console.log('a fall in Starglean: the return globe');
    if (now.tf.back !== seen.back) console.log(`Back in a Lull: ${now.tf.back}`);
    seen = now.tf;
    const backInLull = seen.back === 'resumed';
    const lull = /^(\w+) · (Bout \d of 6|the Final)/.test(now.count);
    if (now.count.startsWith('Starglean ·') && !lull && !seen.globe) {
      // Walk toward the screen's edge, out of the light, to fall.
      await page.mouse.click(W / 2, H - 200);
    }
    const both = seen.lulls.includes('Lastwick') && seen.lulls.includes('Starglean');
    if (both && backInLull && seen.globe) break;
    await sleep(500);
  }
  if (!seen.lulls.includes('Lastwick') || !seen.lulls.includes('Starglean')) {
    throw new Error(`saw the Lulls of ${seen.lulls.join(', ') || 'no bout'}, not both kinds`);
  }
  if (seen.back !== 'resumed') throw new Error(`Back in a Lull ended ${seen.back}`);
  if (!seen.globe) throw new Error('no return globe after a fall in Starglean');
  const sockets = await page.evaluate(() => window.__sockets);
  if (sockets !== 1) throw new Error(`the Thornfray opened ${sockets} sockets, not one`);

  // The deliberate way out.
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => (b.textContent || '').trim().startsWith('Leave match'))
      ?.click(),
  );
  await waitFor(page, `!document.querySelector('.hud')`, 'the match left');

  if (errors.length > 0) throw new Error(`page errors: ${errors.join('\n')}`);
  console.log('e2e_thornfray: OK (two kinds on one socket, Back in a Lull, the return globe)');
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
