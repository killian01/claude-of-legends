// What a browser remembers of how finely its last match was drawn
// (src/game/quality_memory.ts): the next match of the same kind starts on
// the rung below the top the last one spent most of its judged time on,
// when it spent two thirds of three minutes or more there, else at the top,
// and at the top on a screen with another ratio; such a match whose top
// did not hold from the start makes the next one leaner, the lights first
// and then the antialiasing, from the top; five matches at a level give one
// back; a line broken or in an older shape is dropped.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_RATIO_FLOOR, ladderRungs, PHONE_RATIO_FLOOR } from '../src/game/quality_ladder';
import {
  afterMatch,
  LEAN_LEVELS,
  LEANEST,
  type MatchStart,
  type ModeMemory,
  matchStart,
  parseQualityMemory,
  QUALITY_KEY,
  RETRY_MATCHES,
  readQualityMemory,
  writeQualityMemory,
} from '../src/game/quality_memory';
import { drive, fillBound, ladderFor, type Machine, scriptBound } from './quality_machine';

const laptop = ladderRungs(1.25, DESK_RATIO_FLOOR);
const mem = (step: number, lean = 0, played = 0, top = 1.25): ModeMemory => ({
  top,
  step,
  lean,
  played,
});
const at = (index: number, lean = 0, played = 0): MatchStart => ({ index, lean, played });
const MIN = 60_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

// A match on the ladder, started as `start`: what it leaves for the next.
function play(start: MatchStart, m: Machine, seconds: number): ModeMemory {
  const l = ladderFor(1.25, start.index, 60);
  drive(l, m, seconds);
  return afterMatch({ rungs: laptop, spentMs: l.spentMs, start, fellEarly: l.fellEarly });
}

describe('the start of a match', () => {
  it('is the top with everything, for a browser that remembers nothing', () => {
    expect(matchStart(undefined, laptop)).toEqual(at(0));
    expect(LEAN_LEVELS[0]).toEqual({ antialias: true, effectLights: true });
  });

  it('is the step below the top the last match left', () => {
    expect(matchStart(mem(2, 1, 3), laptop)).toEqual(at(2, 1, 3));
    expect(matchStart(mem(4, 1), laptop)).toEqual(at(4, 1));
    expect(matchStart(mem(0, 1), laptop)).toEqual(at(0, 1));
    // Never past the last rung.
    expect(matchStart(mem(9), laptop).index).toBe(4);
  });

  it('is the top on a screen with another ratio', () => {
    // A zoom, another monitor: the steps were another screen's. Its lean
    // level carries over.
    expect(matchStart(mem(2, 1, 2, 1), laptop)).toEqual(at(0, 1, 2));
    expect(matchStart(mem(2, 1, 2, 2), laptop)).toEqual(at(0, 1, 2));
  });

  it('is the top after a match on a lower ratio that held its top', () => {
    // A match at a ratio of 1 held its top; the next, on a 1.5 or 2
    // panel, is not capped at 1.
    const one = ladderRungs(1, DESK_RATIO_FLOOR);
    const saved = afterMatch({
      rungs: one,
      spentMs: [600_000, 0, 0, 0],
      start: at(0),
      fellEarly: false,
    });
    for (const top of [1.1, 1.25, 1.5, 2]) {
      const rungs = ladderRungs(top, DESK_RATIO_FLOOR);
      expect(rungs[matchStart(saved, rungs).index]!.ratio).toBe(top);
    }
    // Nor the other way: a 2 panel's third step is not a 1 screen's.
    const two = ladderRungs(2, DESK_RATIO_FLOOR);
    const deep = afterMatch({
      rungs: two,
      spentMs: [10_000, 0, 0, 590_000, 0, 0, 0, 0],
      start: at(0),
      fellEarly: false,
    });
    expect(deep.step).toBe(3);
    expect(matchStart(deep, one).index).toBe(0);
  });
});

