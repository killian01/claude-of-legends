// How finely a match is drawn, stepped by the frame rate
// (src/game/quality_ladder.ts): a machine that draws three quarters of its
// screen's rate or more is never touched, whatever that rate is; a weak GPU
// steps down while the median of its last eight windows is under that line
// and the step gains, then stays; a page held back by something else than
// its pixels gets one trial, undone; the ladder steps back up after three
// calm minutes when the rung above holds the line, and once a step up kept
// is given up it stays put; stalls, hitches, hidden tabs and a match's first
// seconds do not count. Whole matches on realistic machines are in
// quality_scenarios.test.ts.

import { describe, expect, it } from 'vitest';
import {
  DESK_RATIO_FLOOR,
  LADDER_RULES,
  ladderRungs,
  PHONE_RATIO_FLOOR,
  refreshHz,
} from '../src/game/quality_ladder';
import {
  deepest,
  drive,
  fillBound,
  ladderFor,
  type Machine,
  SETTLE,
  scriptBound,
  swings,
} from './quality_machine';

const P = 1000 / 60;
// The line under which a window is short on a 60 Hz screen: 45.
const LINE = LADDER_RULES.shortShare * 60;

// The steps up in a run's changes.
const ups = (changes: { at: number; index: number }[]) =>
  changes.filter((c, i) => c.index < (i === 0 ? 0 : changes[i - 1]!.index));

describe('the rungs', () => {
  it('step the ratio down to the floor, then leave the shadows out', () => {
    expect(ladderRungs(1.25, DESK_RATIO_FLOOR)).toEqual([
      { ratio: 1.25, shadows: true },
      { ratio: 1, shadows: true },
      { ratio: 0.85, shadows: true },
      { ratio: 0.75, shadows: true },
      { ratio: 0.75, shadows: false },
    ]);
    expect(ladderRungs(2, DESK_RATIO_FLOOR).map((r) => r.ratio)).toEqual([
      2, 1.75, 1.5, 1.25, 1, 0.85, 0.75, 0.75,
    ]);
    expect(ladderRungs(1, DESK_RATIO_FLOOR).map((r) => r.ratio)).toEqual([1, 0.85, 0.75, 0.75]);
  });

  it('skip a step that would buy too little', () => {
    // 1.25 is not worth taking from 1.3.
    expect(ladderRungs(1.3, DESK_RATIO_FLOOR).map((r) => r.ratio)).toEqual([
      1.3, 1, 0.85, 0.75, 0.75,
    ]);
  });

  it("keep a phone's floor at 1", () => {
    expect(ladderRungs(1.5, PHONE_RATIO_FLOOR)).toEqual([
      { ratio: 1.5, shadows: true },
      { ratio: 1.25, shadows: true },
      { ratio: 1, shadows: true },
      { ratio: 1, shadows: false },
    ]);
    expect(ladderRungs(1, PHONE_RATIO_FLOOR)).toEqual([
      { ratio: 1, shadows: true },
      { ratio: 1, shadows: false },
    ]);
  });
});

