// The quality ladder (src/game/quality_ladder.ts) over whole matches on
// realistic machines, and matches in a row through the quality dial
// (src/render/quality_dial.ts) and the browser's memory between them
// (src/game/quality_memory.ts), held to what the design answers for:
//
// A. A capable machine (60, 120 or 144 Hz, its frames shown as they come
//    or on the refresh after, holding the line but for what slows it a
//    while: fights, assets streaming, programs linking, collections,
//    hitches, a hidden tab, a resize, another pixel ratio between matches)
//    is at the top within 30 s of each match's settling, below it for a
//    tenth of the judged time at most, and never leaner.
// B. So is a page held back by its script whose rate is drawn afresh every
//    1, 2 or 5 s, whatever the rung, from 40-55 to 46-60.
// C. A weak GPU (20 to 30 frames a second at the top, a ratio of 1.25 or
//    1.5) rests within 60 s of each settling on the finest rung that holds
//    the line on its lean level, swings once at most in half an hour, is
//    leaner within two matches, and the retry every fifth match costs that
//    match alone.
// D. A machine that got faster is at the top from the next match's start
//    probe, and its lean falls a level each retry, never rising, to none.
// E. A sudden steady drop to 2 to 22 frames a second has a step kept that
//    gains within 40 s.
// F. Matches of 2 to 10 minutes, as when a player joins a running one,
//    change none of that, but for what a match judged under three minutes
//    cannot tell: it leaves the next at the top with its lean.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModeMemory, QUALITY_KEY } from '../src/game/quality_memory';
import { SETTLE_MS } from '../src/render/quality_dial';
import {
  capableMatch,
  deepest,
  drive,
  fill,
  finestHolding,
  ladderFor,
  type Machine,
  type MatchMachine,
  noisy,
  type Played,
  playMatch,
  restingAt,
  sequence,
  swings,
  swingsOf,
  type Work,
} from './quality_machine';

const P = 1000 / 60;

let store: Map<string, string>;

