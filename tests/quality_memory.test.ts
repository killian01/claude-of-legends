// What a browser remembers of how finely its last match was drawn
// (src/game/quality_memory.ts): the next match of the same kind starts on
// the rung the last one stood on; a match that had to step down makes the
// next one leaner, the lights first and then the antialiasing; matches
// held at the top give a level back, slowly; a broken line is dropped.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_RATIO_FLOOR, ladderRungs, PHONE_RATIO_FLOOR } from '../src/game/quality_ladder';
import {
  afterMatch,
  LEAN_LEVELS,
  LEANEST,
  type ModeMemory,
  matchStart,
  parseQualityMemory,
  QUALITY_KEY,
  QUIET_MATCHES,
  QUIET_MS,
  readQualityMemory,
  writeQualityMemory,
} from '../src/game/quality_memory';

const laptop = ladderRungs(1.25, DESK_RATIO_FLOOR);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the start of a match', () => {
  it('is the top with everything, for a browser that remembers nothing', () => {
    expect(matchStart(undefined, laptop)).toEqual({ index: 0, lean: 0 });
    expect(LEAN_LEVELS[0]).toEqual({ antialias: true, effectLights: true });
  });

  it('is the rung the last match stood on', () => {
    const m = (ratio: number, shadows = true): ModeMemory => ({
      ratio,
      shadows,
      lean: 1,
      quiet: 0,
    });
    expect(matchStart(m(0.85), laptop)).toEqual({ index: 2, lean: 1 });
    expect(matchStart(m(0.75, false), laptop)).toEqual({ index: 4, lean: 1 });
    expect(matchStart(m(1.25), laptop)).toEqual({ index: 0, lean: 1 });
    // A screen with another ratio: the nearest rung at or under it.
    expect(matchStart(m(0.9), laptop).index).toBe(2);
    expect(matchStart(m(2), laptop).index).toBe(0);
    expect(matchStart(m(0.5), laptop).index).toBe(3);
  });
});

describe('what a match leaves for the next', () => {
  const at = (
    settled: number,
    deepest: number | null,
    lean = 0,
    judgedMs = 300_000,
    start = 0,
  ) => ({
    rungs: laptop,
    start,
    settled,
    deepest,
    judgedMs,
    lean,
  });

  it('remembers where it stood, untouched when it never stepped down', () => {
    expect(afterMatch(undefined, at(0, null))).toEqual({
      ratio: 1.25,
      shadows: true,
      lean: 0,
      quiet: 0,
    });
  });

  it('turns the lights off after a step down, and starts a rung higher for it', () => {
    expect(afterMatch(undefined, at(2, 2))).toEqual({
      ratio: 1,
      shadows: true,
      lean: 1,
      quiet: 0,
    });
  });

  it('turns the antialiasing off only once a lean match still reached its floor', () => {
    expect(afterMatch(undefined, at(2, 2, 1)).lean).toBe(1);
    expect(afterMatch(undefined, at(4, 4, 1))).toEqual({
      ratio: 0.75,
      shadows: true,
      lean: 2,
      quiet: 0,
    });
    expect(LEAN_LEVELS[LEANEST]).toEqual({ antialias: false, effectLights: false });
    // Nothing leaner than the leanest.
    expect(afterMatch(undefined, at(4, 4, LEANEST))).toEqual({
      ratio: 0.75,
      shadows: false,
      lean: LEANEST,
      quiet: 0,
    });
  });

  it('counts the same match once however often it is saved', () => {
    const start: ModeMemory = { ratio: 1.25, shadows: true, lean: 1, quiet: 1 };
    const once = afterMatch(start, at(0, null, 1));
    expect(afterMatch(start, at(0, null, 1))).toEqual(once);
    expect(once.quiet).toBe(2);
  });

  it('gives a level back after matches in a row held at the top', () => {
    let memory: ModeMemory | undefined = { ratio: 1.25, shadows: true, lean: 2, quiet: 0 };
    for (let i = 1; i < QUIET_MATCHES; i++) {
      memory = afterMatch(memory, at(0, null, memory.lean));
      expect(memory).toMatchObject({ lean: 2, quiet: i });
    }
    memory = afterMatch(memory, at(0, null, memory.lean));
    expect(memory).toMatchObject({ lean: 1, quiet: 0 });
    // A short match tells nothing either way; a step down starts over.
    expect(afterMatch({ ...memory, quiet: 1 }, at(0, null, 1, QUIET_MS - 1)).quiet).toBe(1);
    expect(afterMatch({ ...memory, quiet: 1 }, at(1, 1, 1)).quiet).toBe(0);
    // Nor does a match that started below the top and stepped up to it.
    expect(afterMatch({ ...memory, quiet: 1 }, at(0, null, 1, QUIET_MS, 1)).quiet).toBe(0);
  });

  it("goes past a phone's lights only once its shadows were left out", () => {
    const phone = ladderRungs(1, PHONE_RATIO_FLOOR);
    expect(
      afterMatch(undefined, {
        rungs: phone,
        start: 0,
        settled: 1,
        deepest: 1,
        judgedMs: 0,
        lean: 0,
      }),
    ).toMatchObject({ lean: 1, ratio: 1, shadows: true });
    expect(
      afterMatch(undefined, {
        rungs: phone,
        start: 0,
        settled: 1,
        deepest: 1,
        judgedMs: 0,
        lean: 1,
      }).lean,
    ).toBe(2);
  });
});

describe('the stored line', () => {
  it('reads back what was written', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    const memory = {
      hz: 60,
      modes: { classic: { ratio: 0.85, shadows: true, lean: 1, quiet: 0 } },
    };
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
            classic: { ratio: 99, shadows: true, lean: 0, quiet: 0 },
            royale: { ratio: 1, shadows: true, lean: 7, quiet: 0 },
            other: { ratio: 1, shadows: true, lean: 0, quiet: 0 },
          },
        }),
      ),
    ).toEqual(empty);
    expect(
      parseQualityMemory(
        JSON.stringify({
          hz: 144,
          modes: { royale: { ratio: 1, shadows: false, lean: 2, quiet: 1 } },
        }),
      ),
    ).toEqual({ hz: 144, modes: { royale: { ratio: 1, shadows: false, lean: 2, quiet: 1 } } });
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
