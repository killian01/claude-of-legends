// What a browser remembers of how finely its last match was drawn
// (src/game/quality_memory.ts): the next match of the same kind starts
// at the step below the top the last one settled on, a rung higher unless
// that one kept a step down, and at the top on a screen with another
// ratio; a match that kept a step down and stayed below the top makes the
// next one leaner, the lights first and then the antialiasing; one that
// ended at the top gives a level back; a short slowdown leaves nothing; a
// broken line is dropped.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESK_RATIO_FLOOR,
  ladderRungs,
  PHONE_RATIO_FLOOR,
  QualityLadder,
  type Rung,
} from '../src/game/quality_ladder';
import {
  afterMatch,
  LEAN_LEVELS,
  LEANEST,
  type ModeMemory,
  matchStart,
  parseQualityMemory,
  QUALITY_KEY,
  readQualityMemory,
  TOLD_MS,
  writeQualityMemory,
} from '../src/game/quality_memory';

const laptop = ladderRungs(1.25, DESK_RATIO_FLOOR);
const mem = (step: number, lean = 0, top = 1.25): ModeMemory => ({ top, step, lean });

afterEach(() => {
  vi.unstubAllGlobals();
});

// A match on the ladder: each frame's interval in ms, by the rung it is
// drawn on and the time; answers what it leaves for the next.
function play(
  rungs: readonly Rung[],
  start: { index: number; lean: number },
  seconds: number,
  interval: (rung: Rung, at: number) => number,
): ModeMemory {
  const l = new QualityLadder(rungs, { index: start.index, known: 60, settleUntil: 10_000 });
  let at = 0;
  while (at < seconds * 1000) {
    at += interval(l.rung, at);
    l.frame(at);
  }
  return afterMatch({
    rungs,
    settled: l.settled,
    deepest: l.deepest,
    judgedMs: l.judgedMs,
    belowMs: l.belowMs,
    lean: start.lean,
  });
}
const P = 1000 / 60;

describe('the start of a match', () => {
  it('is the top with everything, for a browser that remembers nothing', () => {
    expect(matchStart(undefined, laptop)).toEqual({ index: 0, lean: 0 });
    expect(LEAN_LEVELS[0]).toEqual({ antialias: true, effectLights: true });
  });

  it('is the step below the top the last match left', () => {
    expect(matchStart(mem(2, 1), laptop)).toEqual({ index: 2, lean: 1 });
    expect(matchStart(mem(4, 1), laptop)).toEqual({ index: 4, lean: 1 });
    expect(matchStart(mem(0, 1), laptop)).toEqual({ index: 0, lean: 1 });
    // Never past the last rung.
    expect(matchStart(mem(9), laptop).index).toBe(4);
  });

  it('is the top on a screen with another ratio', () => {
    // A zoom, another monitor: the steps were another screen's. Its lean
    // level carries over.
    expect(matchStart(mem(2, 1, 1), laptop)).toEqual({ index: 0, lean: 1 });
    expect(matchStart(mem(2, 1, 2), laptop)).toEqual({ index: 0, lean: 1 });
  });

  it('is the top after a match on a lower ratio that never stepped down', () => {
    // A match at a ratio of 1 held its top; the next, on a 1.5 or 2
    // panel, is not capped at 1.
    const saved = afterMatch({
      rungs: ladderRungs(1, DESK_RATIO_FLOOR),
      settled: 0,
      deepest: null,
      judgedMs: 600_000,
      belowMs: 0,
      lean: 0,
    });
    for (const top of [1.1, 1.25, 1.5, 2]) {
      const rungs = ladderRungs(top, DESK_RATIO_FLOOR);
      expect(rungs[matchStart(saved, rungs).index]!.ratio).toBe(top);
    }
    // Nor the other way: a 2 panel's third step is not a 1 screen's.
    const deep = afterMatch({
      rungs: ladderRungs(2, DESK_RATIO_FLOOR),
      settled: 3,
      deepest: 3,
      judgedMs: 600_000,
      belowMs: 590_000,
      lean: 0,
    });
    expect(matchStart(deep, ladderRungs(1, DESK_RATIO_FLOOR)).index).toBe(0);
  });
});

