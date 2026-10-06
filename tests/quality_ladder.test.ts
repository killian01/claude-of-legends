// How finely a match is drawn, stepped by the frame rate
// (src/game/quality_ladder.ts): a machine that holds its screen's rate is
// never touched, whatever that rate is; a weak GPU steps down until it
// holds it and stays there; a page held back by something else than its
// pixels gets one trial, undone; the ladder steps back up slowly and never
// swings; stalls, hidden tabs and a match's first seconds do not count.

import { describe, expect, it } from 'vitest';
import {
  DESK_RATIO_FLOOR,
  LADDER_RULES,
  ladderRungs,
  PHONE_RATIO_FLOOR,
  QualityLadder,
  type Rung,
  refreshHz,
} from '../src/game/quality_ladder';

// A machine: its screen's refresh, and the work a frame takes on a rung.
// The browser begins a frame on a refresh and hands its time over; a
// frame's work starts once the one before is done, so the rate follows
// the work while the times stay on the refreshes (what Chrome does with a
// frame slower than one refresh: intervals of one and two refreshes).
interface Machine {
  refreshMs: number;
  workMs: (rung: Rung, at: number) => number;
}

interface Run {
  at: number;
  // Every rung change, with when it happened.
  changes: { at: number; index: number }[];
  // Frames a second over the run's last ten seconds.
  lastFps: number;
}

function drive(
  ladder: QualityLadder,
  m: Machine,
  seconds: number,
  from = 0,
  scriptShare?: number,
): Run {
  let at = from;
  let free = from;
  const end = from + seconds * 1000;
  const changes: Run['changes'] = [];
  const stamps: number[] = [];
  while (at < end) {
    const work = m.workMs(ladder.rung, at);
    free = Math.max(free, at) + work;
    at = Math.max(at + m.refreshMs, Math.floor(free / m.refreshMs) * m.refreshMs);
    const before = ladder.index;
    ladder.frame(at, scriptShare === undefined ? undefined : scriptShare * work);
    if (ladder.index !== before) changes.push({ at, index: ladder.index });
    stamps.push(at);
  }
  const tail = stamps.filter((s) => s > end - 10_000);
  const lastFps = tail.length > 1 ? ((tail.length - 1) * 1000) / (tail.at(-1)! - tail[0]!) : 0;
  return { at, changes, lastFps };
}

// A GPU held back by its pixels: the work goes with the pixels drawn, and
// shadows left out take 15 percent off.
function fillBound(refreshHz: number, msAtTop: number, top: number): Machine {
  return {
    refreshMs: 1000 / refreshHz,
    workMs: (r) => msAtTop * (r.ratio / top) ** 2 * (r.shadows ? 1 : 0.85),
  };
}

// A page held back by its script: the same work on every rung.
const scriptBound = (refreshHz: number, ms: number): Machine => ({
  refreshMs: 1000 / refreshHz,
  workMs: () => ms,
});

const SETTLE = 10_000;
const ladderFor = (top: number, index = 0, screenHz: number | null = null) =>
  new QualityLadder(ladderRungs(top, DESK_RATIO_FLOOR), {
    index,
    screenHz,
    settleUntil: SETTLE,
  });

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
    const m: Machine = { refreshMs: 1000 / 60, workMs: () => (++n % 30 === 0 ? 30 : 12) };
    expect(drive(l, m, 600).changes).toEqual([]);
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
    // A virtual clock (scripts/tour_match.mjs) or a 30 Hz screen.
    const l = ladderFor(1.25);
    expect(drive(l, fillBound(30, 20, 1.25), 600).changes).toEqual([]);
  });
});

