// Film the match passages of the tour off a saved replay, frame by frame,
// on a machine with no GPU. The screencast (scripts/tour_clips.mjs) hands
// back one frame a second from a software rasteriser, and a second is not
// a video. So the page's clock is taken over instead: performance.now,
// the animation frames and the timers run on a virtual clock the script
// advances by one frame's worth between two screenshots. The renderer
// takes as long as it takes on each frame, the sim never notices, and the
// frames come out at the rate they are asked for, twenty-four a second,
// at one times speed.
//
// The camera is the viewer's own: a click on the minimap looks at a point
// of the map (fixed shots, and pans as a click a frame along a line), and
// a tracking shot follows a champion by reading its position off the
// viewer's dev probe (window.__replay, src/main.ts) and looking there,
// eased a little so the camera glides. Nothing here reaches into the
// renderer.
//
//   TOUR_URL=http://localhost:5174 REPLAY_ID=902 node scripts/tour_match.mjs [scene...]
//
// The scenes below are written against replay 902, seed 2's house match
// saved with the clip_seed format (docs/making-a-clip.md); a passage names
// the seat it follows by unit id, the second it starts at, its length, and
// its camera. TOUR_DIR takes the frames (default tour/), one folder per
// scene plus a still, and scenes.json gets the passage's length so
// scripts/tour_montage.mjs plays it at the rate it was filmed. TOUR_FPS
// and TOUR_GL as in tour_clips.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { e2eName, HOME_UP, signIn } from './e2e_signin.mjs';

const URL = process.env.TOUR_URL ?? 'http://localhost:5174';
const OUT = process.env.TOUR_DIR ?? 'tour';
const REPLAY_ID = Number(process.env.REPLAY_ID ?? 902);
const FPS = Number(process.env.TOUR_FPS ?? 24);
// TOUR_MAX_SECONDS caps every scene, for a probe of a new one.
const MAX_SECONDS = Number(process.env.TOUR_MAX_SECONDS ?? 0) || null;
const CHROME =
  process.env.CHROME ?? '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const GL = {
  auto: [],
  vulkan: [
    '--use-angle=vulkan',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
  ],
  swiftshader: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
};
const gl = GL[process.env.TOUR_GL ?? 'swiftshader'] ?? GL.swiftshader;
const [sw, sh] = (process.env.TOUR_SIZE ?? '1280x720').split('x').map(Number);
const size = { width: sw || 1280, height: sh || 720 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

// Seed 2's seats (replay 902): team 0 elowen 25, korrath 26, vesk 27,
// torv 28, rhoka 29 (the jungler); team 1 sylra 30, rhoka 31, vesk 32,
// maera 33, fenn 34 (the jungler). The times are the match's own
// (scripts/clip_seed.ts scouts them; a scout of the events with positions
// is what these were read off).
const PLAZA = { x: 75, z: 77 };
const BOT_RING = { x: 149, z: 7 };
const EAST_GLADE = { x: 125, z: 105 };
const scenes = {
  // The map, from team 0's door across the plaza to the bot ring, while
  // the first wave walks out.
  orchard: {
    follow: 25,
    at: 8,
    seconds: 10,
    camera: { kind: 'pan', path: [{ x: 22, z: 26 }, PLAZA, BOT_RING] },
  },
  // The jungler's first round: the Spinecrest, then the Brackenlings.
  jungler: { follow: 29, at: 33, seconds: 10, camera: { kind: 'follow' } },
  // Team 1 takes the first Pyrefang at 4:30: the favor lands. Tracked on
  // their jungler, since the fight runs along the disc's edge.
  pyrefang: { follow: 34, at: 20 + 4 * 60, seconds: 12, camera: { kind: 'follow' } },
  // A fight on the plaza: the jungler's triple at 14:45.
  fight: {
    follow: 34,
    at: 14 * 60 + 40,
    seconds: 12,
    camera: { kind: 'fixed', at: { x: 79, z: 82 } },
  },
  // The fourth rise of the bot ring is the Ascendant, at 15:23.
  ascendant: {
    follow: 34,
    at: 15 * 60 + 20,
    seconds: 8,
    camera: { kind: 'fixed', at: BOT_RING },
  },
  // The Warden drawn to the east glade, taken at 16:40: the Boon.
  warden: {
    follow: 34,
    at: 16 * 60 + 29,
    seconds: 12,
    camera: { kind: 'fixed', at: EAST_GLADE },
  },
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.TOUR_HEADFUL !== '1',
  args: ['--no-sandbox', '--mute-audio', ...gl],
  defaultViewport: size,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

async function waitFor(fnBody, label, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fnBody)) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

// The controls read REPLAY across the frame, the hints and the opening
// shop too: hidden while filming, so the frame is the match.
async function tidy() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.replay-bar, .hud-hints, .mail-note')) {
      el.style.display = 'none';
    }
    const open = document.querySelector('.hud-shop.open');
    const b =
      open && [...open.querySelectorAll('button')].find((x) => x.textContent?.includes('Close'));
    if (b) b.click();
  });
}

