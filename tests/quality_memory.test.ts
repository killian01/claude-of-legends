// What a browser remembers between matches of how finely it draws
// (src/game/quality_memory.ts): only the lean level for each kind of match,
// the matches played at it, and the screen's refresh. A match judged a
// hundred seconds whose top drew under 0.6 of the target by the median of
// twenty seconds of windows or more makes the next one leaner by a level,
// the lights first and then the antialiasing; five matches at a level give
// one back; nothing else moves it, and a broken line is dropped.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterMatch,
  LEAN_LEVELS,
  LEANEST,
  type ModeMemory,
  parseQualityMemory,
  QUALITY_KEY,
  readQualityMemory,
  writeQualityMemory,
} from '../src/game/quality_memory';
import { exact, ladderFor } from './quality_machine';

afterEach(() => {
  vi.unstubAllGlobals();
});

const mem = (lean: number, played = 0): ModeMemory => ({ lean, played });
// A match judged `judgedMs`, its top `topMs` at `topShare` of the target.
const leaves = (start: ModeMemory, judgedMs: number, topMs: number, topShare: number | null) =>
  afterMatch({ start, judgedMs, topMs, topShare });
const SLOW = 0.5;
const FAST = 0.95;
// What a match on `l` tells.
const pick = (l: ReturnType<typeof ladderFor>) => ({
  judgedMs: l.judgedMs,
  topMs: l.topMs,
  topShare: l.topShare,
});

describe('the lean levels', () => {
  it('leave out the lights first, then the antialiasing as well', () => {
    expect(LEAN_LEVELS).toEqual([
      { antialias: true, effectLights: true },
      { antialias: true, effectLights: false },
      { antialias: false, effectLights: false },
    ]);
    expect(LEANEST).toBe(2);
  });
});

describe('what a match leaves for the next', () => {
  it('is a level leaner when its top drew under 0.6 of the target', () => {
    expect(leaves(mem(0), 100_000, 20_000, 0.599)).toEqual(mem(1));
    expect(leaves(mem(1, 3), 600_000, 30_000, SLOW)).toEqual(mem(2));
    expect(leaves(mem(0), 100_000, 20_000, 0.6)).toEqual(mem(0));
  });

  it('needs a match judged a hundred seconds, its top twenty', () => {
    // Judged too short to tell: as it found it, not even a match played.
    expect(leaves(mem(0), 99_999, 50_000, SLOW)).toEqual(mem(0));
    expect(leaves(mem(1, 3), 99_999, 50_000, FAST)).toEqual(mem(1, 3));
    expect(leaves(mem(1, 3), 100_000, 50_000, FAST)).toEqual(mem(1, 4));
    // A top judged under twenty seconds tells nothing of the lean, but the
    // match was played.
    expect(leaves(mem(0), 600_000, 19_999, SLOW)).toEqual(mem(0));
    expect(leaves(mem(1, 1), 600_000, 19_999, SLOW)).toEqual(mem(1, 2));
    expect(leaves(mem(1, 1), 600_000, 30_000, null)).toEqual(mem(1, 2));
  });

  it('gives a level back after five matches at it, a retry', () => {
    let memory = mem(LEANEST);
    const seen: number[] = [];
    for (let i = 0; i < 11; i++) {
      memory = leaves(memory, 300_000, 40_000, FAST);
      seen.push(memory.lean);
    }
    expect(seen).toEqual([2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0]);
    // A machine that still needs the level leans again after that match.
    expect(leaves(mem(1), 300_000, 30_000, SLOW)).toEqual(mem(2));
  });

  it('counts the matches at the leanest level too, and none without a lean', () => {
    // Slow still at the leanest: nothing leaner, the retry comes all the same.
    expect(leaves(mem(LEANEST, 3), 300_000, 30_000, SLOW)).toEqual(mem(LEANEST, 4));
    expect(leaves(mem(LEANEST, 4), 300_000, 30_000, SLOW)).toEqual(mem(1));
    expect(leaves(mem(0), 300_000, 30_000, FAST)).toEqual(mem(0));
  });

  it('is the lean a weak GPU needs, from a match on the ladder', () => {
    // 25 frames a second at the top, 50 a rung down: the top's first
    // twenty seconds are its rate, whatever the ladder did after.
    const weak = ladderFor();
    exact(weak, (i) => (i === 0 ? 25 : 50), 130);
    expect(afterMatch({ start: mem(0), ...pick(weak) })).toEqual(mem(1));
    const fast = ladderFor();
    exact(fast, () => 58, 130);
    expect(afterMatch({ start: mem(0), ...pick(fast) })).toEqual(mem(0));
  });
});

describe('the stored line', () => {
  it('reads back what was written', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    const memory = { hz: 60, modes: { classic: mem(2, 3), royale: mem(0) } };
    writeQualityMemory(memory);
    expect(store.has(QUALITY_KEY)).toBe(true);
    expect(readQualityMemory()).toEqual(memory);
  });

  it('is dropped when broken or out of range, never trusted', () => {
    const empty = { hz: null, modes: {} };
    expect(parseQualityMemory(null)).toEqual(empty);
    expect(parseQualityMemory('{')).toEqual(empty);
    expect(parseQualityMemory('7')).toEqual(empty);
    for (const classic of [
      mem(-1),
      mem(LEANEST + 1),
      mem(1.5),
      mem(1, 5),
      mem(1, -1),
      { lean: 1 },
      'lean',
    ]) {
      expect(parseQualityMemory(JSON.stringify({ hz: 60, modes: { classic } }))).toEqual({
        hz: 60,
        modes: {},
      });
    }
    expect(parseQualityMemory(JSON.stringify({ hz: 9000, modes: { other: mem(1) } }))).toEqual(
      empty,
    );
    expect(parseQualityMemory(JSON.stringify({ hz: 144, modes: { royale: mem(2, 4) } }))).toEqual({
      hz: 144,
      modes: { royale: mem(2, 4) },
    });
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
