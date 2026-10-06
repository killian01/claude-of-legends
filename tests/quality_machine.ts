// A machine drawing a match on the quality ladder (src/game/quality_ladder.ts),
// for its tests: the browser begins a frame on a refresh and hands its time
// over; a frame's work starts once the one before is done, so the rate follows
// the work while the times stay on the refreshes (what Chrome does with a frame
// slower than one refresh: intervals of one and two refreshes). A strict one
// waits for the refresh after the work instead, as a double-buffered screen
// does, so 22 ms of work is two refreshes every frame. Matches in a row go
// through the quality dial (src/render/quality_dial.ts) and the browser's
// memory between them (src/game/quality_memory.ts), which the caller stubs.

import * as THREE from 'three';
import {
  DESK_RATIO_FLOOR,
  ladderRungs,
  QualityLadder,
  type Rung,
} from '../src/game/quality_ladder';
import { LEAN_LEVELS, type Lean } from '../src/game/quality_memory';
import { QualityDial, SETTLE_MS } from '../src/render/quality_dial';

export interface Machine {
  // The screen's refresh, in ms.
  refreshMs: number;
  // The work a frame begun at `at` takes on a rung, in ms.
  workMs: (rung: Rung, at: number) => number;
  // Waits for the refresh after each frame's work.
  strict?: boolean;
  // The share of a frame's work its own script takes.
  scriptShare?: number;
  // Spans of time, [from, to) in ms, the tab is hidden (the renderer pauses
  // the ladder when it is back), or the renderer draws nothing (a gap).
  hidden?: readonly [number, number][];
  gaps?: readonly [number, number][];
  // A browser's clock that hands the time over rounded to the millisecond,
  // or with a jitter of a few tenths of one.
  clock?: 'ms' | 'jitter';
}

export interface Run {
  at: number;
  // Every rung change, with when it happened.
  changes: { at: number; index: number }[];
  // The rungs the ladder settled on, in order: they move only when a step
  // is kept.
  settled: number[];
  // Frames a second over the run's last ten seconds.
  lastFps: number;
}

// A pseudo-random sequence in [0, 1), the same for a seed.
export function sequence(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

export function drive(ladder: QualityLadder, m: Machine, seconds: number, from = 0): Run {
  const jitter = sequence(4242);
  let at = from;
  let free = from;
  const end = from + seconds * 1000;
  const changes: Run['changes'] = [];
  const settled = [ladder.settled];
  const stamps: number[] = [];
  let away = false;
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
    const work = m.workMs(ladder.rung, at);
    free = Math.max(free, at) + work;
    const refreshes = m.strict
      ? Math.ceil(free / m.refreshMs - 1e-9)
      : Math.floor(free / m.refreshMs);
    at = Math.max(at + m.refreshMs, refreshes * m.refreshMs);
    if (m.gaps?.some(([a, b]) => at >= a && at < b)) {
      ladder.gap();
      continue;
    }
    const stamp =
      m.clock === 'ms' ? Math.round(at) : m.clock === 'jitter' ? at + (jitter() - 0.5) * 0.4 : at;
    const before = ladder.index;
    ladder.frame(stamp, m.scriptShare === undefined ? undefined : m.scriptShare * work);
    if (ladder.index !== before) changes.push({ at, index: ladder.index });
    if (ladder.settled !== settled.at(-1)) settled.push(ladder.settled);
    stamps.push(at);
  }
  const tail = stamps.filter((s) => s > end - 10_000);
  const lastFps = tail.length > 1 ? ((tail.length - 1) * 1000) / (tail.at(-1)! - tail[0]!) : 0;
  return { at, changes, settled, lastFps };
}

// Steps up kept and then given up for the rung below.
export function swings(run: Run): number {
  const s = run.settled;
  let n = 0;
  for (let i = 2; i < s.length; i++) if (s[i - 1]! < s[i - 2]! && s[i]! > s[i - 1]!) n++;
  return n;
}

