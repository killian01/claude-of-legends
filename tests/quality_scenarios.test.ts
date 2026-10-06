// The quality ladder (src/game/quality_ladder.ts) over series of whole
// matches through the quality dial (src/render/quality_dial.ts) and the
// browser's memory between them (src/game/quality_memory.ts), held to what
// the design answers for, on a few seeds (scripts can run many more):
//
// A. A capable machine (60, 120 or 144 Hz, frames shown as they come or on
//    the refresh after, another pixel ratio now and then between matches)
//    never steps without a transient; with up to three (fights at 30 to 45
//    whatever the rung, programs linking, collections, hitches, assets
//    streaming at 30 for the first 20 s, a hidden tab, a resize) it never
//    leans, gives a step back within 90 s of the transient's end, and draws
//    below the top 30 percent of a match's judged time at most, a tenth on
//    average.
// B. A page held back by its script, its rate drawn afresh every 1, 2 or
//    5 s from 40-55 to 46-60, never leans and draws below the top 15
//    percent of its judged time at most on average.
// C. A weak GPU (20 to 30 frames a second at the top) stands within 60 s of
//    each match's settling on a rung that holds three quarters of its
//    screen's rate, swings twice at most in half an hour, leans after its
//    first match, and the retry every fifth match costs that match alone.
// D. A machine that got faster draws its top from the next match's start,
//    and its lean falls a level each five matches, to none.
// E. A sudden steady drop to 2 to 22 frames a second has a step kept within
//    60 s, or within the hold of a step undone before it and 60 s.
// F. Matches of 2 to 10 minutes, as when a player joins a running one, hold
//    all of that.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModeMemory, QUALITY_KEY } from '../src/game/quality_memory';
import {
  capableMatch,
  fill,
  holding,
  type MatchMachine,
  noisy,
  type Played,
  playMatch,
  SETTLE,
  sequence,
  standingAt,
  swings,
} from './quality_machine';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Matches in a row from a browser that remembers its screen's rate, and
// `memory` for the classic kind if given.
function series(machines: MatchMachine[], memory?: ModeMemory): Played[] {
  store.set(QUALITY_KEY, JSON.stringify({ hz: 60, modes: memory ? { classic: memory } : {} }));
  return machines.map(playMatch);
}

const remembered = (): ModeMemory => JSON.parse(store.get(QUALITY_KEY)!).modes.classic;
const share = (p: Played) => p.belowMs / p.judgedMs;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const LENGTHS = [120, 300, 600, 1200];

// The time a step stood after the last transient that ended before it was
// given back, in seconds (the match's end for one never given back).
function givenBack(p: Played, ends: number[], seconds: number): number {
  let worst = 0;
  p.settled.forEach((s, i) => {
    if (s.index === 0 || (i > 0 && p.settled[i - 1]!.index > 0)) return;
    const back = p.settled.slice(i).find((t) => t.index === 0)?.at ?? seconds * 1000;
    const last = Math.max(SETTLE, ...ends.filter((e) => e < back));
    worst = Math.max(worst, (back - last) / 1000);
  });
  return worst;
}

describe('A. a capable machine', () => {
  it.each([
    [60, false],
    [60, true],
    [120, false],
    [120, true],
    [144, false],
    [144, true],
  ])('at %i Hz, shown on the refresh after: %s, never steps without a transient', (hz, strict) => {
    const base = hz === 60 ? 9 : 5.5;
    for (const top of [1.25, 1.5, 2]) {
      const [p] = series([
        { refreshHz: hz, strict, top, seconds: 1200, workMs: (r) => base * (r.ratio / top) ** 2 },
      ]);
      expect(p!.changes, `top ${top}`).toEqual([]);
    }
  });

  it.each([
    [60, false],
    [60, true],
    [120, false],
    [120, true],
    [144, false],
    [144, true],
  ])('at %i Hz, shown on the refresh after: %s, gives transients back', (hz, strict) => {
    const shares: number[] = [];
    for (const seconds of LENGTHS) {
      for (let seed = 1; seed <= 3; seed++) {
        const rand = sequence(seed * 7919 + seconds + hz * 13 + (strict ? 1 : 0));
        const tops = Array.from({ length: 6 }, () => [1.25, 1.5, 2][Math.floor(rand() * 3)]!);
        const machines = tops.map((top) => ({ ...capableMatch(rand, hz, seconds, top), strict }));
        series(machines).forEach((p, i) => {
          const label = `${seconds} s, seed ${seed}, match ${i + 1}`;
          expect(p.lean, label).toBe(0);
          expect(share(p), label).toBeLessThanOrEqual(0.3);
          expect(givenBack(p, machines[i]!.ends, seconds), label).toBeLessThanOrEqual(90);
          shares.push(share(p));
        });
        expect(remembered().lean).toBe(0);
      }
    }
    expect(mean(shares)).toBeLessThanOrEqual(0.1);
  });
});

