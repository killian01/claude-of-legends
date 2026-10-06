// What a browser remembers of how finely its last match was drawn
// (src/game/quality_memory.ts): the next match of the same kind starts on
// the rung the last one spent most of its judged time on, at the top on a
// screen with another ratio; a match spent mostly below the top makes the
// next one leaner, the lights first and then the antialiasing, and five
// matches at a level give one back; a line broken or in an older shape is
// dropped.

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
  return afterMatch({ rungs: laptop, spentMs: l.spentMs, start });
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
    const saved = afterMatch({ rungs: one, spentMs: [600_000, 0, 0, 0], start: at(0) });
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
    });
    expect(deep.step).toBe(3);
    expect(matchStart(deep, one).index).toBe(0);
  });
});

describe('what a match leaves for the next', () => {
  const leaves = (spentMs: number[], start = at(0)) =>
    afterMatch({ rungs: laptop, spentMs, start });

  it('is nothing to hold back a match that held the top', () => {
    expect(leaves([10 * MIN, 0, 0, 0, 0])).toEqual(mem(0, 0, 1));
  });

  it('is the rung it spent most of its judged time on', () => {
    expect(leaves([2 * MIN, 7 * MIN, 3 * MIN, 0, 0])).toEqual(mem(1, 1));
    expect(leaves([MIN, 0, 2 * MIN, 9 * MIN, 0])).toEqual(mem(3, 1));
    // Two rungs alike: the finer.
    expect(leaves([0, 5 * MIN, 5 * MIN, 0, 0], at(2, LEANEST))).toEqual(mem(1, LEANEST, 1));
  });

  it('is the top again after a calm climb, with nothing given back at the end', () => {
    // Started two rungs down, a rung up every three minutes: the top for
    // most of a fifteen-minute match.
    expect(leaves([9 * MIN, 3 * MIN, 3 * MIN, 0, 0], at(2, 1))).toEqual(mem(0, 1, 1));
    // A rung down for most of it: still there next time, no rung higher.
    expect(leaves([3 * MIN, 12 * MIN, 0, 0, 0], at(1, LEANEST, 2))).toEqual(mem(1, LEANEST, 3));
  });

  it('makes the next leaner when most of the match was below the top, a level at a time', () => {
    expect(leaves([0, 0, 10 * MIN, 0, 0])).toEqual(mem(2, 1));
    expect(leaves([0, 0, 10 * MIN, 0, 0], at(2, 1, 3))).toEqual(mem(2, 2));
    expect(LEAN_LEVELS[LEANEST]).toEqual({ antialias: false, effectLights: false });
    // Nothing leaner than the leanest.
    expect(leaves([0, 0, 0, 0, 10 * MIN], at(4, LEANEST))).toEqual(mem(4, LEANEST, 1));
    // Half of it is not most of it.
    expect(leaves([5 * MIN, 5 * MIN, 0, 0, 0])).toEqual(mem(0, 0, 1));
  });

  it('makes nothing leaner for a slowdown the match came back from', () => {
    // A step down kept in a fight, the top again three minutes later, or
    // at the very end of the match.
    expect(leaves([7 * MIN, 3 * MIN, 0, 0, 0])).toEqual(mem(0, 0, 1));
    expect(leaves([9 * MIN, MIN, 0, 0, 0], at(0, 1, 1))).toEqual(mem(0, 1, 2));
  });

  it('gives a lean level back after five matches at it, and takes it again when needed', () => {
    // A machine that holds the top once lean: every fifth match at a
    // level tries the one above.
    let memory = mem(0, 2);
    const seen: number[] = [];
    for (let i = 0; i < 2 * RETRY_MATCHES; i++) {
      memory = afterMatch({
        rungs: laptop,
        spentMs: [10 * MIN, 0, 0, 0, 0],
        start: matchStart(memory, laptop),
      });
      seen.push(memory.lean);
    }
    expect(seen).toEqual([2, 2, 2, 2, 1, 1, 1, 1, 1, 0]);
    // One that is below the top again at the level given back leans again.
    const retry = afterMatch({ rungs: laptop, spentMs: [0, 10 * MIN, 0, 0, 0], start: at(0, 1) });
    expect(retry).toEqual(mem(1, 2));
  });

  it('leaves a match not judged at all as it found it', () => {
    expect(leaves([0, 0, 0, 0, 0], at(2, 1, 3))).toEqual(mem(2, 1, 3));
    expect(leaves([0, 0, 0, 0, 0])).toEqual(mem(0));
  });

  it('leans a phone that spent its match without shadows', () => {
    const phone = ladderRungs(1, PHONE_RATIO_FLOOR);
    expect(afterMatch({ rungs: phone, spentMs: [MIN, 9 * MIN], start: at(0) })).toEqual(
      mem(1, 1, 0, 1),
    );
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

  it('a page held short of room two rungs down climbs back, and starts at the top', () => {
    // 54 frames a second whatever the rung, started two rungs down with
    // the lights off: a rung up every three minutes, the top for most of
    // half an hour.
    expect(play(at(2, 1), scriptBound(60, 1000 / 54), 1800)).toEqual(mem(0, 1, 1));
  });

  it('a weak GPU keeps its step and leans', () => {
    // Fill bound: 22 frames a second at the top, 48 two rungs down.
    expect(play(at(0), fillBound(60, 45, 1.25), 600)).toEqual(mem(2, 1));
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
