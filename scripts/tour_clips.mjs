// Film the tour: a short passage of each surface, for a launch post. One
// fight says the game exists; the champions, the Forge and the Academy
// together say what it is, which is the part that reads as impossible in
// the time it took.
//
// Every scene moves while it records. A still screen is a screenshot, and
// a screenshot inside a video is worse than a screenshot.
//
// Runs against a dev stack. Start the server with GENERATION_PROVIDER=mock
// and no ANTHROPIC_API_KEY: nothing here calls a vendor, and that is how
// it has to stay when a scene is added.
//
//   TOUR_URL=http://localhost:5199 node scripts/tour_clips.mjs [scene...]
//
// With no names it walks every scene. TOUR_DIR takes the frames (default
// tour/), one folder per scene plus a still of each. TOUR_PROBE=1 takes
// only the still, which is how a new scene gets written in the first place.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { clickBar, e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const URL = process.env.TOUR_URL ?? 'http://localhost:5199';
const OUT = process.env.TOUR_DIR ?? 'tour';
const PROBE = process.env.TOUR_PROBE === '1';
const CHROME =
  process.env.CHROME ?? '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How the 3D gets rasterised, since there is no GPU on a server. Measured
// here on the workshop, which is the heaviest scene: SwiftShader manages
// 0.6 frames a second on a rigged character, Mesa's llvmpipe through
// ANGLE's Vulkan backend does several times better on the same machine.
// Neither is a substitute for filming the 3D somewhere with a GPU; this is
// the difference between a slideshow and something worth looking at while
// deciding what to film properly.
const GL = {
  // On a machine with a graphics card, say nothing and let Chrome use it.
  // This is the default because the only reason to film the tour is to
  // film it well, and that means filming it somewhere with a GPU.
  auto: [],
  // On a server: ANGLE's Vulkan backend reaches Mesa's llvmpipe, which is
  // twice SwiftShader here and still not enough for the 3D passages.
  vulkan: [
    '--use-angle=vulkan',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
  ],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const gl = GL[process.env.TOUR_GL ?? 'auto'] ?? GL.auto;
const [sw, sh] = (process.env.TOUR_SIZE ?? '1280x720').split('x').map(Number);
const size = { width: sw || 1280, height: sh || 720 };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  // TOUR_HEADFUL=1 opens a real window. Worth it when a driver only
  // gives its best to something on screen, and worth it once anyway to
  // watch a new scene walk itself.
  headless: process.env.TOUR_HEADFUL !== '1',
  args: ['--no-sandbox', ...gl],
  // TOUR_SIZE is for framing, not for speed. Measured on the workshop, the
  // heaviest scene: 1280x720 gave 25 frames in twenty seconds and 800x450
  // gave 26. A software rasteriser running a rigged character is spending
  // its time on skinning and geometry, not on pixels, so there is nothing
  // to buy back by shrinking the window.
  defaultViewport: size,
});
const page = await browser.newPage();

async function clickText(text, selector = 'button') {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) =>
        (e.textContent || '').trim().startsWith(t),
      );
      if (!el) return false;
      el.click();
      return true;
    },
    selector,
    text,
  );
  if (!ok) throw new Error(`nothing to click saying "${text}"`);
  return ok;
}

async function type(selector, value) {
  await page.evaluate(
    (sel, v) => {
      const input = document.querySelector(sel);
      if (!input) throw new Error(`no field ${sel}`);
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value,
  );
}

// The account this runs as has an unconfirmed address, so the home wears a
// notice about it. True, and nobody's business in a clip about the game.
async function tidy() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.mail-note, .replay-bar, .hud-hints')) {
      el.style.display = 'none';
    }
  });
}

// Back to the home screen, whatever the last scene left up.
async function home() {
  for (let i = 0; i < 3; i++) {
    const there = await page.evaluate(() => document.querySelector('.pg.home .tile') !== null);
    if (there) break;
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((e) =>
        /^(Back|Close|Exit|Leave|Cancel)/.test((e.textContent || '').trim()),
      );
      b?.click();
    });
    await sleep(700);
  }
  await page.waitForFunction(HOME_UP, { timeout: 15000 });
  await sleep(400);
  await tidy();
}

// A surface off the home bar. The tiles beside them are queues, not the
// surfaces themselves: the Forge tile queues a forged champion into a
// match, the Forge is up here.
async function open(label) {
  await home();
  await clickBar(page, label);
  await sleep(2200);
  await tidy();
}