describe('B. a page held back by its script, noisily', () => {
  it.each([
    [40, 55],
    [42, 56],
    [44, 58],
    [46, 60],
  ])('drawing %i to %i, never leans and stays near the top', (lo, hi) => {
    for (const every of [1, 2, 5]) {
      const shares: number[] = [];
      for (const seconds of [120, 600]) {
        for (let seed = 1; seed <= 3; seed++) {
          const machines = Array.from({ length: 6 }, (_, i) => ({
            refreshHz: 60,
            top: 1.25,
            seconds,
            workMs: noisy(lo, hi, every, seed * 7717 + i * 131 + seconds),
          }));
          for (const p of series(machines)) {
            expect(p.lean).toBe(0);
            expect(p.settled[0]!.index).toBe(0);
            shares.push(share(p));
          }
        }
      }
      expect(mean(shares), `every ${every} s`).toBeLessThanOrEqual(0.15);
    }
  });
});

// Matches in a row on a weak GPU: each stands, from 60 s after its settling,
// on a rung that holds three quarters of the screen's rate on its lean.
function weakSeason(fps: number, top: number, strict: boolean, seconds: number, n: number) {
  const work = fill(1000 / fps, top);
  return {
    work,
    played: series(
      Array.from({ length: n }, () => ({ refreshHz: 60, strict, top, seconds, workMs: work })),
    ),
  };
}

function stoodOnAHoldingRung(p: Played, holds: number[], label: string): void {
  const from = SETTLE + 60_000;
  expect(holds.length, label).toBeGreaterThan(0);
  expect(holds, label).toContain(standingAt(p, from));
  for (const s of p.settled.filter((s) => s.at > from)) expect(holds, label).toContain(s.index);
}