// Back to the home screen from wherever the last scene left the page.
async function home() {
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(HOME_UP)) return;
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((e) =>
        /^(Exit replay|Back|Close|Exit|Leave|Cancel)/.test((e.textContent || '').trim()),
      );
      b?.click();
    });
    await sleep(700);
  }
  await waitFor(HOME_UP, 'home menu');
}

async function openReplay(follow) {
  await home();
  await page.evaluate(
    (id, follow) => window.dispatchEvent(new CustomEvent('loc:replay', { detail: { id, follow } })),
    REPLAY_ID,
    follow,
  );
  await waitFor(`!!document.querySelector('.replay-bar')`, 'replay viewer', 60000);
  await waitFor(`!!document.querySelector('.hud-teamscore-clock')`, 'HUD clock', 60000);
  await sleep(1500);
  await tidy();
}

const simTime = () =>
  page.evaluate(() => {
    const t = document
      .querySelector('.hud-teamscore-clock')
      ?.textContent?.match(/(\d{1,2}):(\d{2})/);
    return t ? Number(t[1]) * 60 + Number(t[2]) : -1;
  });

// A seek through the bar's own jump box, then the wait for the viewer to
// step there (it walks the ticks a slice a frame and says so on the clock).
async function seekTo(seconds) {
  await page.evaluate((text) => {
    const goto = document.querySelector('.replay-goto');
    goto.style.display = '';
    goto.value = text;
    goto.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    goto.style.display = 'none';
  }, clock(seconds));
  const start = Date.now();
  for (;;) {
    const seeking = await page.evaluate(
      () => document.querySelector('.replay-time')?.classList.contains('seeking') === true,
    );
    const t = await simTime();
    if (!seeking && t >= seconds - 1) break;
    if (Date.now() - start > 240000) throw new Error(`seek to ${clock(seconds)} never landed`);
    await sleep(300);
  }
  await tidy();
}

// The virtual clock: from here on the page's time moves only when the
// script says so, and by how much. The clock starts where the real one
// stood so the viewer's accumulator sees no jump.
async function takeTheClock() {
  await page.evaluate(() => {
    const w = window;
    if (w.__vt) return;
    const vt = {
      now: performance.now(),
      epoch: Date.now() - performance.now(),
      rafs: [],
      timers: [],
      nextId: 1,
    };
    w.__vt = vt;
    performance.now = () => vt.now;
    Date.now = () => vt.epoch + vt.now;
    w.requestAnimationFrame = (cb) => {
      const id = vt.nextId++;
      vt.rafs.push({ id, cb });
      return id;
    };
    w.cancelAnimationFrame = (id) => {
      vt.rafs = vt.rafs.filter((r) => r.id !== id);
    };
    w.setTimeout = (cb, delay = 0, ...args) => {
      const id = vt.nextId++;
      vt.timers.push({ id, cb, args, due: vt.now + Math.max(0, delay), every: null });
      return id;
    };
    w.setInterval = (cb, delay = 0, ...args) => {
      const id = vt.nextId++;
      const every = Math.max(1, delay);
      vt.timers.push({ id, cb, args, due: vt.now + every, every });
      return id;
    };
    w.clearTimeout = w.clearInterval = (id) => {
      vt.timers = vt.timers.filter((t) => t.id !== id);
    };
    vt.advance = (ms) => {
      const end = vt.now + ms;
      // Timers in due order up to the frame's end, then the frame itself.
      for (;;) {
        const due = vt.timers.filter((t) => t.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        vt.now = Math.max(vt.now, due.due);
        if (due.every === null) vt.timers = vt.timers.filter((t) => t !== due);
        else due.due += due.every;
        try {
          due.cb(...due.args);
        } catch (e) {
          console.error(e);
        }
      }
      vt.now = end;
      const rafs = vt.rafs;
      vt.rafs = [];
      for (const r of rafs) {
        try {
          r.cb(vt.now);
        } catch (e) {
          console.error(e);
        }
      }
    };
  });
}

// The camera. A minimap click looks at a map point (the map is drawn +z
// up, team 0 bottom-left); a tracking shot looks at the followed unit's
// position, read off the viewer's dev probe. The mouse goes back to the
// middle of the screen after every look, where the edge pan has no reason
// to move (left on the minimap's corner it panned the camera away).
async function minimapRect() {
  return page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].find((el) => {
      const s = getComputedStyle(el);
      return s.position === 'absolute' && s.right === '12px' && s.bottom === '12px';
    });
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, size: 156 };
  });
}

async function lookAt(rect, p) {
  const px = rect.x + (p.x / rect.size) * rect.w;
  const py = rect.y + (1 - p.z / rect.size) * rect.h;
  await page.mouse.click(px, py, { button: 'left' });
  // Off the minimap's corner and into the middle of the screen, where the
  // edge pan has no reason to move.
  await page.mouse.move(size.width / 2, size.height / 2);
}

