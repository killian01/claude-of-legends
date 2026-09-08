// E2E for the language's phase 16 kinds in the Academy's editor, against a
// dev server (PORT from .env, Vite on 5173): a fresh account creates a bot,
// adds a play, finds the new triggers and behaviors in the editor's menus
// (the odds, the minions, the threatened tower; the fight's commit, the
// farm's mode, the wave management, the collapse), sets the play to freeze
// the wave and reads it back in words, and sees the save go through the
// server's validator (format version 4) without a refusal. Screenshots
// land in SHOT_DIR when set.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { clickBar, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173';
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

// Set the editor's kind select for the trigger or the behavior the way a
// person would, so the editor's change handler runs. The kind selects are
// told apart from a form's choice selects by an option every one of them
// has (always, retreat).
async function choose(page, which, value) {
  const ok = await page.evaluate(
    (w, v) => {
      const marker = w === 'behavior' ? 'retreat' : 'always';
      const s = [...document.querySelectorAll('.ac-editor select')].find((el) =>
        [...el.options].some((o) => o.value === marker),
      );
      if (!s) return false;
      s.value = v;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    which,
    value,
  );
  if (!ok) throw new Error(`${which} select not found`);
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
  const refused = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 400) {
      void res
        .text()
        .then((t) => refused.push(`${res.status()} ${res.url()}: ${t.slice(0, 200)}`))
        .catch(() => {});
    }
  });
  await page.goto(URL, { waitUntil: 'load' });
  await signIn(page, e2eName('wave', String(Date.now() % 1000000)));
  await waitFor(page, HOME_UP, 'home');
  await clickBar(page, 'Academy');
  await page.waitForSelector('.ac input[placeholder="Name"]', { timeout: 20000 });
  await page.evaluate(() => {
    const input = document.querySelector('.ac input[placeholder="Name"]');
    input.value = 'Frostline';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickButton(page, 'Create');
  await waitFor(page, findBtn('Spar vs house bots'), 'the bot is open');

  // A new play opens its editor: the When select, then the Do select.
  await clickButton(page, '+ Add a play');
  await page.waitForSelector('.ac-editor select', { timeout: 10000 });
  const menus = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('.ac-editor select')];
    const opts = (s) => [...s.options].map((o) => `${o.value}=${o.textContent}`);
    return { when: opts(sels[0]), do: opts(sels[sels.length - 1]) };
  });
  const need = (list, value, label) => {
    const hit = list.find((o) => o.startsWith(`${value}=`));
    if (!hit) throw new Error(`menu lacks ${value}: ${list.join(' | ')}`);
    if (!hit.includes(label)) throw new Error(`${value} reads "${hit}", wanted "${label}"`);
  };
  need(menus.when, 'odds', 'the odds of the fight');
  need(menus.when, 'minions', 'minions near');
  need(menus.when, 'towerThreatened', 'an allied tower is under threat');
  need(menus.do, 'manageWave', 'manage the wave');
  need(menus.do, 'defendTower', 'collapse on a threatened tower');
  need(menus.do, 'farm', 'farm the wave');
  console.log('menus: the seven new kinds are offered');

  // Freeze the wave after ten minutes: the words come back on the row.
  await choose(page, 'behavior', 'manageWave');
  await sleep(300);
  await choose(page, 'trigger', 'time');
  await sleep(300);
  const words = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.ac-play-text')].map((e) => e.textContent ?? '');
    return texts[texts.length - 1] ?? '';
  });
  if (!words.includes('freeze the wave in front of my tower')) {
    throw new Error(`the play reads: ${words}`);
  }
  console.log('play:', words);
  await shot(page, 'academy-wave');

  // The fight's commit field is on the fight form.
  await choose(page, 'behavior', 'fight');
  await sleep(300);
  const commit = await page.evaluate(() =>
    [...document.querySelectorAll('.ac-editor .ac-field span')].some((s) =>
      (s.textContent ?? '').startsWith('walk in only when the odds'),
    ),
  );
  if (!commit) throw new Error('the fight form has no commit field');
  console.log('fight: the commit field is there');

  // The autosave went through the server (format version 4 accepted).
  await sleep(2500);
  if (refused.length > 0) throw new Error(`api refused: ${refused.join('; ')}`);
  if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
  console.log('saved: no refusal from the server');
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