describe('C. a weak GPU', () => {
  const cases: [number, number, boolean][] = [];
  for (const fps of [20, 22, 25, 28, 30]) {
    for (const top of [1.25, 1.5, 2]) {
      for (const strict of [false, true]) cases.push([fps, top, strict]);
    }
  }

  it.each(cases)(
    'at %i a second, top %d, strict %s: a rung, leaner, one retry',
    (fps, top, strict) => {
      const { work, played } = weakSeason(fps, top, strict, 300, 13);
      played.forEach((p, i) => {
        const label = `match ${i + 1} at lean ${p.lean}`;
        stoodOnAHoldingRung(p, holding(work, top, p.lean, strict), label);
        expect(swings(p.settled), label).toBeLessThanOrEqual(2);
      });
      // Leaner after the first match; from then on the lean it needs, but for
      // a retry every fifth match at it, the next one back.
      const leans = played.map((p) => p.lean);
      expect(leans[1]).toBe(1);
      const needed = Math.max(...leans);
      leans.slice(1).forEach((lean, i) => {
        if (lean === needed || i + 2 >= leans.length) return;
        expect(lean, `match ${i + 2}`).toBe(needed - 1);
        expect(leans[i + 2], `match ${i + 3}`).toBe(needed);
      });
    },
  );

  it('swings twice at most in half an hour', () => {
    for (const [fps, top] of [
      [20, 1.25],
      [25, 1.5],
      [30, 2],
    ] as const) {
      for (const strict of [false, true]) {
        const { played } = weakSeason(fps, top, strict, 1800, 2);
        for (const p of played) expect(swings(p.settled), `${fps} ${top}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('D. a machine that got faster', () => {
  it('draws its top from the start, and its lean falls a level each five matches', () => {
    for (const [lean, played] of [
      [2, 0],
      [1, 4],
    ] as const) {
      for (const strict of [false, true]) {
        const season = series(
          Array.from({ length: 11 }, () => ({
            refreshHz: 60,
            strict,
            top: 1.25,
            seconds: 120,
            workMs: fill(9, 1.25),
          })),
          { lean, played },
        );
        for (const p of season) expect([p.settled.length, p.belowMs]).toEqual([1, 0]);
        const leans = season.map((p) => p.lean);
        const expected = lean === 2 ? [2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0] : [1, 0];
        expect(leans.slice(0, expected.length)).toEqual(expected);
        expect(remembered().lean).toBe(0);
      }
    }
  });
});

describe('E. a sudden steady drop', () => {
  // A capable machine at 60 until `drop`, then `fps` at the top as the
  // pixels go; when a step down was first stood on after the drop.
  const steppedAfter = (p: Played, drop: number) =>
    (p.settled.find((s) => s.at > drop && s.index > 0)!.at - drop) / 1000;

  it('has a step kept within 60 s, from 2 to 22 frames a second', () => {
    for (const strict of [false, true]) {
      for (const top of [1.25, 2]) {
        for (const fps of [2, 3, 5, 8, 12, 15, 20, 22]) {
          for (const drop of [SETTLE, 25_000, 40_097, 75_000, 200_000]) {
            const weak = fill(1000 / fps, top);
            const [p] = series([
              {
                refreshHz: 60,
                strict,
                top,
                seconds: drop / 1000 + 70,
                workMs: (r, l, at) => (at < drop ? 9 * (r.ratio / top) ** 2 : weak(r, l, at)),
              },
            ]);
            expect(steppedAfter(p!, drop), `${fps} at ${drop}`).toBeLessThanOrEqual(60);
          }
        }
      }
    }
  });

  it("has one within 60 s of a failed trial's hold, or sooner", () => {
    // A fight at 30 to 44 whatever the rung, long enough to have a trial
    // undone, then the drop: a page slowed well under the trial's before is
    // tried within the hold.
    for (const strict of [false, true]) {
      for (const fightFps of [30, 44]) {
        for (const dropFps of [2, 12, 22]) {
          for (const gap of [0, 15, 60]) {
            const drop = 35_000 + 20_000 + gap * 1000;
            const weak = fill(1000 / dropFps, 1.25);
            const [p] = series([
              {
                refreshHz: 60,
                strict,
                top: 1.25,
                seconds: drop / 1000 + 120,
                workMs: (r, l, at) => {
                  if (at >= drop) return weak(r, l, at);
                  const fight = at > 35_000 && at < 55_000 ? 1000 / fightFps : 0;
                  return Math.max(9 * (r.ratio / 1.25) ** 2, fight);
                },
              },
            ]);
            const label = `${fightFps} then ${dropFps}, ${gap} s apart`;
            expect(steppedAfter(p!, drop), label).toBeLessThanOrEqual(60);
          }
        }
      }
    }
  });
});

describe('F. short matches', () => {
  it('a weak GPU finds its rung and leans from two-minute matches', () => {
    for (const [fps, top, strict] of [
      [20, 1.25, true],
      [25, 2, false],
      [30, 1.5, true],
    ] as const) {
      const { work, played } = weakSeason(fps, top, strict, 120, 4);
      played.forEach((p, i) => {
        stoodOnAHoldingRung(p, holding(work, top, p.lean, strict), `${fps} match ${i + 1}`);
      });
      expect(played[1]!.lean).toBe(1);
    }
  });

  it('a drop early in a match joined late has a step within 60 s', () => {
    for (const fps of [3, 12, 22]) {
      const weak = fill(1000 / fps, 1.25);
      const drop = SETTLE + 15_000;
      const [p] = series([
        {
          refreshHz: 60,
          top: 1.25,
          seconds: 120,
          workMs: (r, l, at) => (at < drop ? 9 * (r.ratio / 1.25) ** 2 : weak(r, l, at)),
        },
      ]);
      const first = p!.settled.find((s) => s.index > 0)!;
      expect((first.at - drop) / 1000, `${fps}`).toBeLessThanOrEqual(60);
    }
  });
});