describe('a weak GPU', () => {
  it('steps down until it holds the screen, and stays there', () => {
    // 22 frames a second at the top, as the seat reports said.
    const l = ladderFor(1.25);
    const run = drive(l, fillBound(60, 45, 1.25), 600);
    expect(l.screenHz).toBeCloseTo(60, 0);
    // Down a rung every few seconds once the first ten are past.
    expect(run.changes.slice(0, 3)).toEqual([
      { at: expect.any(Number), index: 1 },
      { at: expect.any(Number), index: 2 },
      { at: expect.any(Number), index: 3 },
    ]);
    expect(run.changes[2]!.at).toBeLessThan(30_000);
    expect(l.index).toBe(3);
    expect(l.deepest).toBe(3);
    expect(run.lastFps).toBeGreaterThan(LADDER_RULES.shortShare * 60);
    // Then only a look one rung up now and then, undone within seconds,
    // never sooner than a minute after the last step down, rarer each time.
    const looks = run.changes.slice(3);
    expect(looks.length).toBeLessThanOrEqual(4);
    for (let i = 0; i < looks.length; i += 2) {
      expect(looks[i]!.index).toBe(2);
      expect(looks[i + 1]!.index).toBe(3);
      expect(looks[i + 1]!.at - looks[i]!.at).toBeLessThan(5_000);
    }
    expect(looks[0]!.at - run.changes[2]!.at).toBeGreaterThanOrEqual(LADDER_RULES.upAfterDownMs);
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
    // Holding the screen there, short one rung up: no step down, and a
    // single look up in five minutes.
    const run = drive(l, fillBound(60, 34, 1.25), 300);
    expect(l.index).toBe(2);
    expect(run.changes.length).toBeLessThanOrEqual(2);
    expect(run.changes.every((c) => c.index <= 2)).toBe(true);
  });

  it('steps back up once the fight is over, one rung at a time', () => {
    const l = ladderFor(1.25);
    let heavy = true;
    const m: Machine = {
      refreshMs: 1000 / 60,
      workMs: (r) => (heavy ? 30 : 8) * (r.ratio / 1.25) ** 2,
    };
    let run = drive(l, m, 90);
    const down = l.index;
    expect(down).toBeGreaterThan(0);
    heavy = false;
    run = drive(l, m, 25, run.at);
    expect(l.index).toBe(down - 1);
    drive(l, m, 120, run.at);
    expect(l.index).toBe(0);
  });

  it('holds a rung when stepping up brings the slow frames back, longer each time', () => {
    // Fill bound at the top (about 40), room to spare one rung down: a
    // step up is tried now and then and undone, ever more rarely.
    const l = ladderFor(1.25);
    const run = drive(l, fillBound(60, 25, 1.25), 1800);
    expect(l.index).toBe(1);
    const ups = run.changes.filter((c, i) => c.index < (i === 0 ? 0 : run.changes[i - 1]!.index));
    expect(ups.length).toBeGreaterThan(0);
    expect(ups.length).toBeLessThanOrEqual(3);
    const gaps = ups.slice(1).map((u, i) => u.at - ups[i]!.at);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
  });
});

describe('a step up', () => {
  it('is undone when it leaves the frames hovering just short', () => {
    // Room to spare one rung down; at the top the rate swings about the
    // line, a window over it and the next under.
    const l = ladderFor(1.25, 1, 60);
    const m: Machine = {
      refreshMs: 1000 / 60,
      workMs: (r, at) =>
        r.ratio < 1.25 ? 12 : 1000 / (49.5 + 4 * Math.sign(Math.sin((at / 1000) * Math.PI))),
    };
    const run = drive(l, m, 600);
    expect(l.index).toBe(1);
    expect(run.changes.length).toBeGreaterThan(0);
    for (let i = 0; i < run.changes.length; i += 2) {
      expect(run.changes[i]!.index).toBe(0);
      expect(run.changes[i + 1]?.index).toBe(1);
    }
  });
});

describe('a page held back by something else', () => {
  it('gets a trial that is undone, then is left alone a while', () => {
    const l = ladderFor(1.25);
    const run = drive(l, scriptBound(60, 36), 600);
    expect(l.index).toBe(0);
    const trials = run.changes.filter((c) => c.index === 1);
    expect(trials.length).toBeGreaterThan(0);
    // Three minutes, then six: no more than three trials in ten minutes.
    expect(trials.length).toBeLessThanOrEqual(3);
  });

  it('gets no trial at all when its own script fills the frame', () => {
    const l = ladderFor(1.25);
    expect(drive(l, scriptBound(60, 36), 600, 0, 0.9).changes).toEqual([]);
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
        at += 1000 / 60;
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
    const p = 1000 / 60;
    let at = 0;
    let hitchAt = 30_000;
    const changes: number[] = [];
    while (at < 120_000) {
      const hitch = at >= hitchAt && hitchAt < 33_000;
      if (hitch) hitchAt += 1000;
      at += hitch ? 200 : p;
      l.frame(at);
      if (changes.at(-1) !== l.index) changes.push(l.index);
    }
    expect(changes).toEqual([0]);
  });

  it('frames that miss their refresh often are the rate, not hitches', () => {
    // 22 ms a frame: one interval in three two refreshes long, so most of
    // them are one refresh, and the rate is 45, short.
    const l = ladderFor(1.25, 0, 60);
    expect(drive(l, fillBound(60, 22, 1.25), 30).changes[0]).toEqual({
      at: expect.any(Number),
      index: 1,
    });
  });

  it('a sudden steady drop is the frame rate, not a run of stalls', () => {
    // 60 frames a second, then three a second for good: the slow frames
    // are judged once a few have come in a row, and the ladder steps.
    const l = ladderFor(1.25, 0, 60);
    let slow = false;
    const m: Machine = {
      refreshMs: 1000 / 60,
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
    const m: Machine = { refreshMs: 1000 / 60, workMs: (_r, at) => (at < SETTLE ? 80 : 10) };
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
    const l = ladderFor(1.25);
    let at = 0;
    for (let i = 0; i < 2000; i++) {
      at += 1000 / 60;
      // Every other refresh is skipped by the renderer itself (a hold):
      // no interval is left whole, so nothing is judged or read.
      if (i % 2 === 0) l.gap();
      else l.frame(at);
    }
    expect(l.index).toBe(0);
    expect(l.judgedMs).toBe(0);
    expect(l.screenHz).toBeNull();
  });
});
