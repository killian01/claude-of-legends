// The quality ladder (src/game/quality_ladder.ts) over whole matches on
// realistic machines, the frame sequences that broke its earlier versions:
// a page at 45 frames a second or more, noisy, collected, stalled by
// programs linking or slowed by a fight its pixels have no part in, is
// left alone or goes back to its top; a rung above that hovers about the
// line swings once at most.

import { describe, expect, it } from 'vitest';
import {
  deepest,
  drive,
  ladderFor,
  type Machine,
  noisy,
  sequence,
  swings,
} from './quality_machine';

const P = 1000 / 60;

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
      expect(drive(ladderFor(1.25, 0, 60), m, 300).changes, `${n} x ${ms} ms`).toEqual([]);
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
  it('swings once at most in half an hour, however long each rate lasts', () => {
    // The rung below holds 60; the top draws a rate drawn afresh every
    // `every` seconds. A step up kept and given up holds the ladder where
    // it is for the rest of the match.
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
          expect(swings(run), `${lo}-${hi} every ${every} s, seed ${seed}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