describe('what a match leaves for the next', () => {
  const leaves = (spentMs: number[], start = at(0), fellEarly = false) =>
    afterMatch({ rungs: laptop, spentMs, start, fellEarly });

  it('is nothing to hold back a match that held the top', () => {
    expect(leaves([10 * MIN, 0, 0, 0, 0])).toEqual(mem(0, 0, 1));
  });

  it('is the rung below the top it spent most of its time on, when that was most of it', () => {
    expect(leaves([2 * MIN, 7 * MIN, 3 * MIN, 0, 0])).toEqual(mem(1, 0, 1));
    expect(leaves([MIN, 0, 2 * MIN, 9 * MIN, 0])).toEqual(mem(3, 0, 1));
    // Two thirds of three minutes, just.
    expect(leaves([MIN, 2 * MIN, 0, 0, 0])).toEqual(mem(1, 0, 1));
    // Two rungs alike: the finer.
    expect(leaves([0, 5 * MIN, 5 * MIN, 0, 0], at(2, LEANEST))).toEqual(mem(1, LEANEST, 1));
  });

  it('is the top after a match judged under three minutes, or not two thirds below', () => {
    expect(leaves([0, 0, 2.9 * MIN, 0, 0], at(2, 1), true)).toEqual(mem(0, 1, 1));
    expect(leaves([4 * MIN, 7 * MIN, 0, 0, 0])).toEqual(mem(0, 0, 1));
    // A calm climb back from a start below: the top again.
    expect(leaves([9 * MIN, 3 * MIN, 3 * MIN, 0, 0], at(2, 1))).toEqual(mem(0, 1, 1));
  });

  it('makes the next leaner on that evidence when the top did not hold from the start', () => {
    // The start probe given up, or a step down from the top kept in the
    // first three judged minutes: the next one leaner, from the top.
    expect(leaves([0, 0, 10 * MIN, 0, 0], at(0), true)).toEqual(mem(0, 1));
    expect(leaves([0, 0, 10 * MIN, 0, 0], at(2, 1, 3), true)).toEqual(mem(0, 2));
    expect(LEAN_LEVELS[LEANEST]).toEqual({ antialias: false, effectLights: false });
    // Nothing leaner than the leanest: the step kept.
    expect(leaves([0, 0, 0, 0, 10 * MIN], at(4, LEANEST), true)).toEqual(mem(4, LEANEST, 1));
    // A top that held from the start and gave way later: the step, no lean.
    expect(leaves([0, 0, 10 * MIN, 0, 0], at(0), false)).toEqual(mem(2, 0, 1));
  });

  it('makes nothing leaner for a slowdown the match came back from, or a short match', () => {
    expect(leaves([7 * MIN, 3 * MIN, 0, 0, 0], at(0), true)).toEqual(mem(0, 0, 1));
    expect(leaves([9 * MIN, MIN, 0, 0, 0], at(0, 1, 1), true)).toEqual(mem(0, 1, 2));
    expect(leaves([0, 2 * MIN, 0, 0, 0], at(0), true)).toEqual(mem(0, 0, 1));
  });

  it('gives a lean level back after five matches at it, from the top', () => {
    // A machine that holds the top once lean: every fifth match at a
    // level tries the one above.
    let memory = mem(0, 2);
    const seen: number[] = [];
    for (let i = 0; i < 2 * RETRY_MATCHES; i++) {
      memory = afterMatch({
        rungs: laptop,
        spentMs: [10 * MIN, 0, 0, 0, 0],
        start: matchStart(memory, laptop),
        fellEarly: false,
      });
      seen.push(memory.lean);
    }
    expect(seen).toEqual([2, 2, 2, 2, 1, 1, 1, 1, 1, 0]);
    // The step a level kept is no guide to the one given back.
    expect(leaves([0, 10 * MIN, 0, 0, 0], at(1, 2, 4), true)).toEqual(mem(0, 1));
    // One that falls from the top again at the level given back leans again.
    expect(leaves([0, 10 * MIN, 0, 0, 0], at(0, 1), true)).toEqual(mem(0, 2));
  });

  it('leaves a match not judged at all as it found it', () => {
    expect(leaves([0, 0, 0, 0, 0], at(2, 1, 3))).toEqual(mem(2, 1, 3));
    expect(leaves([0, 0, 0, 0, 0])).toEqual(mem(0));
  });

  it('leans a phone that spent its match without shadows', () => {
    const phone = ladderRungs(1, PHONE_RATIO_FLOOR);
    expect(
      afterMatch({ rungs: phone, spentMs: [MIN, 9 * MIN], start: at(0), fellEarly: true }),
    ).toEqual(mem(0, 1, 0, 1));
  });
});

