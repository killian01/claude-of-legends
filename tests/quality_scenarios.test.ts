// The quality ladder (src/game/quality_ladder.ts) over whole matches on
// realistic machines, the frame sequences that broke its earlier versions:
// a page at 45 frames a second or more, noisy, collected, stalled by
// programs linking or slowed by a fight its pixels have no part in, is
// left alone or goes back to its top; a rung above that hovers about the
// line swings once at most. And matches in a row through the quality dial
// (src/render/quality_dial.ts), the browser's memory between them
// (src/game/quality_memory.ts): such a page never starts the next match
// lower or leaner, and a weak GPU settles on one start instead of
// alternating between two.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rung } from '../src/game/quality_ladder';
import { type Lean, QUALITY_KEY } from '../src/game/quality_memory';
import { QualityDial } from '../src/render/quality_dial';
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

interface Start {
  index: number;
  lean: number;
}

type Work = (rung: Rung, lean: Lean, at: number) => number;

// `matches` classic matches in a row on a laptop whose top is 1.25 and
// whose screen refreshes at 60, each `seconds` long, from a browser that
// remembers nothing yet; a frame's work in the match `i` by its rung, its
// lean and the time. Answers where each one started.
function season(matches: number, seconds: number, work: (i: number) => Work): Start[] {
  store.set(QUALITY_KEY, JSON.stringify({ hz: 60, modes: {} }));
  const starts: Start[] = [];
  for (let i = 0; i < matches; i++) {
    const workMs = work(i);
    const dial = new QualityDial({ mode: 'classic', top: 1.25, phone: false, pin: null, now: 0 });
    starts.push({ index: dial.rungs.indexOf(dial.rung), lean: dial.leanLevel });
    const gl = {
      ratio: dial.rung.ratio,
      shadowMap: { autoUpdate: true, needsUpdate: false },
      domElement: { width: 1920, height: 1080 },
      getPixelRatio: () => gl.ratio,
      setPixelRatio: (r: number) => {
        gl.ratio = r;
      },
    };
    dial.attach({
      gl: gl as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      onRatio() {},
    });
    let at = 0;
    let free = 0;
    while (at < seconds * 1000) {
      free = Math.max(free, at) + workMs(dial.rung, dial.lean, at);
      at = Math.max(at + P, Math.floor(free / P) * P);
      dial.frame(at, 2);
    }
    dial.dispose();
  }
  return starts;
}

// A GPU held back by its pixels: `msAtTop` at the ratio 1.25, as the
// pixels go, 0.87 of it without shadows, 0.63 without the effects' lights
// and 0.83 of that without antialiasing.
const fill =
  (msAtTop: number): Work =>
  (rung, lean) =>
    msAtTop *
    (rung.ratio / 1.25) ** 2 *
    (rung.shadows ? 1 : 0.87) *
    (lean.effectLights ? 1 : 0.63) *
    (lean.antialias ? 1 : 0.83);

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

describe('the next match', () => {
  it('starts at the top with everything after a noisy page that held the line', () => {
    // Six twenty-minute matches, each second at 47 to 56, or 46 to 60,
    // whatever the rung and the lean.
    for (const [lo, hi] of [
      [47, 56],
      [46, 60],
    ] as const) {
      const starts = season(6, 1200, (i) => {
        const page = noisy(lo, hi, 1, 1000 + 17 * i);
        return (rung, _lean, at) => page.workMs(rung, at);
      });
      expect(starts, `${lo}-${hi}`).toEqual(Array(6).fill({ index: 0, lean: 0 }));
    }
  });

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
        const starts = season(2, 540 + seconds + after, () => work);
        expect(starts[1], `${fps} for ${seconds} s, ${after} s before the end`).toEqual({
          index: 0,
          lean: 0,
        });
      }
    }
  });

  it('starts a weak GPU on one rung and lean level, not two in turn', () => {
    // 30 frames a second at the top: a rung down, lean from the second
    // match on, and at the top with the lights off from the third.
    expect(season(6, 900, () => fill(1000 / 30)).map((s) => [s.index, s.lean])).toEqual([
      [0, 0],
      [1, 1],
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    // 22: two rungs down, then one with the lights off, then one with
    // the antialiasing off as well.
    expect(season(6, 900, () => fill(1000 / 22)).map((s) => [s.index, s.lean])).toEqual([
      [0, 0],
      [2, 1],
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    // 45: never anything.
    expect(season(6, 900, () => fill(1000 / 45))).toEqual(Array(6).fill({ index: 0, lean: 0 }));
  });
});
