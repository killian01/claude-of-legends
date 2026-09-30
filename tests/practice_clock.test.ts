// The practice match's clock (src/game/practice_clock.ts): it holds while
// the player cannot play (the turn wall, the pause menu, the opening
// shop), and picks up again without a burst of catch-up ticks.

import { describe, expect, it } from 'vitest';
import {
  advancePracticeClock,
  MAX_FRAME_MS,
  type MatchCover,
  type PracticeClock,
  practiceHeld,
} from '../src/game/practice_clock';

const TICK_MS = 50;
const OPEN: MatchCover = { turnWall: false, pauseMenu: false, openingShop: false };

// Runs frames at `step` ms apart from `from` to `to`, held or not, and
// counts the ticks stepped.
function run(
  clock: PracticeClock,
  from: number,
  to: number,
  step: number,
  held: boolean,
): { clock: PracticeClock; ticks: number } {
  let c = clock;
  let ticks = 0;
  for (let now = from; now <= to; now += step) {
    const r = advancePracticeClock(c, now, held, TICK_MS);
    c = r.clock;
    ticks += r.ticks;
  }
  return { clock: c, ticks };
}

describe('what holds a practice match', () => {
  it('runs with nothing over it', () => {
    expect(practiceHeld(OPEN)).toBe(false);
  });

  it('holds behind the turn wall, the pause menu and the opening shop', () => {
    expect(practiceHeld({ ...OPEN, turnWall: true })).toBe(true);
    expect(practiceHeld({ ...OPEN, pauseMenu: true })).toBe(true);
    expect(practiceHeld({ ...OPEN, openingShop: true })).toBe(true);
  });
});

describe('the practice clock', () => {
  it('steps one tick per 50 ms of frames', () => {
    const r = run({ last: 0, acc: 0 }, 16, 1000, 16, false);
    // 992 ms of frames after the first at 16 (which counts from 0).
    expect(r.ticks).toBe(Math.floor(1000 / TICK_MS) - 1);
  });

  it('steps nothing while held, however long', () => {
    const r = run({ last: 0, acc: 0 }, 16, 60_000, 16, true);
    expect(r.ticks).toBe(0);
  });

  it('picks up after a hold with no burst of catch-up ticks', () => {
    const before = run({ last: 0, acc: 0 }, 16, 496, 16, false);
    const held = run(before.clock, 512, 30_000, 16, true);
    // The first frames after the hold step at the normal pace: never
    // more than one tick for a 16 ms frame.
    let c = held.clock;
    for (let now = 30_016; now <= 30_400; now += 16) {
      const r = advancePracticeClock(c, now, false, TICK_MS);
      expect(r.ticks).toBeLessThanOrEqual(1);
      c = r.clock;
    }
  });

  it('never counts a frame for less than nothing, nor for more than the cap', () => {
    // The first frame predates the clock's start.
    expect(advancePracticeClock({ last: 100, acc: 0 }, 40, false, TICK_MS).ticks).toBe(0);
    // A tab back from the background.
    const r = advancePracticeClock({ last: 0, acc: 0 }, 60_000, false, TICK_MS);
    expect(r.ticks).toBe(Math.floor(MAX_FRAME_MS / TICK_MS));
  });

  it('keeps the owed fraction of a tick across a hold', () => {
    const r = advancePracticeClock({ last: 0, acc: 0 }, 30, false, TICK_MS);
    expect(r.clock.acc).toBe(30);
    const held = advancePracticeClock(r.clock, 5000, true, TICK_MS);
    expect(held.clock).toEqual({ last: 5000, acc: 30 });
    expect(advancePracticeClock(held.clock, 5020, false, TICK_MS).ticks).toBe(1);
  });
});