describe('a match played, then the next', () => {
  it('a short fight on a capable machine leaves nothing', () => {
    // 60 frames a second but five seconds at 45, pixels or not.
    const m: Machine = {
      refreshMs: 1000 / 60,
      workMs: (_r, t) => (t > 40_000 && t < 45_500 ? 1000 / 45 : 9),
    };
    expect(play(at(0), m, 600)).toEqual(mem(0, 0, 1));
  });

  it('a page started two rungs down with room at the top leaves the top', () => {
    // 54 frames a second whatever the rung: at the top from the start
    // probe, which is not judged.
    expect(play(at(2, 1), scriptBound(60, 1000 / 54), 1800)).toEqual(mem(0, 1, 1));
  });

  it('a weak GPU leans, and the next match looks for its rung from the top', () => {
    // Fill bound: 22 frames a second at the top, 48 two rungs down.
    expect(play(at(0), fillBound(60, 45, 1.25), 600)).toEqual(mem(0, 1));
  });

  it('a weak GPU started on its rung keeps it, the top tried and given up', () => {
    expect(play(at(2, LEANEST, 1), fillBound(60, 45, 1.25), 600)).toEqual(mem(2, LEANEST, 2));
  });

  it('a GPU that slows only in its fourth minute keeps its step, no leaner', () => {
    // 9 ms a frame, then 22 frames a second at the top from 200 s on.
    const m: Machine = {
      refreshMs: 1000 / 60,
      workMs: (r, t) => (t < 200_000 ? 9 : 45) * (r.ratio / 1.25) ** 2,
    };
    expect(play(at(0), m, 900)).toEqual(mem(2, 0, 1));
  });

  it('a weak GPU in a match judged under three minutes leaves the top', () => {
    expect(play(at(0), fillBound(60, 45, 1.25), 150)).toEqual(mem(0, 0, 1));
  });
});

describe('the stored line', () => {
  it('reads back what was written', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    const memory = { hz: 60, modes: { classic: mem(2, 1, 3) } };
    writeQualityMemory(memory);
    expect(store.has(QUALITY_KEY)).toBe(true);
    expect(readQualityMemory()).toEqual(memory);
  });

  it('is dropped when broken, out of range or in an older shape, never trusted', () => {
    const empty = { hz: null, modes: {} };
    expect(parseQualityMemory(null)).toEqual(empty);
    expect(parseQualityMemory('{')).toEqual(empty);
    expect(parseQualityMemory('7')).toEqual(empty);
    expect(
      parseQualityMemory(
        JSON.stringify({
          hz: 9000,
          modes: {
            classic: { top: 99, step: 0, lean: 0, played: 0 },
            royale: { top: 1, step: 1, lean: 7, played: 0 },
            other: { top: 1, step: 0, lean: 0, played: 0 },
          },
        }),
      ),
    ).toEqual(empty);
    // A step that is no step, a count past the retry, and the lines of
    // earlier shapes: one that gave a rung back at each match's end, and
    // one before it.
    for (const classic of [
      mem(-1),
      mem(1.5),
      mem(0, 1, RETRY_MATCHES + 1),
      { top: 1.25, step: 1, lean: 1 },
      { ratio: 1, shadows: true, lean: 0, quiet: 0 },
    ]) {
      expect(parseQualityMemory(JSON.stringify({ hz: 60, modes: { classic } }))).toEqual({
        hz: 60,
        modes: {},
      });
    }
    expect(
      parseQualityMemory(JSON.stringify({ hz: 144, modes: { royale: mem(3, 2, 4, 1) } })),
    ).toEqual({ hz: 144, modes: { royale: mem(3, 2, 4, 1) } });
  });

  it('is nothing at all where the browser keeps nothing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readQualityMemory()).toEqual({ hz: null, modes: {} });
    expect(() => writeQualityMemory({ hz: null, modes: {} })).not.toThrow();
  });
});