// Where the followed unit stands, off the viewer's dev probe.
async function unitAt(id) {
  return page.evaluate((id) => {
    const u = window.__replay?.world?.units?.get(id);
    return u ? { x: u.pos.x, z: u.pos.z } : null;
  }, id);
}

function along(path, t) {
  // t in [0, 1] over the whole polyline, eased so the pan starts and ends
  // softly.
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const legs = path.length - 1;
  const at = Math.min(legs - 1e-9, eased * legs);
  const i = Math.floor(at);
  const f = at - i;
  const a = path[i];
  const b = path[i + 1];
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

const filmed = new Map();
if (existsSync(`${OUT}/scenes.json`)) {
  try {
    for (const s of JSON.parse(readFileSync(`${OUT}/scenes.json`, 'utf8')).scenes ?? []) {
      filmed.set(s.name, s);
    }
  } catch {
    // a fresh manifest, then
  }
}
function remember(name, seconds, frames) {
  filmed.set(name, { name, seconds, frames, fps: FPS });
  writeFileSync(
    `${OUT}/scenes.json`,
    `${JSON.stringify({ scenes: [...filmed.values()] }, null, 2)}\n`,
  );
}

const wanted = process.argv.slice(2).filter((a) => scenes[a]);
const order = wanted.length > 0 ? wanted : Object.keys(scenes);
mkdirSync(OUT, { recursive: true });

await page.goto(`${URL}/`, { waitUntil: 'load' });
await signIn(page, e2eName('tour', Date.now().toString(36).slice(-6)));
await waitFor(HOME_UP, 'home menu');

for (const name of order) {
  const scene = scenes[name];
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  console.log(`${name}: opening replay ${REPLAY_ID} following ${scene.follow}`);
  // A fresh page per scene: the virtual clock is not something to hand
  // back, and the viewer is opened anew with the seat the scene follows.
  await page.goto(`${URL}/`, { waitUntil: 'load' });
  await waitFor(HOME_UP, 'home menu');
  await openReplay(scene.follow);
  // Three seconds early: the seek lands with an announcement on screen
  // ("Battle begins"), and the virtual clock runs those seconds through
  // without a frame taken, so the passage opens clean.
  const LEAD_S = 3;
  console.log(`  seeking to ${clock(scene.at - LEAD_S)}`);
  await seekTo(Math.max(0, scene.at - LEAD_S));
  const rect = await minimapRect();
  if (!rect) throw new Error('minimap not found');
  let cam = null;
  const track = async () => {
    const at = await unitAt(scene.follow);
    if (!at) throw new Error('no dev probe: the viewer must run on the Vite dev server');
    cam = cam ? { x: cam.x + (at.x - cam.x) * 0.2, z: cam.z + (at.z - cam.z) * 0.2 } : at;
    await lookAt(rect, cam);
  };
  if (scene.camera.kind === 'fixed') await lookAt(rect, scene.camera.at);
  if (scene.camera.kind === 'pan') await lookAt(rect, scene.camera.path[0]);
  if (scene.camera.kind === 'follow') await track();
  await sleep(600);
  await tidy();
  await takeTheClock();
  for (let i = 0; i < (LEAD_S * 1000) / 250; i++) {
    if (scene.camera.kind === 'fixed') await lookAt(rect, scene.camera.at);
    if (scene.camera.kind === 'follow') await track();
    await page.evaluate(() => window.__vt.advance(250));
  }
  await tidy();
  const seconds = MAX_SECONDS ? Math.min(MAX_SECONDS, scene.seconds) : scene.seconds;
  const frames = Math.round(seconds * FPS);
  const started = Date.now();
  for (let i = 0; i < frames; i++) {
    // A look every frame, the fixed shot too: under the virtual clock the
    // viewer drifted back to its followed seat a second after a single
    // look, and a click a frame costs nothing.
    if (scene.camera.kind === 'fixed') await lookAt(rect, scene.camera.at);
    if (scene.camera.kind === 'pan') await lookAt(rect, along(scene.camera.path, i / (frames - 1)));
    if (scene.camera.kind === 'follow') await track();
    await page.evaluate((ms) => window.__vt.advance(ms), 1000 / FPS);
    await page.screenshot({
      path: `${dir}/frame-${String(i).padStart(4, '0')}.jpg`,
      type: 'jpeg',
      quality: 90,
    });
    if (i === 0) await page.screenshot({ path: `${OUT}/${name}.png` });
    if (i % 24 === 23) {
      const per = (Date.now() - started) / (i + 1);
      console.log(
        `  ${i + 1}/${frames} frames, ${(per / 1000).toFixed(2)} s a frame, clock ${clock(await simTime())}`,
      );
    }
  }
  remember(name, seconds, frames);
  console.log(`  ${name}: ${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
await browser.close();