// The deepest rung a run settled on.
export const deepest = (run: Run): number => Math.max(...run.settled);

// A GPU held back by its pixels: the work goes with the pixels drawn, and
// shadows left out take 15 percent off.
export function fillBound(refreshHz: number, msAtTop: number, top: number): Machine {
  return {
    refreshMs: 1000 / refreshHz,
    workMs: (r) => msAtTop * (r.ratio / top) ** 2 * (r.shadows ? 1 : 0.85),
  };
}

// A page held back by its script: the same work on every rung.
export const scriptBound = (refreshHz: number, ms: number): Machine => ({
  refreshMs: 1000 / refreshHz,
  workMs: () => ms,
});

// A page whose frame rate is drawn afresh every `every` seconds between `lo`
// and `hi`, whatever the rung: held back by its script, noisily.
export function noisy(lo: number, hi: number, every: number, seed: number): Machine {
  const next = sequence(seed);
  const rates: number[] = [];
  return {
    refreshMs: 1000 / 60,
    workMs: (_r, at) => {
      const i = Math.floor(at / 1000 / every);
      while (rates.length <= i) rates.push(lo + (hi - lo) * next());
      return 1000 / rates[i]!;
    },
  };
}

export const SETTLE = 10_000;

// A desktop's ladder from `top`, started on rung `index` with the screen's
// rate `known` before the match (the page's lighter frames, the browser's
// memory).
export const ladderFor = (top: number, index = 0, known: number | null = null) =>
  new QualityLadder(ladderRungs(top, DESK_RATIO_FLOOR), { index, known, settleUntil: SETTLE });

// The next refresh a frame begun at `at` is shown on, its work done at
// `free`: the one after the work on a strict screen, else the last one the
// work reached, a refresh after `at` at the least.
function shownAt(at: number, free: number, refreshMs: number, strict: boolean): number {
  const refreshes = strict ? Math.ceil(free / refreshMs - 1e-9) : Math.floor(free / refreshMs);
  return Math.max(at + refreshMs, refreshes * refreshMs);
}

// A frame's work on a rung with a lean level, begun at `at`.
export type Work = (rung: Rung, lean: Lean, at: number) => number;

// One match through the dial: the screen, the device's own ratio, how long
// it lasts, the work, and when the tab is hidden.
export interface MatchMachine {
  refreshHz: number;
  strict?: boolean;
  top: number;
  seconds: number;
  workMs: Work;
  hidden?: readonly [number, number][];
}

// What a match through the dial did: where it started, the milliseconds
// judged in all and below the top, the rungs it settled on and the ones it
// rested on outside trials, each with when, and the seconds after the
// settling until it rested at the top (null for never).
export interface Played {
  start: { index: number; lean: number };
  judgedMs: number;
  belowMs: number;
  settled: number[];
  rests: { at: number; index: number }[];
  topAfter: number | null;
}

export function playMatch(m: MatchMachine): Played {
  const dial = new QualityDial({ mode: 'classic', top: m.top, phone: false, pin: null, now: 0 });
  const ladder = dial.ladder;
  const start = { index: ladder.index, lean: dial.leanLevel };
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
  const refreshMs = 1000 / m.refreshHz;
  const settled = [ladder.settled];
  const rests = [{ at: 0, index: ladder.index }];
  let topAfter: number | null = start.index === 0 ? 0 : null;
  let at = 0;
  let free = 0;
  let away = false;
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
    free = Math.max(free, at) + m.workMs(dial.rung, dial.lean, at);
    at = shownAt(at, free, refreshMs, m.strict === true);
    dial.frame(at, 2);
    if (ladder.settled !== settled.at(-1)) settled.push(ladder.settled);
    if (!ladder.trying && ladder.index !== rests.at(-1)!.index) {
      rests.push({ at, index: ladder.index });
    }
    if (topAfter === null && at >= SETTLE_MS && !ladder.trying && ladder.index === 0) {
      topAfter = (at - SETTLE_MS) / 1000;
    }
  }
  const spent = ladder.spentMs;
  const judgedMs = spent.reduce((a, b) => a + b, 0);
  dial.dispose();
  return { start, judgedMs, belowMs: judgedMs - spent[0]!, settled, rests, topAfter };
}

