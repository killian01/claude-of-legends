// E2E for a forged champion's test drive (plan-forge phase 4, playtest: a
// test drive showed procedural icons over a champion whose creator had
// chosen four, opened at level 1 with R locked, and had no say on its
// sounds). Signs in, opens a saved draft in the Forge, reads the icons its
// Spells tab shows, picks a basic-attack and a cast sound and reads them
// back from the drafts route, starts the test drive, and checks that the
// HUD's Q W E R slots wear the same icon files (each loading from the
// asset route) and that the match opens at the ultimate's level.
//
// Runs against the Vite client (E2E_URL, default :5173) over a game server;
// point E2E_URL at a server's own port to test a built dist/ instead.
// E2E_ACCOUNT names the account owning the draft, E2E_DRAFT the draft;
// E2E_SHOT names a file for a picture of the HUD.
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

const run = async () => {
  const draft = process.env.E2E_DRAFT;
  if (!draft) throw new Error('E2E_DRAFT names the saved draft to drive');
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
    process.env.E2E_ACCOUNT ?? e2eName('drive', String(Date.now()).slice(-9)),
  );
  await waitFor(page, HOME_UP, 'home');
  console.log('signed in as', name);

  await clickBar(page, 'Forge');
  await waitFor(page, `document.querySelector('.fe-tabs') !== null`, 'forge editor');
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

  // What the Spells tab shows: the five slots (the passive, then Q W E R),
  // each wearing its chosen icon or none.
  await page.evaluate(() => {
    [...document.querySelectorAll('.fe-tab')]
      .find((b) => (b.textContent || '').includes('Spells'))
      ?.click();
  });
  await waitFor(page, findH3('Spells'), 'spells panel');
  await sleep(500);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.fe-slot')].map(
      (s) => s.querySelector('.fe-slot-img img')?.getAttribute('src') ?? null,
    ),
  );
  if (shown.length !== 5) throw new Error(`expected 5 slots, saw ${shown.length}`);
  const expected = { Q: shown[1], W: shown[2], E: shown[3], R: shown[4] };
  const chosen = Object.entries(expected).filter(([, src]) => src !== null);
  console.log(`${chosen.length} chosen icons on the Spells tab`);
  if (chosen.length === 0) throw new Error(`draft ${draft} has no chosen icon to check`);

  // The sounds: the basic attack's pick sits under the slots, each spell's
  // cast pick beside its animation. A pick autosaves with the def, so the
  // drafts route must read it back; then both go back to auto.
  const pickSound = async (selectIndex, value) => {
    await page.evaluate(
      (i, v) => {
        const sel = document.querySelectorAll('select.fe-sound')[i];
        if (!sel) throw new Error(`no sound select ${i}`);
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      },
      selectIndex,
      value,
    );
  };
  const savedSounds = async () => {
    const r = await page.evaluate(async (d) => {
      const res = await fetch('/api/forge/drafts', { credentials: 'same-origin' });
      const body = await res.json();
      const row = (body.drafts ?? []).find((x) => x.def.name === d);
      return row
        ? { attack: row.def.attackSound ?? null, q: row.def.abilities.Q.sound ?? null }
        : null;
    }, draft);
    return r;
  };
  const waitSaved = async (want, label) => {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const got = await savedSounds();
      if (got && got.attack === want.attack && got.q === want.q) return;
      await sleep(400);
    }
    throw new Error(
      `autosave did not carry the sounds (${label}): ${JSON.stringify(await savedSounds())}`,
    );
  };
  await page.evaluate(() => document.querySelectorAll('.fe-slot')[1].click());
  await waitFor(page, findH3('Q animation and sound'), 'the Q sound row', 5000);
  const soundSelects = await page.evaluate(
    () => document.querySelectorAll('select.fe-sound').length,
  );
  if (soundSelects !== 2)
    throw new Error(`expected the attack and the Q sound selects, saw ${soundSelects}`);
  // Picks from the wider palette (grouped options), so the server's
  // validator is shown to know them.
  await pickSound(0, 'crossbow');
  await pickSound(1, 'lich');
  await waitSaved({ attack: 'crossbow', q: 'lich' }, 'picked');
  console.log('sounds OK: the attack and Q picks autosaved with the def');
  await pickSound(0, '');
  await pickSound(1, '');
  await waitSaved({ attack: null, q: null }, 'back to auto');

  // The test drive: the practice match with the draft, its HUD wearing
  // the same files.
  await clickButton(page, 'Test drive (practice)');
  await waitFor(
    page,
    `document.querySelectorAll('.hud-slot:not(.passive)').length >= 4`,
    'the practice HUD',
    60000,
  );
  await sleep(1000);
  const worn = await page.evaluate(() =>
    [...document.querySelectorAll('.hud-slot:not(.passive)')].map((s) => s.style.backgroundImage),
  );
  const keys = ['Q', 'W', 'E', 'R'];
  for (let i = 0; i < 4; i++) {
    const want = expected[keys[i]];
    const got = worn[i] ?? '';
    if (want === null) {
      if (got.includes('/api/forge/asset/')) {
        throw new Error(`${keys[i]} has no chosen icon but the HUD wears ${got}`);
      }
      continue;
    }
    if (!got.includes(want)) {
      throw new Error(`${keys[i]}: the Spells tab shows ${want} but the HUD wears ${got}`);
    }
  }
  console.log('HUD OK: every chosen icon is on its slot');

  // The test drive opens at the ultimate's level: the badge reads 6 and R
  // is not waiting on a level.
  const level = await page.evaluate(() => document.querySelector('.hud-level')?.textContent ?? '');
  if (level !== '6') throw new Error(`the test drive opened at level ${level}, not 6`);
  const rCover = await page.evaluate(() => {
    const r = document.querySelectorAll('.hud-slot:not(.passive)')[3];
    const cd = r?.querySelector('.hud-slot-cd');
    return cd && cd.style.display !== 'none' ? cd.textContent : '';
  });
  if (/^Lv/.test(rCover)) throw new Error(`R still waits on a level: ${rCover}`);
  console.log('level OK: the test drive opens at level 6 with R on the table');

  // Each icon must actually load through the asset route: a pointer the
  // server refuses would paint an empty slot.
  const loads = await page.evaluate(
    async (srcs) => {
      const out = [];
      for (const src of srcs) {
        const r = await fetch(src, { credentials: 'same-origin' });
        out.push(`${r.status} ${r.headers.get('content-type')} ${src}`);
      }
      return out;
    },
    chosen.map(([, src]) => src),
  );
  for (const line of loads) {
    if (!/^200 image\//.test(line)) throw new Error(`icon did not load: ${line}`);
  }
  console.log('asset route OK:', loads.length, 'icons load as images');

  // The recorded sound bank is served and decodes: one attack, one cast.
  const bank = await page.evaluate(async () => {
    const ctx = new AudioContext();
    const out = [];
    for (const file of ['swing_1.ogg', 'cast_thunder_1.ogg', 'crossbow_1.ogg', 'cast_lich_1.ogg']) {
      const r = await fetch(`/sfx/${file}`);
      const type = r.headers.get('content-type');
      const buf = r.ok ? await ctx.decodeAudioData(await r.arrayBuffer()) : null;
      out.push(`${r.status} ${type} ${file} ${buf ? buf.duration.toFixed(2) : 'undecodable'}s`);
    }
    return out;
  });
  for (const line of bank) {
    if (!/^200 audio\/ogg .* \d/.test(line)) throw new Error(`sound bank: ${line}`);
  }
  console.log('sound bank OK:', bank.join(' | '));

  // For the pictures: the shop opens over the HUD at the start, and an
  // unlearned slot wears the "+" cover (forged or roster alike), so close
  // the shop and rank Q up to show its icon uncovered.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => (b.textContent || '').trim().startsWith('Close'))
      ?.click();
  });
  await sleep(300);
  await page.evaluate(() => document.querySelector('.hud-slot-up')?.click());
  await sleep(400);
  if (process.env.E2E_SHOT_FULL) {
    await page.screenshot({ path: process.env.E2E_SHOT_FULL });
    console.log('full screenshot written to', process.env.E2E_SHOT_FULL);
  }
  if (process.env.E2E_SHOT) {
    const box = await page.evaluate(() => {
      const r = document.querySelector('.hud-slots')?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    });
    if (box) {
      await page.screenshot({
        path: process.env.E2E_SHOT,
        clip: {
          x: Math.max(0, box.x - 40),
          y: Math.max(0, box.y - 40),
          width: box.w + 80,
          height: box.h + 80,
        },
      });
    } else {
      await page.screenshot({ path: process.env.E2E_SHOT });
    }
    console.log('screenshot written to', process.env.E2E_SHOT);
  }

  if (errors.length > 0) {
    throw new Error(`page errors:\n${errors.join('\n')}`);
  }
  await browser.close();
  console.log('e2e test drive OK');
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
