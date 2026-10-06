// A machine drawing a match on the quality ladder (src/game/quality_ladder.ts),
// for its tests: the browser begins a frame on a refresh and hands its time
// over; a frame's work starts once the one before is done, so the rate follows
// the work while the times stay on the refreshes (what Chrome does with a frame
// slower than one refresh: intervals of one and two refreshes). A strict one
// waits for the refresh after the work instead, as a double-buffered screen
// does, so 22 ms of work is two refreshes every frame.

import {
  DESK_RATIO_FLOOR,
  ladderRungs,
  QualityLadder,
  type Rung,
} from '../src/game/quality_ladder';

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