describe("the screen's refresh", () => {
  it('is the common divisor of the intervals, however slow the frames', () => {
    const p = 1000 / 60;
    expect(refreshHz([p, p, p, p, p, p])).toBeCloseTo(60, 0);
    expect(refreshHz([2 * p, 3 * p, 2 * p, 2 * p, 3 * p, 2 * p])).toBeCloseTo(60, 0);
    // With the browser's jitter of a few tenths of a millisecond.
    expect(refreshHz([33.2, 50.1, 33.4, 16.6, 33.3, 49.9, 33.5])).toBeCloseTo(60, 0);
    const q = 1000 / 144;
    expect(refreshHz([7 * q, 8 * q, 7 * q, 7 * q, 8 * q, 7 * q])).toBeCloseTo(144, 0);
    expect(refreshHz([20, 20, 40, 20, 20, 20])).toBeCloseTo(50, 0);
    expect(refreshHz([500, 1000, 500, 500, 1000])).toBeCloseTo(2, 5);
  });

  it('is not made up from intervals that share no divisor', () => {
    expect(refreshHz([23.7, 31.1, 27.9, 35.3, 29.4, 26.2, 33.8, 24.5])).toBeNull();
    expect(refreshHz([16.7, 16.7])).toBeNull();
  });

  it('is read through a clock that rounds to the millisecond', () => {
    // 60 Hz handed over as 16 and 17, at 60 frames a second and at 45.
    expect(refreshHz([16, 17, 17, 16, 17, 17, 16, 17, 17, 16])).toBeCloseTo(60, 0);
    expect(refreshHz([16, 17, 33, 17, 17, 34, 16, 17, 33, 17, 16, 34])).toBeCloseTo(60, 0);
  });

  it('is the rate known from lighter frames when every frame takes two refreshes', () => {
    // A weak GPU at a steady 30 on a 60 Hz screen: its intervals alone
    // could be a 30 Hz screen's, the page's menus drew at 60.
    const l = ladderFor(1.25, 0, 60);
    const run = drive(l, fillBound(60, 33.4, 1.25), 120);
    expect(l.screenHz).toBeCloseTo(60, 0);
    expect(run.changes[0]).toEqual({ at: expect.any(Number), index: 1 });
    expect(run.lastFps).toBeGreaterThan(LINE);
  });

  it('is kept only when the frames came slower than it', () => {
    // A steady 30 with nothing known: a 30 Hz screen as far as anyone
    // can tell, and nothing worth remembering.
    const steady = ladderFor(1.25);
    expect(drive(steady, fillBound(60, 33.4, 1.25), 120).changes).toEqual([]);
    expect(steady.screenHz).toBeCloseTo(30, 0);
    expect(steady.refreshRead).toBeNull();
    // At 45 a second, one refresh and two: the refresh itself.
    const mixed = ladderFor(1.25);
    drive(mixed, fillBound(60, 22, 1.25), 60);
    expect(mixed.refreshRead).toBeCloseTo(60, 0);
  });
});

describe('a machine that holds its screen', () => {
  it('is never stepped down at 60', () => {
    const l = ladderFor(1.25);
    const run = drive(l, fillBound(60, 12, 1.25), 600);
    expect(run.changes).toEqual([]);
    expect(l.screenHz).toBeCloseTo(60, 0);
  });

  it('is never stepped down at 58 on a 60 Hz screen', () => {
    const l = ladderFor(1.25);
    // Every thirtieth frame misses its refresh.
    let n = 0;
    const m: Machine = { refreshMs: P, workMs: () => (++n % 30 === 0 ? 30 : 12) };
    expect(drive(l, m, 600).changes).toEqual([]);
  });

  it('is never stepped down at 46 on a 60 Hz screen, its pixels or not', () => {
    // Three quarters of the screen's rate is playable: no step is tried.
    for (const m of [fillBound(60, 1000 / 46, 1.25), scriptBound(60, 1000 / 46)]) {
      const l = ladderFor(1.25, 0, 60);
      expect(drive(l, m, 600).changes).toEqual([]);
    }
  });

  it('is never stepped down on a 144 Hz screen drawing 70', () => {
    const l = ladderFor(2);
    expect(drive(l, fillBound(144, 1000 / 70, 2), 600).changes).toEqual([]);
  });

  it('is never stepped down on a 50 Hz panel drawing its 50', () => {
    // A screen slower than 60 is not taken for a slow machine, even with
    // 60 remembered from another screen.
    const l = ladderFor(1.25, 0, 60);
    expect(drive(l, fillBound(50, 15, 1.25), 600).changes).toEqual([]);
    expect(l.screenHz).toBeCloseTo(50, 0);
  });

  it('is never stepped down under a steady 30 frames a second it was asked for', () => {
    // A virtual clock (scripts/tour_match.mjs) or a 30 Hz screen, its
    // menus drawn at 30 too, or nothing known.
    for (const known of [30, null]) {
      const l = ladderFor(1.25, 0, known);
      expect(drive(l, fillBound(30, 20, 1.25), 600).changes).toEqual([]);
    }
  });
});

