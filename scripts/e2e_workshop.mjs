// E2E for the workshop's frozen pose (plan-forge phase 4, playtest: even
// the idle sway made the weapon a moving target while aligning it). Signs
// in, opens a saved draft that carries a model, enters the workshop,
// stops the turntable, and checks that the stage keeps changing while the
// clips play, holds one frame once the pose is frozen, changes again when
// the frame slider scrubs, stays frozen across a clip switch, and resumes
// on the F key.
//
// Runs against the Vite client (E2E_URL, default :5173) over a game server;
// point E2E_URL at a server's own port to test a built dist/ instead.
// E2E_ACCOUNT names the account owning the draft, E2E_DRAFT the draft
// (it must have a built model); E2E_SHOT names a file for a picture of
// the frozen workshop.
import puppeteer from 'puppeteer-core';
import { e2eName, signIn } from './e2e_signin.mjs';

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

const findBtn = (t) =>
  `[...document.querySelectorAll('button')].some((e) => (e.textContent || '').trim().startsWith('${t}'))`;

const run = async () => {
  const draft = process.env.E2E_DRAFT;
  if (!draft) throw new Error('E2E_DRAFT names the saved draft to open (it must carry a model)');
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
    process.env.E2E_ACCOUNT ?? e2eName('shop', String(Date.now()).slice(-9)),
  );
  await waitFor(page, findBtn('Open the Forge'), 'home');
  console.log('signed in as', name);

  await clickButton(page, 'Open the Forge');
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
  await waitFor(page, findBtn('Workshop (3D view)'), 'the workshop door');
  await clickButton(page, 'Workshop (3D view)');
  await waitFor(page, `document.querySelector('.ws-stage canvas') !== null`, 'the workshop stage');
  // The model is in once a clip button of the Animations panel is picked
  // (idle plays as soon as the clips land, after the model).
  const animPanel = `[...document.querySelectorAll('.ws-panel')].find((p) => p.querySelector('h3')?.textContent === 'Animations')`;
  await waitFor(
    page,
    `document.querySelector('.ws-loading') === null && ${animPanel}?.querySelector('.ws-btn.picked') != null`,
    'the model and its clips',
    90000,
  );
  const clipCount = await page.evaluate(
    () =>
      [...document.querySelectorAll('.ws-panel')]
        .find((p) => p.querySelector('h3')?.textContent === 'Animations')
        ?.querySelectorAll('button.ws-btn').length ?? 0,
  );
  if (clipCount < 2) throw new Error(`expected at least two clips, saw ${clipCount}`);
  // The freeze lives in the Weapon panel, beside the grip tools
  // (playtest: nobody hunts under Animations while placing a weapon).
  const freezeInWeapon = await page.evaluate(() =>
    [...document.querySelectorAll('.ws-panel')]
      .find((p) => p.querySelector('h3')?.textContent === 'Weapon')
      ?.querySelector('button.ws-btn')
      ?.textContent?.startsWith('Freeze the pose'),
  );
  if (!freezeInWeapon) throw new Error('the freeze button is not first in the Weapon panel');
  console.log(`workshop open, ${clipCount} clip buttons, the freeze in the Weapon panel`);

  // The turntable sleeps after a drag on the stage, so the only motion
  // left is the clip itself.
  const stage = await page.$('.ws-stage canvas');
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy, { steps: 4 });
  await page.mouse.up();
  await sleep(300);
  const shot = async () => page.screenshot({ clip: box, encoding: 'binary' });
  const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

  const playing1 = await shot();
  await sleep(450);
  const playing2 = await shot();
  if (same(playing1, playing2))
    throw new Error('the stage did not change while the idle clip played');
  console.log('playing: the stage moves between frames');

  await clickButton(page, 'Freeze the pose');
  await waitFor(page, findBtn('Release the pose'), 'the frozen state');
  const sliderShown = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ws-slider')];
    const row = rows.find((r) => r.querySelector('label')?.textContent === 'Frame');
    return row !== undefined && !row.hidden;
  });
  if (!sliderShown) throw new Error('the frame slider did not appear once frozen');
  await sleep(300);
  const frozen1 = await shot();
  await sleep(450);
  const frozen2 = await shot();
  if (!same(frozen1, frozen2)) throw new Error('the stage kept changing while frozen');
  console.log('frozen: the stage holds one frame');

  // Scrubbing moves the pose, then it holds again.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.ws-slider')].find(
      (r) => r.querySelector('label')?.textContent === 'Frame',
    );
    const input = row.querySelector('input');
    input.value = String(Number(input.max) * 0.5);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const scrubbed1 = await shot();
  if (same(scrubbed1, frozen2)) throw new Error('scrubbing the frame slider did not move the pose');
  await sleep(450);
  const scrubbed2 = await shot();
  if (!same(scrubbed1, scrubbed2)) throw new Error('the stage kept changing after a scrub');
  console.log('scrubbed: the pose moved to the frame and holds');

  // A clip switch while frozen lands on that clip's first frame and
  // stays frozen.
  const switched = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('.ws-panel')].find(
      (p) => p.querySelector('h3')?.textContent === 'Animations',
    );
    const buttons = [...panel.querySelectorAll('button.ws-btn')].filter(
      (b) => !(b.textContent || '').includes('the pose'),
    );
    const other = buttons.find((b) => !b.classList.contains('picked'));
    if (!other) return null;
    other.click();
    return other.textContent;
  });
  if (switched === null) throw new Error('no second clip to switch to');
  await sleep(300);
  const stillFrozen = await page.evaluate(
    () =>
      [...document.querySelectorAll('button')].some(
        (b) => (b.textContent || '').trim() === 'Release the pose',
      ) && document.querySelector('.ws-btn.picked') !== null,
  );
  if (!stillFrozen) throw new Error('switching clips released the pose');
  const switched1 = await shot();
  await sleep(450);
  const switched2 = await shot();
  if (!same(switched1, switched2)) throw new Error(`the ${switched} clip played while frozen`);
  console.log(`switched to ${switched} while frozen: still holding`);
  if (process.env.E2E_SHOT) {
    await page.screenshot({ path: process.env.E2E_SHOT });
    console.log('saved', process.env.E2E_SHOT);
  }

  // F releases: the clip plays again.
  await page.keyboard.press('f');
  await waitFor(page, findBtn('Freeze the pose'), 'the released state');
  await sleep(300);
  const released1 = await shot();
  await sleep(450);
  const released2 = await shot();
  if (same(released1, released2)) throw new Error('the stage did not move again after the release');
  console.log('released with F: the clip plays again');

  if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('e2e workshop OK');
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