beforeEach(() => {
  // A browser that keeps its memory, its menus having drawn at 60.
  store = new Map([[QUALITY_KEY, JSON.stringify({ hz: 60, modes: {} })]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Matches in a row from a browser that remembers only its screen's rate,
// or `memory` as well.
function series(hz: number, machines: MatchMachine[], memory?: ModeMemory): Played[] {
  store.set(QUALITY_KEY, JSON.stringify({ hz, modes: memory ? { classic: memory } : {} }));
  return machines.map(playMatch);
}

const remembered = (): ModeMemory | undefined =>
  JSON.parse(store.get(QUALITY_KEY)!).modes.classic as ModeMemory | undefined;

// A and B: at the top within 30 s of the settling, below it a tenth of the
// judged time at most, never leaner.
function heldTheTop(p: Played, label: string): void {
  expect(p.topAfter, label).not.toBeNull();
  expect(p.topAfter!, label).toBeLessThanOrEqual(30);
  expect(p.belowMs, label).toBeLessThanOrEqual(0.1 * p.judgedMs);
  expect(p.start.lean, label).toBe(0);
}

const LENGTHS = [120, 300, 600, 1200];

describe('A. a capable machine, whatever slows it a while', () => {
  it.each([
    [60, false],
    [60, true],
    [120, false],
    [120, true],
    [144, false],
    [144, true],
  ])('holds the top at %i Hz, shown on the refresh after: %s', (hz, strict) => {
    for (const seconds of LENGTHS) {
      for (let seed = 1; seed <= 4; seed++) {
        const rand = sequence(seed * 7919 + seconds + hz * 13 + (strict ? 1 : 0));
        // Another pixel ratio now and then between matches.
        const tops = Array.from({ length: 6 }, () =>
          rand() < 0.3 ? [1, 1.5, 2][Math.floor(rand() * 3)]! : 1.25,
        );
        const machines = tops.map((top) => ({ ...capableMatch(rand, hz, seconds, top), strict }));
        series(hz, machines).forEach((p, i) => {
          heldTheTop(p, `${seconds} s, seed ${seed}, match ${i + 1}`);
        });
        expect(remembered()?.lean ?? 0).toBe(0);
      }
    }
  });
});

describe('B. a page held back by its script, noisily', () => {
  it.each([
    [40, 55],
    [42, 56],
    [44, 58],
    [46, 60],
  ])('holds the top while each second, two or five draw %i to %i', (lo, hi) => {
    for (const every of [1, 2, 5]) {
      for (const seconds of LENGTHS) {
        for (let seed = 1; seed <= 4; seed++) {
          const machines = Array.from({ length: 6 }, (_, i): MatchMachine => {
            const page = noisy(lo, hi, every, seed * 7717 + i * 131 + seconds);
            return {
              refreshHz: 60,
              top: 1.25,
              seconds,
              workMs: (rung, _lean, at) => page.workMs(rung, at),
            };
          });
          series(60, machines).forEach((p, i) => {
            heldTheTop(p, `every ${every} s, ${seconds} s, seed ${seed}, match ${i + 1}`);
          });
        }
      }
    }
  });
});

// C: matches in a row on a weak GPU; each rests, from 60 s after its
// settling, on the finest rung that holds the line on its lean level.
function weakSeason(fps: number, top: number, strict: boolean, seconds: number, n: number) {
  const work = fill(1000 / fps, top);
  const played = series(
    60,
    Array.from({ length: n }, () => ({ refreshHz: 60, strict, top, seconds, workMs: work })),
  );
  return { work, played };
}

function restedOnItsRung(p: Played, finest: number, label: string): void {
  const from = SETTLE_MS + 60_000;
  expect(restingAt(p, from), label).toBe(finest);
  expect(
    p.rests.filter((r) => r.at > from).map((r) => r.index),
    label,
  ).toEqual([]);
}

describe('C. a weak GPU', () => {
  const cases: [number, number, boolean][] = [];
  for (const fps of [20, 22, 25, 28, 30]) {
    for (const top of [1.25, 1.5])
      for (const strict of [false, true]) cases.push([fps, top, strict]);
  }

  it.each(cases)(
    'at %i frames a second, top %d, strict %s: one rung, leaner, one retry',
    (fps, top, strict) => {
      const { work, played } = weakSeason(fps, top, strict, 900, 14);
      played.forEach((p, i) => {
        const label = `match ${i + 1} from ${p.start.index}/${p.start.lean}`;
        const finest = finestHolding(work, top, p.start.lean, 60, strict);
        // Every frame two refreshes from the top to the floor with shadows,
        // one only without them: three rungs past one that gains nothing,
        // where the walk goes one rung further at most. The lean takes it
        // from the next match.
        const walled = fps === 20 && top === 1.25 && strict && p.start.lean === 0;
        restedOnItsRung(p, walled ? 1 : finest!, label);
        expect(swingsOf(p.settled), label).toBeLessThanOrEqual(1);
      });
      const leans = played.map((p) => p.start.lean);
      // Leaner within two matches.
      if (finestHolding(work, top, 0, 60, strict) !== 0) expect(leans[2]).toBeGreaterThan(0);
      // From the fourth on, the lean it needs, but for a retry every fifth
      // match, the one after it back at the lean it needs.
      const needed = leans[3]!;
      leans.slice(3).forEach((lean, i) => {
        if (lean === needed) return;
        expect(lean, `match ${i + 4}`).toBe(needed - 1);
        if (i + 4 < leans.length) expect(leans[i + 4], `match ${i + 5}`).toBe(needed);
      });
      expect(leans.slice(3).filter((l) => l !== needed).length).toBeLessThanOrEqual(3);
    },
  );

  it('swings once at most over half an hour from a browser that remembers nothing', () => {
    for (const [fps, top] of [
      [20, 1.25],
      [25, 1.5],
      [30, 1.25],
    ] as const) {
      for (const strict of [false, true]) {
        const { played } = weakSeason(fps, top, strict, 1800, 2);
        for (const p of played) expect(swingsOf(p.settled), `${fps} ${top}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('D. a machine that got faster', () => {
  it('is at the top from the next start probe, and its lean falls a level each retry', () => {
    const top = 1.25;
    for (const seconds of [120, 600]) {
      for (const strict of [false, true]) {
        for (const [step, lean, played] of [
          [1, 1, 0],
          [2, 1, 0],
          [1, 2, 2],
          [2, 2, 0],
          [3, 1, 0],
          [4, 2, 0],
          [4, 0, 0],
        ] as const) {
          const label = `${seconds} s from ${step}/${lean}/${played}`;
          const machines = Array.from({ length: 12 }, () => ({
            refreshHz: 60,
            strict,
            top,
            seconds,
            workMs: fill(9, top),
          }));
          const season = series(60, machines, { top, step, lean, played });
          // The first match tries the top right after its settling and
          // stays; the next ones start there.
          expect(season[0]!.topAfter!, label).toBeLessThanOrEqual(12);
          expect(season[0]!.belowMs, label).toBe(0);
          expect(
            season.slice(1).map((p) => p.start.index),
            label,
          ).toEqual(Array(11).fill(0));
          for (const p of season) expect(p.belowMs, label).toBe(0);
          // One level back after each five matches at it, never one more.
          const leans = season.map((p) => p.start.lean);
          for (let i = 1; i < leans.length; i++) {
            expect(leans[i]!, label).toBeLessThanOrEqual(leans[i - 1]!);
          }
          const zero = leans.indexOf(0);
          expect(zero, label).toBeGreaterThanOrEqual(0);
          expect(zero, label).toBeLessThanOrEqual(5 * lean - played);
        }
      }
    }
  });
});

describe('E. a sudden steady drop', () => {
  it('has a step kept that gains within 40 s, from 2 to 22 frames a second', () => {
    for (const strict of [false, true]) {
      for (const fps of [2, 3, 5, 8, 12, 15, 20, 22]) {
        for (const drop of [40_000, 40_097, 40_194, 40_291, 40_388, 75_000, 200_000]) {
          const after = fill(1000 / fps, 1.25);
          const [p] = series(60, [
            {
              refreshHz: 60,
              strict,
              top: 1.25,
              seconds: drop / 1000 + 60,
              workMs: (rung, lean, at) => (at < drop ? 9 : after(rung, lean, at)),
            },
          ]);
          const kept = p!.rests.find((r) => r.at > drop && r.index > 0);
          expect(kept, `${fps} at ${drop}`).toBeDefined();
          expect(kept!.at - drop, `${fps} at ${drop}`).toBeLessThanOrEqual(40_000);
        }
      }
    }
  });
});

describe('F. short matches', () => {
  it('a weak GPU still finds its rung within a minute, and leans from five-minute matches', () => {
    for (const [fps, top, strict] of [
      [22, 1.25, false],
      [25, 1.5, true],
      [30, 1.25, false],
    ] as const) {
      for (const seconds of [120, 300]) {
        const { work, played } = weakSeason(fps, top, strict, seconds, 8);
        played.forEach((p, i) => {
          const finest = finestHolding(work, top, p.start.lean, 60, strict)!;
          restedOnItsRung(p, finest, `${fps} ${seconds} s match ${i + 1}`);
        });
        const leans = played.map((p) => p.start.lean);
        if (seconds >= 300) expect(leans[2]).toBeGreaterThan(0);
        // Judged under three minutes, a match tells too little to keep:
        // each starts at the top with everything and finds its rung.
        else
          expect(played.map((p) => [p.start.index, p.start.lean])).toEqual(Array(8).fill([0, 0]));
      }
    }
  });

  it('a drop early in a match joined late has a step kept within 40 s', () => {
    for (const fps of [3, 12, 22]) {
      const after = fill(1000 / fps, 1.25);
      const drop = SETTLE_MS + 15_000;
      const [p] = series(60, [
        {
          refreshHz: 60,
          top: 1.25,
          seconds: 120,
          workMs: (rung, lean, at) => (at < drop ? 9 : after(rung, lean, at)),
        },
      ]);
      const kept = p!.rests.find((r) => r.at > drop && r.index > 0);
      expect(kept!.at - drop, `${fps}`).toBeLessThanOrEqual(40_000);
    }
  });
});

describe('a page held back by its script, noisily', () => {
  it('keeps no step down when each second draws 46 to 60', () => {
    const l = ladderFor(1.25, 0, 60);
    expect(drive(l, noisy(46, 60, 1, 977), 1800).changes).toEqual([]);
  });

  it('keeps no step down however its seconds come, while their median holds the line', () => {
    const cases = [
      [47, 56, 1],
      [47, 56, 2],
      [46, 60, 2],
      [48, 60, 1],
      [48, 60, 2],
      [44, 58, 1],
    ] as const;
    for (const [lo, hi, every] of cases) {
      for (let seed = 1; seed <= 10; seed++) {
        const run = drive(ladderFor(1.25, 0, 60), noisy(lo, hi, every, seed * 977), 1800);
        expect(run.settled, `${lo}-${hi} every ${every} s, seed ${seed}`).toEqual([0]);
      }
    }
  });
});

describe('a capable machine', () => {
  it('never steps for collections that pause it twice a second', () => {
    // 9 ms frames, one in thirty taking 30 to 90 ms more: 54 a second.
    for (let seed = 1; seed <= 6; seed++) {
      const next = sequence(seed);
      const m: Machine = {
        refreshMs: P,
        workMs: () => 9 + (next() < 1 / 30 ? 30 + 60 * next() : 0),
      };
      expect(drive(ladderFor(1.25, 0, 60), m, 1800).changes).toEqual([]);
    }
  });

  it('never steps for a fight drawn at 46 to 55, on a 60, 120 or 144 Hz screen', () => {
    for (const hz of [60, 120, 144]) {
      const base = hz === 60 ? 9 : 5.5;
      for (const fps of [46, 50, 55]) {
        for (const seconds of [3, 5, 8]) {
          for (let offset = 0; offset < 1000; offset += 250) {
            const from = 60_000 + offset;
            const m: Machine = {
              refreshMs: 1000 / hz,
              workMs: (_r, at) => (at > from && at < from + seconds * 1000 ? 1000 / fps : base),
            };
            const run = drive(ladderFor(1.25, 0, hz), m, 300);
            expect(run.changes, `${hz} Hz, ${fps} for ${seconds} s`).toEqual([]);
          }
        }
      }
    }
  });

  it('never steps for programs linking a few frames in a row', () => {
    // From 40 s, `n` frames of `ms` in a row every `every` ms, for `span`
    // ms: the programs a fight's spells link the first time they show.
    const bursts = [
      [3, 300, 1000, 4000],
      [3, 300, 1000, 6000],
      [4, 400, 1500, 6000],
      [5, 300, 2000, 8000],
      [2, 300, 500, 4000],
    ] as const;
    for (const [n, ms, every, span] of bursts) {
      let left = 0;
      let next = 40_000;
      const m: Machine = {
        refreshMs: P,
        workMs: (_r, at) => {
          if (at >= next && at < 40_000 + span) {
            left = n;
            next += every;
          }
          if (left === 0) return 9;
          left--;
          return ms;
        },
      };
      // Back to back they are a pace of their own for a few seconds: a step
      // may be tried, never kept.
      const l = ladderFor(1.25, 0, 60);
      expect(drive(l, m, 300).settled, `${n} x ${ms} ms`).toEqual([0]);
      expect(l.spentMs[0], `${n} x ${ms} ms`).toBe(l.judgedMs);
    }
  });

  it('goes two rungs down at most for a slowdown its pixels have no part in, and back', () => {
    // 34 ms a frame whatever the rung, from a minute in: 30 a second. A
    // rung tried, one further while every frame still takes two
    // refreshes, kept when the slowdown ends during the trial; the top
    // again within the match.
    for (const strict of [false, true]) {
      for (const seconds of [4, 6, 8, 10, 12, 16, 20]) {
        const m: Machine = {
          refreshMs: P,
          strict,
          workMs: (_r, at) => (at > 60_000 && at < 60_000 + seconds * 1000 ? 34 : 9),
        };
        const l = ladderFor(1.25, 0, 60);
        const run = drive(l, m, 600);
        expect(deepest(run), `${seconds} s`).toBeLessThanOrEqual(2);
        expect(l.index, `${seconds} s`).toBe(0);
      }
    }
    // At 45 a second, one refresh and two: nothing at all.
    const m: Machine = {
      refreshMs: P,
      workMs: (_r, at) => (at > 60_000 && at < 80_000 ? 22 : 9),
    };
    expect(drive(ladderFor(1.25, 0, 60), m, 600).changes).toEqual([]);
  });

  it('never steps for hitches, collections, a hidden tab, the warm-up or a resize', () => {
    for (const hz of [60, 120, 144]) {
      const base = hz === 60 ? 9 : 5.5;
      for (const strict of [false, true]) {
        for (const clock of ['ms', 'jitter'] as const) {
          const next = sequence(99);
          const cases: Record<string, Partial<Machine>> = {
            calm: {},
            collections: { workMs: () => base + (next() < 1 / 120 ? 20 + 100 * next() : 0) },
            hitch: { workMs: () => base + (next() < 1 / 1200 ? 200 : 0) },
            hitches: {
              workMs: (_r, at) =>
                base + (at > 60_000 && at < 63_000 && at % 1000 < 1000 / hz ? 200 : 0),
            },
            hidden: {
              hidden: [
                [100_000, 130_000],
                [200_000, 200_500],
              ],
            },
            warmup: { gaps: [[0, 6000]] },
            resize: { workMs: (_r, at) => base + (Math.abs(at - 90_000) < 500 / hz ? 150 : 0) },
          };
          for (const [name, extra] of Object.entries(cases)) {
            const m: Machine = {
              refreshMs: 1000 / hz,
              strict,
              clock,
              workMs: () => base,
              ...extra,
            };
            const run = drive(ladderFor(1.25, 0, hz), m, 600);
            expect(run.changes, `${hz} Hz ${strict ? 'strict' : ''} ${clock} ${name}`).toEqual([]);
          }
        }
      }
    }
  });
});

describe('a rung above that hovers about the line', () => {
  it('swings once at most in half an hour, twice when its rates last a minute', () => {
    // The rung below holds 60; the top draws a rate drawn afresh every
    // `every` seconds. A step up given up within three minutes of being
    // kept holds the ladder where it is for the rest of the match; one
    // given up later, a minute's rate after three, is no hover.
    const ranges = [
      [47, 56],
      [49, 53],
      [50, 54],
      [48, 58],
      [45, 60],
      [40, 60],
    ] as const;
    for (const [lo, hi] of ranges) {
      for (const every of [5, 15, 60]) {
        for (let seed = 1; seed <= 4; seed++) {
          const top = noisy(lo, hi, every, seed * 7919);
          const m: Machine = {
            refreshMs: P,
            workMs: (r, at) => (r.ratio < 1.25 ? 10 : top.workMs(r, at)),
          };
          const run = drive(ladderFor(1.25, 0, 60), m, 1800);
          const most = every < 60 ? 1 : 2;
          expect(swings(run), `${lo}-${hi} every ${every} s, seed ${seed}`).toBeLessThanOrEqual(
            most,
          );
        }
      }
    }
  });
});

describe('the next match', () => {
  it('starts at the top with everything after a slowdown near the end of the last', () => {
    // A capable machine, a last fight its pixels have no part in nine
    // minutes in, and the match over 20 to 90 seconds after it.
    for (const [fps, seconds] of [
      [45, 5],
      [40, 4],
      [30, 8],
      [30, 12],
      [30, 16],
    ] as const) {
      for (const after of [20, 40, 60, 90]) {
        const work: Work = (_r, _l, at) =>
          at > 540_000 && at < 540_000 + seconds * 1000 ? 1000 / fps : 9;
        const match = { refreshHz: 60, top: 1.25, seconds: 540 + seconds + after, workMs: work };
        const [, next] = series(60, [match, match]);
        expect(next!.start, `${fps} for ${seconds} s, ${after} s before the end`).toEqual({
          index: 0,
          lean: 0,
        });
      }
    }
  });
});