describe('a weak GPU', () => {
  it('steps down until it holds the line, and stays there', () => {
    // 22 frames a second at the top, as the seat reports said: 35 a rung
    // down, 48 two rungs down.
    const l = ladderFor(1.25);
    const run = drive(l, fillBound(60, 45, 1.25), 600);
    expect(l.screenHz).toBeCloseTo(60, 0);
    // Down a rung once eight windows are in, the next as soon as the
    // first is kept.
    expect(run.changes.slice(0, 2)).toEqual([
      { at: expect.any(Number), index: 1 },
      { at: expect.any(Number), index: 2 },
    ]);
    expect(run.changes[1]!.at).toBeLessThan(SETTLE + 20_000);
    expect(l.index).toBe(2);
    expect(deepest(run)).toBe(2);
    expect(run.lastFps).toBeGreaterThan(LINE);
    // Then only a look one rung up now and then, undone within seconds,
    // never sooner than three minutes after the last step down, rarer
    // each time.
    const looks = run.changes.slice(2);
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.length).toBeLessThanOrEqual(4);
    for (let i = 0; i < looks.length; i += 2) {
      expect(looks[i]!.index).toBe(1);
      expect(looks[i + 1]!.index).toBe(2);
      expect(looks[i + 1]!.at - looks[i]!.at).toBeLessThan(12_000);
    }
    expect(looks[0]!.at - run.changes[1]!.at).toBeGreaterThanOrEqual(180_000);
  });

  it('at 30 frames a second steps one rung, and stays there', () => {
    const l = ladderFor(1.25, 0, 60);
    const run = drive(l, fillBound(60, 1000 / 30, 1.25), 600);
    expect(run.changes[0]).toEqual({ at: expect.any(Number), index: 1 });
    expect(run.settled).toEqual([0, 1]);
    expect(run.lastFps).toBeGreaterThan(LINE);
  });

  it('steps past a rung that brings no frame under a refresh', () => {
    // Two refreshes a frame at 1.25 and at 1, one at 0.85: a screen that
    // waits for its refresh shows no gain a rung down, two rungs down it
    // holds 60.
    const l = ladderFor(1.25, 0, 60);
    const m: Machine = { refreshMs: P, workMs: (r) => (r.ratio >= 1 ? 33.4 : 12) };
    const run = drive(l, m, 300);
    // Through 1 on the way, kept at 2; a look back up now and then.
    expect(run.changes.slice(0, 2).map((c) => c.index)).toEqual([1, 2]);
    expect(run.changes.slice(2).every((c, i) => c.index === (i % 2 === 0 ? 1 : 2))).toBe(true);
    expect(run.settled).toEqual([0, 2]);
    expect(run.lastFps).toBeGreaterThan(LINE);
  });

  it('goes one rung past a rung that gains nothing, never two', () => {
    // Two refreshes a frame down to the floor: a rung tried, one further,
    // and both undone.
    const l = ladderFor(1.25, 0, 60);
    const m: Machine = { refreshMs: P, workMs: (r) => (r.shadows ? 33.4 : 12) };
    const run = drive(l, m, 120);
    expect(run.changes.map((c) => c.index)).toEqual([1, 2, 0]);
    expect(run.settled).toEqual([0]);
  });

  it('goes as far as the shadows when the pixels are not enough', () => {
    const l = ladderFor(1.25);
    const run = drive(l, fillBound(60, 75, 1.25), 300);
    expect(l.rung).toEqual({ ratio: 0.75, shadows: false });
    expect(run.changes.length).toBe(4);
  });

  it('starts where an earlier match left it', () => {
    const l = ladderFor(1.25, 2, 60);
    expect(l.rung).toEqual({ ratio: 0.85, shadows: true });
    // Holding the line there, short of it one rung up: no step down, and
    // a single look up in five minutes.
    const run = drive(l, fillBound(60, 40, 1.25), 300);
    expect(l.index).toBe(2);
    expect(run.changes.length).toBe(2);
    expect(run.changes.every((c) => c.index <= 2)).toBe(true);
  });

  it('steps back up after three calm minutes, one rung at a time', () => {
    // 22 frames a second at the top for a minute and a half, then light.
    const l = ladderFor(1.25);
    let heavy = true;
    const m: Machine = {
      refreshMs: P,
      workMs: (r) => (heavy ? 45 : 8) * (r.ratio / 1.25) ** 2,
    };
    let run = drive(l, m, 90);
    expect(l.index).toBe(2);
    const down = run.changes[1]!.at;
    heavy = false;
    run = drive(l, m, 400, run.at);
    expect(run.changes.map((c) => c.index)).toEqual([1, 0]);
    // Three minutes on each rung before the look up, and its trial.
    expect(run.changes[0]!.at - down).toBeGreaterThan(180_000);
    expect(run.changes[1]!.at - run.changes[0]!.at).toBeGreaterThan(180_000);
  });

  it('holds a rung when stepping up brings the slow frames back, longer each time', () => {
    // Fill bound at the top (about 40), room to spare one rung down: a
    // step up is tried now and then and undone, ever more rarely.
    const l = ladderFor(1.25);
    const run = drive(l, fillBound(60, 25, 1.25), 1800);
    expect(l.index).toBe(1);
    const looks = ups(run.changes);
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.length).toBeLessThanOrEqual(3);
    const gaps = looks.slice(1).map((u, i) => u.at - looks[i]!.at);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
  });
});