describe('what a match leaves for the next', () => {
  const at = (
    settled: number,
    deepest: number | null,
    o: { lean?: number; judgedMs?: number; belowMs?: number } = {},
  ) => {
    const judgedMs = o.judgedMs ?? 300_000;
    return {
      rungs: laptop,
      settled,
      deepest,
      judgedMs,
      belowMs: o.belowMs ?? (settled > 0 ? judgedMs : 0),
      lean: o.lean ?? 0,
    };
  };

  it('is nothing to hold back a match that held the top', () => {
    expect(afterMatch(at(0, null))).toEqual({ top: 1.25, step: 0, lean: 0 });
  });

  it('keeps a step down kept, without the lights and a rung higher for it', () => {
    expect(afterMatch(at(2, 2))).toEqual({ top: 1.25, step: 1, lean: 1 });
  });

  it('turns the antialiasing off only once a lean match still reached its floor', () => {
    expect(afterMatch(at(2, 2, { lean: 1 }))).toEqual({ top: 1.25, step: 2, lean: 1 });
    expect(afterMatch(at(4, 4, { lean: 1 }))).toEqual({ top: 1.25, step: 3, lean: 2 });
    expect(LEAN_LEVELS[LEANEST]).toEqual({ antialias: false, effectLights: false });
    // Nothing leaner than the leanest.
    expect(afterMatch(at(4, 4, { lean: LEANEST }))).toEqual({
      top: 1.25,
      step: 4,
      lean: LEANEST,
    });
  });

  it('starts the next a rung higher when this one kept no step down', () => {
    // Started two rungs down and held there: the memory gives way, one
    // rung a match, then a lean level once a match ends at the top.
    let memory = mem(2, 1);
    const seen: ModeMemory[] = [];
    for (let i = 0; i < 3; i++) {
      memory = afterMatch(at(memory.step, null, { lean: memory.lean }));
      seen.push(memory);
    }
    expect(seen).toEqual([mem(1, 1), mem(0, 1), mem(0, 0)]);
  });

  it('makes nothing leaner for a slowdown the match came back from', () => {
    // A step down kept in a fight, the top again soon after.
    expect(afterMatch(at(0, 1, { belowMs: 60_000 }))).toEqual(mem(0));
    expect(afterMatch(at(0, 1, { lean: 1, belowMs: 60_000 }))).toEqual(mem(0));
    // Most of the match below the top, though it ended there: leaner.
    expect(afterMatch(at(0, 2, { belowMs: 200_000 }))).toEqual(mem(0, 1));
  });

  it('leaves a match too short to tell as it found it, but a step down kept', () => {
    expect(afterMatch(at(2, null, { lean: 2, judgedMs: TOLD_MS - 1 }))).toEqual(mem(2, 2));
    expect(afterMatch(at(0, null, { lean: 2, judgedMs: TOLD_MS - 1 }))).toEqual(mem(0, 2));
    expect(afterMatch(at(3, 3, { judgedMs: 30_000 }))).toEqual(mem(2, 1));
  });

  it("goes past a phone's lights only once its shadows were left out", () => {
    const phone = ladderRungs(1, PHONE_RATIO_FLOOR);
    const m = { rungs: phone, settled: 1, deepest: 1, judgedMs: 0, belowMs: 0 };
    expect(afterMatch({ ...m, lean: 0 })).toEqual({ top: 1, step: 0, lean: 1 });
    expect(afterMatch({ ...m, lean: 1 }).lean).toBe(2);
  });
});

describe('a match played, then the next', () => {
  it('a short fight on a capable machine leaves nothing', () => {
    // 60 frames a second but five seconds at 45, pixels or not.
    const next = play(laptop, { index: 0, lean: 0 }, 600, (_r, at) =>
      at > 40_000 && at < 45_500 ? 1000 / 45 : P,
    );
    expect(next).toEqual(mem(0));
  });

  it('three hitches on a capable machine leave nothing', () => {
    let hitchAt = 30_000;
    const next = play(laptop, { index: 0, lean: 0 }, 600, (_r, at) => {
      if (at < hitchAt || hitchAt >= 33_000) return P;
      hitchAt += 1000;
      return 200;
    });
    expect(next).toEqual(mem(0));
  });

  it('a page held short of room two rungs down climbs back, and is let go', () => {
    // 54 frames a second whatever the rung: the dead band.
    let n = 0;
    const next = play(laptop, matchStart(mem(2, 1), laptop), 1800, () =>
      ++n % 10 === 0 ? 2 * P : P,
    );
    expect(next).toEqual(mem(0));
  });

  it('a weak GPU keeps its step and its lean level', () => {
    // Fill bound: 45 ms a frame at the top, 48 frames a second two rungs
    // down; each frame's work starts once the last is done, its time on a
    // refresh.
    let free = 0;
    const next = play(laptop, { index: 0, lean: 0 }, 600, (r, at) => {
      free = Math.max(free, at) + 45 * (r.ratio / 1.25) ** 2;
      return Math.max(P, Math.floor(free / P) * P - at);
    });
    expect(next).toEqual(mem(1, 1));
  });
});

describe('the stored line', () => {
  it('reads back what was written', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    const memory = { hz: 60, modes: { classic: mem(2, 1) } };
    writeQualityMemory(memory);
    expect(store.has(QUALITY_KEY)).toBe(true);
    expect(readQualityMemory()).toEqual(memory);
  });

  it('is dropped when broken or out of range, never trusted', () => {
    const empty = { hz: null, modes: {} };
    expect(parseQualityMemory(null)).toEqual(empty);
    expect(parseQualityMemory('{')).toEqual(empty);
    expect(parseQualityMemory('7')).toEqual(empty);
    expect(
      parseQualityMemory(
        JSON.stringify({
          hz: 9000,
          modes: {
            classic: { top: 99, step: 0, lean: 0 },
            royale: { top: 1, step: 1, lean: 7 },
            other: { top: 1, step: 0, lean: 0 },
          },
        }),
      ),
    ).toEqual(empty);
    // A step that is no step, and a line in an earlier shape.
    for (const classic of [mem(-1), mem(1.5), { ratio: 1, shadows: true, lean: 0, quiet: 0 }]) {
      expect(parseQualityMemory(JSON.stringify({ hz: 60, modes: { classic } }))).toEqual({
        hz: 60,
        modes: {},
      });
    }
    expect(
      parseQualityMemory(JSON.stringify({ hz: 144, modes: { royale: mem(3, 2, 1) } })),
    ).toEqual({ hz: 144, modes: { royale: mem(3, 2, 1) } });
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
