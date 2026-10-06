// Machines drawing matches on the quality ladder (src/game/quality_ladder.ts),
// for its tests. The browser begins a frame on a refresh and hands its time
// over; a frame's work starts once the one before is done, so the rate follows
// the work while the times stay on the refreshes (what Chrome does with a frame
// slower than one refresh: intervals of one and two refreshes). A strict one
// waits for the refresh after the work instead, as a double-buffered screen
// does, so 22 ms of work is two refreshes every frame. Matches go through the
// quality dial (src/render/quality_dial.ts) and the browser's memory between
// them (src/game/quality_memory.ts), which the caller stubs.

import * as THREE from 'three';
import { QualityLadder } from '../src/game/quality_ladder';
import { LEAN_LEVELS, type Lean } from '../src/game/quality_memory';
import {
  DESK_RATIO_FLOOR,
  ladderRungs,
  QualityDial,
  type Rung,
  SETTLE_MS,
} from '../src/render/quality_dial';

export const SETTLE = SETTLE_MS;

// A pseudo-random sequence in [0, 1), the same for a seed.
export function sequence(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

// A frame's work on a rung with a lean level, begun at `at`, in ms.
export type Work = (rung: Rung, lean: Lean, at: number) => number;

// The refresh a frame begun at `at` is shown on, its work done at `free`: the
// one after the work on a strict screen, else the last one the work reached,
// a refresh after `at` at the least.
function shownAt(at: number, free: number, refreshMs: number, strict: boolean): number {
  const refreshes = strict ? Math.ceil(free / refreshMs - 1e-9) : Math.floor(free / refreshMs);
  return Math.max(at + refreshMs, refreshes * refreshMs);
}

// A screen and what it draws on: its refresh, whether it waits for the
// refresh after the work, and the device's own ratio, the top of its ladder.
interface Screen {
  refreshHz: number;
  strict?: boolean;
  top: number;
  // The share of a frame's work its own script takes.
  scriptShare?: number;
  // Spans [from, to) in ms the tab is hidden (paused when it is back) or the
  // renderer draws nothing (a gap).
  hidden?: readonly [number, number][];
  gaps?: readonly [number, number][];
  // A clock that hands the time over rounded to the millisecond.
  roundedClock?: boolean;
}

// A machine drawing a ladder's rungs: a frame begun at `at` takes `workMs`.
export interface Machine extends Screen {
  workMs: (rung: Rung, at: number) => number;
}

export interface Run {
  at: number;
  // Every rung change, and the rungs stood on outside trials, with when.
  changes: { at: number; index: number }[];
  settled: { at: number; index: number }[];
  // Milliseconds drawn below the top past the settling.
  belowMs: number;
}

// A ladder on a desktop rung set from `top`, the screen's rate known.
export const ladderFor = (top = 1.25, known: number | null = 60) =>
  new QualityLadder(ladderRungs(top, DESK_RATIO_FLOOR).length, known, SETTLE);

// Drives `ladder` with machine `m` for `seconds` from `from`.
export function drive(ladder: QualityLadder, m: Machine, seconds: number, from = 0): Run {
  const rungs = ladderRungs(m.top, DESK_RATIO_FLOOR);
  const refreshMs = 1000 / m.refreshHz;
  const end = from + seconds * 1000;
  const changes: Run['changes'] = [];
  const settled = [{ at: from, index: ladder.settled }];
  let at = from;
  let free = from;
  let away = false;
  let belowMs = 0;
  while (at < end) {
    const hidden = m.hidden?.find(([a, b]) => at >= a && at < b);
    if (hidden) {
      at = hidden[1];
      free = at;
      away = true;
      continue;
    }
    if (away) {
      ladder.pause(at + 4000);
      away = false;
    }
    const before = ladder.index;
    const work = m.workMs(rungs[before]!, at);
    free = Math.max(free, at) + work;
    const last = at;
    at = shownAt(at, free, refreshMs, m.strict === true);
    if (last >= SETTLE && before > 0) belowMs += at - last;
    if (m.gaps?.some(([a, b]) => at >= a && at < b)) {
      ladder.gap();
      continue;
    }
    const script = m.scriptShare === undefined ? undefined : m.scriptShare * work;
    ladder.frame(m.roundedClock ? Math.round(at) : at, script);
    if (ladder.index !== before) changes.push({ at, index: ladder.index });
    if (ladder.settled !== settled.at(-1)!.index) settled.push({ at, index: ladder.settled });
  }
  return { at, changes, settled, belowMs };
}

// Frames at exactly the rate `fps(index, at)` a second, from 60 a second
// through the settling (the screen read at 60), for `seconds`: no refresh
// rounds them, so a window reads the rate itself.
export function exact(
  ladder: QualityLadder,
  fps: (index: number, at: number) => number,
  seconds: number,
  script?: (at: number) => number,
): Run {
  const changes: Run['changes'] = [];
  const settled = [{ at: 0, index: ladder.settled }];
  let at = 0;
  let belowMs = 0;
  while (at < seconds * 1000) {
    const before = ladder.index;
    const dt = at < SETTLE ? 1000 / 60 : 1000 / fps(before, at);
    at += dt;
    if (at > SETTLE && before > 0) belowMs += dt;
    ladder.frame(at, script ? script(at) * dt : undefined);
    if (ladder.index !== before) changes.push({ at, index: ladder.index });
    if (ladder.settled !== settled.at(-1)!.index) settled.push({ at, index: ladder.settled });
  }
  return { at, changes, settled, belowMs };
}

// A GPU held back by its pixels: `msAtTop` at the ratio `top` as the pixels
// go, 0.87 of it without shadows, 0.63 without the effects' lights and 0.83
// of that without antialiasing.
export const fill =
  (msAtTop: number, top: number): Work =>
  (rung, lean) =>
    msAtTop *
    (rung.ratio / top) ** 2 *
    (rung.shadows ? 1 : 0.87) *
    (lean.effectLights ? 1 : 0.63) *
    (lean.antialias ? 1 : 0.83);

// A page whose rate is drawn afresh every `every` seconds between `lo` and
// `hi`, whatever the rung: held back by its script, noisily.
export function noisy(lo: number, hi: number, every: number, seed: number): Work {
  const next = sequence(seed);
  const rates: number[] = [];
  return (_rung, _lean, at) => {
    const i = Math.floor(at / 1000 / every);
    while (rates.length <= i) rates.push(lo + (hi - lo) * next());
    return 1000 / rates[i]!;
  };
}

// A match through the dial: how long it lasts, and its work on a lean level.
export interface MatchMachine extends Screen {
  seconds: number;
  workMs: Work;
}

// What a match through the dial did: its lean level, the milliseconds judged
// and drawn below the top, the rungs it stood on outside trials with when, and
// the rung changes.
export interface Played {
  lean: number;
  judgedMs: number;
  belowMs: number;
  settled: { at: number; index: number }[];
  changes: { at: number; index: number }[];
}

export function playMatch(m: MatchMachine): Played {
  const dial = new QualityDial({ mode: 'classic', top: m.top, phone: false, pin: null, now: 0 });
  const gl = {
    ratio: dial.rung.ratio,
    shadowMap: { autoUpdate: true, needsUpdate: false },
    domElement: { width: 1920, height: 1080 },
    getPixelRatio: () => gl.ratio,
    setPixelRatio: (r: number) => {
      gl.ratio = r;
    },
  };
  dial.attach({ gl: gl as unknown as THREE.WebGLRenderer, scene: new THREE.Scene(), onRatio() {} });
  const ladder = dial.ladder;
  const refreshMs = 1000 / m.refreshHz;
  const settled = [{ at: 0, index: 0 }];
  const changes: Played['changes'] = [];
  let at = 0;
  let free = 0;
  let away = false;
  let belowMs = 0;
  while (at < m.seconds * 1000) {
    const hidden = m.hidden?.find(([a, b]) => at >= a && at < b);
    if (hidden) {
      at = hidden[1];
      free = at;
      away = true;
      continue;
    }
    if (away) {
      dial.pause(at);
      away = false;
    }
    const before = dial.index;
    free = Math.max(free, at) + m.workMs(dial.rung, dial.lean, at);
    const last = at;
    at = shownAt(at, free, refreshMs, m.strict === true);
    if (last >= SETTLE && before > 0) belowMs += at - last;
    dial.frame(at, 2);
    if (dial.index !== before) changes.push({ at, index: dial.index });
    if (ladder.settled !== settled.at(-1)!.index) settled.push({ at, index: ladder.settled });
  }
  const judgedMs = ladder.judgedMs;
  dial.dispose();
  return { lean: dial.leanLevel, judgedMs, belowMs, settled, changes };
}

// The rung stood on at `at`.
export const standingAt = (p: { settled: { at: number; index: number }[] }, at: number) =>
  [...p.settled].reverse().find((s) => s.at <= at)?.index ?? 0;

// Steps up kept and then given up for the rung below, over the rungs stood on.
export function swings(settled: { index: number }[]): number {
  let n = 0;
  for (let i = 2; i < settled.length; i++) {
    const [a, b, c] = [settled[i - 2]!.index, settled[i - 1]!.index, settled[i]!.index];
    if (b < a && c > b) n++;
  }
  return n;
}

// The rungs whose steady rate holds three quarters of the screen's on a lean
// level.
export function holding(work: Work, top: number, lean: number, strict: boolean): number[] {
  const rungs = ladderRungs(top, DESK_RATIO_FLOOR);
  const refreshMs = 1000 / 60;
  const out: number[] = [];
  rungs.forEach((rung, i) => {
    let at = 0;
    let free = 0;
    let frames = 0;
    while (at < 20_000) {
      free = Math.max(free, at) + work(rung, LEAN_LEVELS[lean]!, at);
      at = shownAt(at, free, refreshMs, strict);
      frames++;
    }
    if ((frames * 1000) / at >= 45) out.push(i);
  });
  return out;
}

// A capable machine's match: `base` ms a frame at the top as the pixels go,
// and up to three transients drawn from `rand`: fights of 5 to 20 s at 30 to
// 45 frames a second whatever the rung, programs linking in bursts, collections
// twice a second, hitches, assets streaming at 30 for the first 20 s, a hidden
// tab, a resize. Also answers when its transients end.
export function capableMatch(
  rand: () => number,
  refreshHz: number,
  seconds: number,
  top: number,
): MatchMachine & { ends: number[] } {
  const base = refreshHz === 60 ? 9 : 5.5;
  const end = seconds * 1000;
  const kinds = ['fight', 'fight', 'fight', 'link', 'gc', 'stream', 'hidden', 'resize', 'hitch'];
  const picked = Array.from(
    { length: Math.floor(rand() * 4) },
    () => kinds[Math.floor(rand() * kinds.length)]!,
  );
  const fights: { at: number; ms: number; fps: number }[] = [];
  const hidden: [number, number][] = [];
  const ends: number[] = [];
  let [streaming, collections, hitches, linkAt, resizeAt] = [false, false, false, -1, -1];
  const linkFrames = 2 + Math.floor(rand() * 3);
  const linkMs = 100 + rand() * 150;
  for (const kind of picked) {
    const when = SETTLE + rand() * Math.max(1000, end - SETTLE - 25_000);
    if (kind === 'fight') {
      fights.push({ at: when, ms: 5000 + rand() * 15_000, fps: 30 + rand() * 15 });
      ends.push(when + fights.at(-1)!.ms);
    } else if (kind === 'stream') {
      streaming = true;
      ends.push(20_000);
    } else if (kind === 'gc') collections = true;
    else if (kind === 'hitch') hitches = true;
    else if (kind === 'link') {
      linkAt = when;
      ends.push(when + 6000);
    } else if (kind === 'resize') resizeAt = when;
    else if (kind === 'hidden' && hidden.length === 0) {
      hidden.push([when, when + 5000 + rand() * 30_000]);
      ends.push(hidden[0]![1] + 4000);
    }
  }
  const noise = sequence(Math.floor(rand() * 1e9));
  let left = 0;
  let nextLink = linkAt;
  return {
    refreshHz,
    top,
    seconds,
    hidden,
    ends,
    workMs: (rung, _lean, at) => {
      let w = base * (rung.ratio / top) ** 2;
      if (streaming && at < 20_000) w = Math.max(w, 1000 / 30);
      const fight = fights.find((f) => at > f.at && at < f.at + f.ms);
      if (fight) w = Math.max(w, 1000 / fight.fps);
      if (linkAt >= 0 && at >= nextLink && at < linkAt + 6000) {
        left = linkFrames;
        nextLink += 1000;
      }
      if (left > 0) {
        left--;
        w += linkMs;
      }
      if (collections && noise() < 2 / refreshHz) w += 30 + 60 * noise();
      if (hitches && noise() < 1 / 1200) w += 200;
      if (resizeAt >= 0 && Math.abs(at - resizeAt) < 500 / refreshHz) w += 150;
      return w;
    },
  };
}