describe('a step up', () => {
  it('is undone when the frames on the rung above are short of the line', () => {
    // Room to spare one rung down; at the top the rate swings about 44, a
    // window at 40 and the next at 48.
    const l = ladderFor(1.25, 1, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) =>
        r.ratio < 1.25 ? 12 : 1000 / (44 + 4 * Math.sign(Math.sin((at / 1000) * Math.PI))),
    };
    const run = drive(l, m, 600);
    expect(l.index).toBe(1);
    expect(run.changes.length).toBeGreaterThan(0);
    for (let i = 0; i < run.changes.length; i += 2) {
      expect(run.changes[i]!.index).toBe(0);
      expect(run.changes[i + 1]?.index).toBe(1);
    }
  });

  it('is kept when the frames on the rung above hold the line', () => {
    // At the top the rate swings about 49, never under 45.
    const l = ladderFor(1.25, 1, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) =>
        r.ratio < 1.25 ? 12 : 1000 / (49.5 + 4 * Math.sign(Math.sin((at / 1000) * Math.PI))),
    };
    expect(drive(l, m, 600).changes.map((c) => c.index)).toEqual([0]);
  });

  it('comes to a page that holds its rung short of room, for minutes on end', () => {
    // 54 frames a second whatever the rung. Started two rungs down by an
    // earlier match, it climbs back to the top within the match and stays.
    const l = ladderFor(1.25, 2, 60);
    const run = drive(l, scriptBound(60, 1000 / 54), 1800);
    expect(l.index).toBe(0);
    expect(run.changes.map((c) => c.index)).toEqual([1, 0]);
  });

  it('is not tried again in the match once one kept is given up', () => {
    // At the top, fifteen heavy seconds every hundred, the rung below fine
    // through them: a step up kept in the calm is given up at the next
    // spell, and the ladder stays a rung down from then on.
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => (r.ratio < 1.25 || at % 100_000 < 85_000 ? 10 : 30),
    };
    const run = drive(ladderFor(1.25, 0, 60), m, 1800);
    expect(swings(run)).toBe(1);
    expect(run.settled).toEqual([0, 1, 0, 1]);
    expect(run.changes.at(-1)!.index).toBe(1);
  });
});

describe('a page held back by something else', () => {
  it('gets a trial that is undone, then is left alone a while', () => {
    const l = ladderFor(1.25);
    const run = drive(l, scriptBound(60, 36), 600);
    expect(l.index).toBe(0);
    expect(run.settled).toEqual([0]);
    // One rung each time: its frames came one and two refreshes apart.
    expect(run.changes.every((c) => c.index <= 1)).toBe(true);
    const trials = run.changes.filter((c) => c.index === 1);
    expect(trials.length).toBeGreaterThan(0);
    // Three minutes, then six: no more than three trials in ten minutes.
    expect(trials.length).toBeLessThanOrEqual(3);
  });

  it('gets no trial at all when its own script fills the frame', () => {
    const l = ladderFor(1.25);
    expect(drive(l, { ...scriptBound(60, 36), scriptShare: 0.9 }, 600).changes).toEqual([]);
  });
});