// The rung the ladder rested on at `at`.
export const restingAt = (p: Played, at: number): number =>
  [...p.rests].reverse().find((r) => r.at <= at)?.index ?? p.rests[0]!.index;

// Steps up kept and then given up, over a match's settled rungs.
export function swingsOf(settled: readonly number[]): number {
  let n = 0;
  for (let i = 2; i < settled.length; i++) {
    if (settled[i - 1]! < settled[i - 2]! && settled[i]! > settled[i - 1]!) n++;
  }
  return n;
}

// A GPU held back by its pixels: `msAtTop` at the ratio `top`, as the
// pixels go, 0.87 of it without shadows, 0.63 without the effects' lights
// and 0.83 of that without antialiasing.
export const fill =
  (msAtTop: number, top: number): Work =>
  (rung, lean) =>
    msAtTop *
    (rung.ratio / top) ** 2 *
    (rung.shadows ? 1 : 0.87) *
    (lean.effectLights ? 1 : 0.63) *
    (lean.antialias ? 1 : 0.83);

// The finest rung whose steady rate holds three quarters of the screen's
// on that lean level; null when none does.
export function finestHolding(
  work: Work,
  top: number,
  lean: number,
  refreshHz: number,
  strict: boolean,
): number | null {
  const rungs = ladderRungs(top, DESK_RATIO_FLOOR);
  const refreshMs = 1000 / refreshHz;
  for (let i = 0; i < rungs.length; i++) {
    let at = 0;
    let free = 0;
    let frames = 0;
    while (at < 20_000) {
      free = Math.max(free, at) + work(rungs[i]!, LEAN_LEVELS[lean]!, at);
      at = shownAt(at, free, refreshMs, strict);
      frames++;
    }
    if ((frames * 1000) / at >= 0.75 * Math.min(60, refreshHz)) return i;
  }
  return null;
}

// A capable machine's match: `base` ms a frame at the top, as the pixels go,
// and a mix of what slows it for a while, drawn from `rand`: up to three
// fights of 5 to 20 s at 30 to 45 frames a second whatever the rung,
// assets streaming at 30 for the first 20 s, programs linking in bursts of
// slow frames, collections twice a second, hitches, a resize, a hidden tab.
export function capableMatch(
  rand: () => number,
  refreshHz: number,
  seconds: number,
  top: number,
): MatchMachine {
  const base = refreshHz === 60 ? 9 : 5.5;
  const end = seconds * 1000;
  const fights = Array.from({ length: Math.floor(rand() * 4) }, () => ({
    at: SETTLE + rand() * Math.max(1000, end - SETTLE - 25_000),
    ms: 5000 + rand() * 15_000,
    fps: 30 + rand() * 15,
  }));
  const streaming = rand() < 0.5;
  const collections = rand() < 0.5;
  const linkAt = rand() < 0.6 ? SETTLE + rand() * Math.max(1000, end - SETTLE - 10_000) : -1;
  const linkFrames = 2 + Math.floor(rand() * 3);
  const linkMs = 100 + rand() * 150;
  const resizeAt = rand() < 0.4 ? SETTLE + rand() * (end - SETTLE) : -1;
  const hidden: [number, number][] = [];
  if (rand() < 0.4) {
    const from = SETTLE + rand() * Math.max(1000, end - SETTLE - 40_000);
    hidden.push([from, from + 5000 + rand() * 30_000]);
  }
  const noise = sequence(Math.floor(rand() * 1e9));
  let left = 0;
  let nextLink = linkAt;
  return {
    refreshHz,
    top,
    seconds,
    hidden,
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
      if (noise() < 1 / 1200) w += 200;
      if (resizeAt >= 0 && Math.abs(at - resizeAt) < 500 / refreshHz) w += 150;
      return w;
    },
  };
}