const scenes = {
  // The hub, and the five ways in, read top to bottom.
  home: {
    seconds: 7,
    open: () => home(),
    async act() {
      // The screencast only emits a frame when something repaints, and a
      // home screen at rest never does: the first pass of this scene
      // produced one frame for seven seconds. Moving the pointer across
      // the tiles lights their hover states, which is both a repaint and
      // the thing a visitor actually does here.
      const spots = await page.evaluate(() =>
        [...document.querySelectorAll('.pg.home .tile')].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }),
      );
      for (const spot of spots) {
        await page.mouse.move(spot.x, spot.y, { steps: 24 });
        await sleep(900);
      }
    },
  },

  // Ten champions, every one with a full kit. The art is the argument
  // here, so the passage is card after card and the kit that comes up
  // with each: nothing is a placeholder, and the panel proves it.
  champions: {
    seconds: 11,
    open: () => open('Champions'),
    async act() {
      for (const name of ['Sylra', 'Vesk', 'Rhoka', 'Dain']) {
        await sleep(2100);
        await clickText(name, 'button').catch(() => {});
      }
    },
  },

  // The Forge, which is the sentence that makes people click: a champion
  // of your own, kit and all. Three tabs, with the power budget standing
  // beside them, because the numbers are the part nobody expects to be
  // real.
  forge: {
    seconds: 13,
    open: () => open('Forge'),
    async act() {
      await sleep(3000);
      await clickText('2. Spells');
      await sleep(4200);
      await clickText('3. Tuning');
      await sleep(3500);
    },
  },

  // A bot is written, not coded: a name, a champion, and it arrives with
  // a play list you edit. The passage is the whole of that.
  academy: {
    seconds: 13,
    open: () => open('Academy'),
    async act() {
      await sleep(1400);
      // Scoped to the Academy's own classes: the home screen stays in the
      // DOM underneath, and its join-code field is an input too. The first
      // pass typed into that one and filmed a form that never filled.
      await type('input.ac-input', 'Wildclaw');
      await sleep(1200);
      await page.evaluate(() => {
        const sel = document.querySelector('select.ac-select');
        if (!sel) return;
        sel.selectedIndex = Math.min(3, sel.options.length - 1);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(1400);
      await clickText('Create', 'button.ac-btn');
      await sleep(4000);
      await page.evaluate(() => window.scrollTo({ top: 320, behavior: 'smooth' }));
      await sleep(2500);
    },
  },

  // A champion that was actually forged, standing in the workshop and
  // running its clips. This is the passage that proves the Forge is not a
  // form: there is a rigged model on the stage and it moves.
  //
  // It needs a draft that carries a built model, which a fresh data dir
  // does not have. Point DATA_DIR at a copy of one that does; never at the
  // live one, since this scene signs in and the server writes.
  workshop: {
    seconds: 20,
    async open() {
      await home();
      await clickBar(page, 'Forge');
      await sleep(2200);
      // The first draft in the list, by the badge every draft carries
      // rather than by a name only this data dir has.
      const opened = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((e) =>
          /draft$/i.test((e.textContent || '').trim()),
        );
        if (!b) return false;
        b.click();
        return true;
      });
      if (!opened) throw new Error('no draft in the Forge to open');
      await sleep(2600);
      await clickText('Workshop (3D view)');
      // The model, its rig and its clips are megabytes over the wire and
      // then have to be uploaded to the GPU. Nine seconds is what it takes
      // here; a slower machine simply films a bit of the loading.
      await sleep(9000);
      await tidy();
    },
    async act() {
      // Idle last, so the passage ends on the champion breathing rather
      // than face down.
      for (const clip of ['Run', 'Attack', 'Cast', 'Death', 'Idle']) {
        await clickText(clip, '.ws button').catch(() => {});
        await sleep(3400);
      }
    },
  },

  // The forged champions other people made, which is what says this is a
  // place rather than a demo. Empty on a fresh data dir.
  gallery: {
    seconds: 7,
    open: () => open('Gallery'),
    async act() {
      await sleep(2500);
      await clickText('Popular').catch(() => {});
      await sleep(2500);
    },
  },

  // Where a bot's rating lands (ADR 0013): the ladder is the reason to
  // write a better one.
  ladder: {
    seconds: 8,
    open: () => open('Ladder'),
    async act() {
      await sleep(2600);
      await clickText('Bots, live').catch(() => {});
      await sleep(2600);
    },
  },
};

// What was filmed, for scripts/tour_montage.mjs: the screencast hands back
// whatever frames it managed, so the only way to play a passage at the
// speed it happened is to record how many frames covered how long.
// Merged with whatever is already on disk rather than replacing it:
// filming one scene on its own is the normal way to work, and the first
// version of this threw away the record of every other passage when it
// did, which the montage then skipped without knowing why.
const filmed = new Map();
if (existsSync(`${OUT}/scenes.json`)) {
  try {
    for (const s of JSON.parse(readFileSync(`${OUT}/scenes.json`, 'utf8')).scenes ?? []) {
      filmed.set(s.name, s);
    }
  } catch {
    // An unreadable manifest is one that gets rebuilt, not one that stops
    // the filming.
  }
}
function writeManifest() {
  const scenes = [...filmed.values()];
  writeFileSync(`${OUT}/scenes.json`, `${JSON.stringify({ scenes }, null, 2)}\n`);
}

const wanted = process.argv.slice(2).filter((a) => scenes[a]);
const order = wanted.length > 0 ? wanted : Object.keys(scenes);

await page.goto(`${URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await signIn(page, e2eName('tour'));
await page.waitForFunction(HOME_UP, { timeout: 20000 });
await sleep(1500);

for (const name of order) {
  const scene = scenes[name];
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  try {
    await scene.open();
  } catch (err) {
    console.log(`SKIP ${name}: ${err.message}`);
    continue;
  }
  await sleep(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (PROBE) {
    console.log(`probed ${name}`);
    continue;
  }

  const cdp = await page.createCDPSession();
  let frame = 0;
  cdp.on('Page.screencastFrame', async (ev) => {
    await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    writeFileSync(
      `${dir}/frame-${String(frame++).padStart(4, '0')}.jpg`,
      Buffer.from(ev.data, 'base64'),
    );
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  const started = Date.now();
  // The act runs inside the recording; the scene length is a floor, so an
  // act that takes longer than planned is filmed whole rather than cut.
  await scene.act().catch((err) => console.log(`  ${name} act: ${err.message}`));
  const left = scene.seconds * 1000 - (Date.now() - started);
  if (left > 0) await sleep(left);
  await cdp.send('Page.stopScreencast');
  await cdp.detach().catch(() => {});
  const secs = Number(((Date.now() - started) / 1000).toFixed(2));
  filmed.set(name, { name, frames: frame, seconds: secs });
  writeManifest();
  console.log(`${name}: ${frame} frames over ${secs}s`);
}

await browser.close();