describe('what does not count', () => {
  it('a stall, or a hidden tab, is not a slow frame rate', () => {
    const l = ladderFor(1.25);
    let at = 0;
    for (let i = 0; i < 120; i++) {
      // A second-long stall, then a second of smooth frames.
      at += 1000;
      l.frame(at);
      for (let k = 0; k < 60; k++) {
        at += P;
        l.frame(at);
      }
    }
    expect(l.index).toBe(0);
  });

  it('an isolated hitch does not make its window short', () => {
    // A machine at 60 whose next three seconds each take one frame of
    // 200 ms (a program linking, a collection): under a stall's length,
    // but one frame in a window, not its rate.
    const l = ladderFor(1.25, 0, 60);
    let at = 0;
    let hitchAt = 30_000;
    const changes: number[] = [];
    while (at < 120_000) {
      const hitch = at >= hitchAt && hitchAt < 33_000;
      if (hitch) hitchAt += 1000;
      at += hitch ? 200 : P;
      l.frame(at);
      if (changes.at(-1) !== l.index) changes.push(l.index);
    }
    expect(changes).toEqual([0]);
  });

  it('frames that miss their refresh often are the rate, not hitches', () => {
    // 26 ms a frame: most intervals one refresh, the rest two, and the
    // rate is 38, short.
    const l = ladderFor(1.25, 0, 60);
    expect(drive(l, fillBound(60, 26, 1.25), 30).changes[0]).toEqual({
      at: expect.any(Number),
      index: 1,
    });
  });

  it('a sudden steady drop is the frame rate, not a run of stalls', () => {
    // 60 frames a second, then three a second for good: the slow frames
    // are judged once they have lasted three seconds, and the ladder steps.
    const l = ladderFor(1.25, 0, 60);
    let slow = false;
    const m: Machine = {
      refreshMs: P,
      workMs: (r) => (slow ? 330 * (r.ratio / 1.25) ** 2 : 10),
    };
    let run = drive(l, m, 20);
    const judged = l.judgedMs;
    slow = true;
    run = drive(l, m, 120, run.at);
    expect(l.judgedMs).toBeGreaterThan(judged + 60_000);
    expect(run.changes[0]).toEqual({ at: expect.any(Number), index: 1 });
    expect(l.index).toBeGreaterThan(0);
  });

  it('a run of stalls under three seconds is not the frame rate', () => {
    // A machine at 60 whose frames come three at a time 300 ms apart,
    // once a second for six seconds: programs linking for a fight's
    // spells. A hitch past one frame a window, but not the rate.
    const l = ladderFor(1.25, 0, 60);
    let burst = 0;
    let next = 40_000;
    const m: Machine = {
      refreshMs: P,
      workMs: (_r, at) => {
        if (at >= next && at < 46_000) {
          burst = 3;
          next += 1000;
        }
        if (burst === 0) return 9;
        burst--;
        return 300;
      },
    };
    expect(drive(l, m, 300).changes).toEqual([]);
  });

  it('a pause forgets the usual interval', () => {
    // Slow frames after a pause are the frame rate from their first.
    const l = ladderFor(1.25, 0, 60);
    let run = drive(l, fillBound(60, 10, 1.25), 20);
    l.pause(run.at);
    const judged = l.judgedMs;
    run = drive(l, scriptBound(60, 330), 30, run.at);
    expect(l.judgedMs - judged).toBeGreaterThan(25_000);
  });

  it("a match's first seconds are not judged", () => {
    // Slow while the match loads and links, smooth after.
    const l = ladderFor(1.25);
    const m: Machine = { refreshMs: P, workMs: (_r, at) => (at < SETTLE ? 80 : 10) };
    expect(drive(l, m, 120).changes).toEqual([]);
  });

  it('a pause drops the window and judges nothing until it ends', () => {
    const l = ladderFor(1.25);
    let run = drive(l, fillBound(60, 10, 1.25), 20);
    l.pause(run.at + 10_000);
    // The drop's globe, slow, then the ground again.
    run = drive(l, fillBound(60, 45, 1.25), 9, run.at);
    expect(l.index).toBe(0);
    run = drive(l, fillBound(60, 10, 1.25), 60, run.at);
    expect(run.changes).toEqual([]);
  });

  it('a frame not drawn breaks the interval', () => {
    // Every other refresh is skipped by the renderer itself (a hold): no
    // interval is left whole, so nothing is judged or read. Joined, they
    // would be frames at 30 on a screen known to refresh at 60.
    for (const known of [null, 60]) {
      const l = ladderFor(1.25, 0, known);
      let at = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 2000; i++) {
        at += P;
        if (i % 2 === 0) l.gap();
        else seen.add(l.frame(at));
      }
      expect([...seen]).toEqual([0]);
      expect(l.judgedMs).toBe(0);
      expect(l.screenHz).toBe(known);
    }
  });
});
