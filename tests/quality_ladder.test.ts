// How finely a match is drawn, stepped by the frame rate
// (src/game/quality_ladder.ts): a machine that draws three quarters of its
// screen's rate or more is never touched, whatever that rate is; a weak GPU
// steps down while the median of its last eight windows is under that line
// and the step gains over its before and over the rung it left, drawn
// again, then stays; a page held back by something else than its pixels
// gets one trial, undone; a step kept is on probation until the rung above
// has been drawn again; a match started below the top tries the top first;
// the ladder steps back up after three minutes when the rung above holds
// the line, and a step up given up within three minutes holds it for the
// match; stalls, hitches, hidden tabs and a match's first seconds do not
// count. Whole matches on realistic machines, and matches in a row through
// the dial, are in quality_scenarios.test.ts.

import { describe, expect, it } from 'vitest';
import {
  DESK_RATIO_FLOOR,
  LADDER_RULES,
  ladderRungs,
  PHONE_RATIO_FLOOR,
  type QualityLadder,
  refreshHz,
} from '../src/game/quality_ladder';
import {
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
    // Each step tried, the rung it left drawn again, kept; the next at once.
    expect(run.changes.slice(0, 6).map((c) => c.index)).toEqual([1, 0, 1, 2, 1, 2]);
    expect(run.changes[5]!.at).toBeLessThan(SETTLE + 45_000);
    expect(run.settled).toEqual([0, 1, 2]);
    expect(l.index).toBe(2);
    expect(run.lastFps).toBeGreaterThan(LINE);
    // On probation, the rung above drawn again twice, then only a look up
    // now and then, undone within seconds, five minutes later at the
    // soonest, rarer each time.
    const looks = run.changes.slice(6);
    expect(looks.map((c) => c.index)).toEqual([1, 2, 1, 2, 1, 2]);
    for (let i = 0; i < looks.length; i += 2) {
      expect(looks[i + 1]!.at - looks[i]!.at).toBeLessThan(12_000);
    }
    expect(looks[4]!.at - looks[3]!.at).toBeGreaterThanOrEqual(300_000);
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
    // Through 1 on the way, the top drawn again, kept at 2; the rung
    // above drawn again on probation.
    expect(run.changes.slice(0, 4).map((c) => c.index)).toEqual([1, 2, 0, 2]);
    expect(run.changes.slice(4).every((c, i) => c.index === (i % 2 === 0 ? 1 : 2))).toBe(true);
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
    expect(run.settled).toEqual([0, 1, 2, 3, 4]);
  });

  it('starts where an earlier match left it, the top tried first', () => {
    const l = ladderFor(1.25, 2, 60);
    expect(l.rung).toEqual({ ratio: 0.85, shadows: true });
    // Holding the line there, short of it at the top: the top drawn
    // right after the settling and given up, its time not judged; then a
    // single look up in five minutes.
    const run = drive(l, fillBound(60, 40, 1.25), 300);
    expect(run.changes.slice(0, 2)).toEqual([
      { at: expect.any(Number), index: 0 },
      { at: expect.any(Number), index: 2 },
    ]);
    expect(run.changes[0]!.at).toBeLessThan(SETTLE + 1500);
    expect(run.changes[1]!.at - run.changes[0]!.at).toBeLessThan(12_000);
    expect(l.index).toBe(2);
    expect(l.fellEarly).toBe(true);
    expect(l.spentMs[0]).toBe(0);
    expect(l.judgedMs).toBeLessThan(300_000 - SETTLE - 9000);
    expect(run.changes.slice(2).map((c) => c.index)).toEqual([1, 2]);
  });

  it('says the top fell early only for a step down in the first judged minutes', () => {
    // 22 frames a second at the top from the start, or from its fourth
    // minute: the same steps down, early or not.
    for (const [from, early] of [
      [0, true],
      [200_000, false],
    ] as const) {
      const l = ladderFor(1.25, 0, 60);
      const m: Machine = {
        refreshMs: P,
        workMs: (r, at) => (at < from ? 9 : 45) * (r.ratio / 1.25) ** 2,
      };
      const run = drive(l, m, 400);
      expect(run.settled, `from ${from}`).toEqual([0, 1, 2]);
      expect(l.fellEarly, `from ${from}`).toBe(early);
    }
  });

  it('steps back up a rung at a time, three minutes apart', () => {
    // 22 frames a second at the top for a minute and a half, then light.
    const l = ladderFor(1.25);
    let heavy = true;
    const m: Machine = {
      refreshMs: P,
      workMs: (r) => (heavy ? 45 : 8) * (r.ratio / 1.25) ** 2,
    };
    let run = drive(l, m, 90);
    expect(l.index).toBe(2);
    const last = run.changes.at(-1)!.at;
    heavy = false;
    run = drive(l, m, 700, run.at);
    expect(run.changes.map((c) => c.index)).toEqual([1, 0]);
    // The rung above held back five minutes after the looks on probation
    // gave nothing, then three minutes on each rung.
    expect(run.changes[0]!.at - last).toBeGreaterThan(300_000);
    expect(run.changes[1]!.at - run.changes[0]!.at).toBeGreaterThan(180_000);
  });

  it('holds a rung when stepping up brings the slow frames back, longer each time', () => {
    // Fill bound at the top (about 40), room to spare one rung down: the
    // top drawn again twice on probation, then a step up tried now and
    // then and undone, ever more rarely.
    const l = ladderFor(1.25);
    const run = drive(l, fillBound(60, 25, 1.25), 1800);
    expect(l.index).toBe(1);
    expect(run.settled).toEqual([0, 1]);
    const looks = ups(run.changes).slice(3);
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.length).toBeLessThanOrEqual(3);
    const gaps = looks.slice(1).map((u, i) => u.at - looks[i]!.at);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
  });
});

describe("a step down's trial", () => {
  // Frames at exactly `top` a second on the top rung and `below` on the
  // rest, from a settled 60: no refresh rounds them.
  function exact(top: number, below: number, from = 0): QualityLadder {
    const l = ladderFor(1.25, 0, 60);
    let at = from;
    while (at < from + 120_000) {
      at += 1000 / (l.index === 0 ? top : below);
      l.frame(at);
    }
    return l;
  }

  it('is kept for a gain of 1.16 and undone for 1.12', () => {
    expect(exact(30, 30 * 1.16).settled).toBe(1);
    expect(exact(30, 30 * 1.12).settled).toBe(0);
  });

  it('is not tried for windows four short and four long', () => {
    // A page whose seconds alternate 42 and 50 whatever the rung: half its
    // windows under the line is a change of pace, not a pace.
    const l = ladderFor(1.25, 0, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (_r, at) => 1000 / (Math.floor(at / 1000) % 2 === 0 ? 42 : 50),
    };
    expect(drive(l, m, 300).changes).toEqual([]);
  });

  it('is set against the median of the windows that called for it', () => {
    // 40 frames a second at the top for the first windows after the
    // settling, 30 after them, and 36 a rung down: 36 is no gain on the
    // 35 those windows read, however much on their slower half.
    const l = ladderFor(1.25, 0, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => (r.ratio < 1.25 ? 1000 / 36 : at < SETTLE + 3000 ? 25 : 33.4),
    };
    expect(drive(l, m, 150).settled).toEqual([0]);
  });

  it('leaves the first two windows after a change out', () => {
    // Two slow seconds after every change of rung (the buffer reallocated,
    // programs linking): a rung with room to spare once they are over.
    const l = ladderFor(1.25, 0, 60);
    let at = 0;
    let changed = Number.NEGATIVE_INFINITY;
    let index = 0;
    while (at < 120_000) {
      at += at - changed < 2000 ? 200 : 1000 / (index === 0 ? 30 : 48);
      l.frame(at);
      if (l.index !== index) {
        index = l.index;
        changed = at;
      }
    }
    expect(l.settled).toBe(1);
  });

  it('is not kept for a fight that ends during it', () => {
    // A capable machine at 60, a fight at 30 whatever the rung, ended
    // before the trial's windows or among them: the top drawn again holds.
    for (const seconds of [8, 10, 12, 14, 16, 20]) {
      for (const strict of [false, true]) {
        const m: Machine = {
          refreshMs: P,
          strict,
          workMs: (_r, at) => (at > 60_000 && at < 60_000 + seconds * 1000 ? 1000 / 30 : 9),
        };
        const l = ladderFor(1.25, 0, 60);
        const run = drive(l, m, 400);
        expect(run.settled, `${seconds} s`).toEqual([0]);
        expect(l.spentMs[0], `${seconds} s`).toBe(l.judgedMs);
      }
    }
  });

  it('is not kept when the rung it left reads otherwise after it', () => {
    // Assets streaming at 30 until the trial's windows, a fight at 38 from
    // just after them: the top short both times, but not the same short.
    const m: Machine = {
      refreshMs: P,
      workMs: (_r, at) => (at < 20_000 ? 1000 / 30 : at > 28_000 && at < 45_000 ? 1000 / 38 : 9),
    };
    const l = ladderFor(1.25, 0, 60);
    const run = drive(l, m, 120);
    // Tried, the top drawn again, undone: never kept.
    expect(run.changes.map((c) => c.index)).toEqual([1, 0]);
    expect(run.settled).toEqual([0]);
  });

  it('is not kept when the rung it left holds the line again', () => {
    // 42 frames a second at the top for the first windows, 46 from just
    // before it is drawn again; 60 a rung down.
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => (r.ratio < 1.25 ? 10 : 1000 / (at < 25_000 ? 42 : 46)),
    };
    const run = drive(ladderFor(1.25, 0, 60), m, 120);
    expect(run.changes.map((c) => c.index)).toEqual([1, 0]);
  });

  it('is not kept when it gains too little over the rung it left, drawn again', () => {
    // 30 at the top for the first windows, 33 from before it is drawn
    // again, 36 a rung down: 1.2 over the first, 1.09 over the second.
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => (r.ratio < 1.25 ? 1000 / 36 : at < 25_000 ? 33.4 : 1000 / 33),
    };
    const run = drive(ladderFor(1.25, 0, 60), m, 120);
    expect(run.changes.map((c) => c.index)).toEqual([1, 0]);
  });

  it('is not kept for a rung whose gain fails in two windows of eight', () => {
    // 30 at the top; a rung down 47, but every fourth second 28.
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) =>
        r.ratio === 1.25 ? 33.4 : 1000 / (Math.floor(at / 1000) % 4 === 3 ? 28 : 47),
    };
    const run = drive(ladderFor(1.25, 0, 60), m, 120);
    // Tried, a rung further (its slowest windows take two refreshes a
    // frame), and undone.
    expect(run.changes.map((c) => c.index)).toEqual([1, 2, 0]);
    expect(run.settled).toEqual([0]);
  });

  it('is not tried when the fresh windows after a crossing hold the line', () => {
    // A capable machine at 60 and six seconds at 40 whatever the rung, a
    // minute in: the windows after the crossing are back at 60.
    for (const strict of [false, true]) {
      const m: Machine = {
        refreshMs: P,
        strict,
        workMs: (_r, at) => (at > 60_000 && at < 66_000 ? 25 : 9),
      };
      expect(drive(ladderFor(1.25, 0, 60), m, 200).changes).toEqual([]);
    }
  });

  it('is given back on probation when the rung above holds again', () => {
    // Forty heavy seconds at the top that a rung down draws at 60: the
    // step is kept, the top drawn again while they last is still short,
    // drawn again once they are over it holds, and the step's time counts
    // on the top.
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => (r.ratio === 1.25 && at > 60_000 && at < 100_000 ? 30 : 10),
    };
    const l = ladderFor(1.25, 0, 60);
    const run = drive(l, m, 300);
    expect(run.changes.map((c) => c.index)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(run.settled).toEqual([0]);
    expect(l.spentMs[0]).toBe(l.judgedMs);
    expect(l.fellEarly).toBe(false);
  });
});

describe('a step up', () => {
  it('is undone when the frames on the rung above are short of the line', () => {
    // Room to spare one rung down; at the top the rate swings about 44, a
    // window at 40 and the next at 48. Started there by an earlier match:
    // the top tried first and given up, then looked at now and then.
    const l = ladderFor(1.25, 1, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) =>
        r.ratio < 1.25 ? 12 : 1000 / (44 + 4 * Math.sign(Math.sin((at / 1000) * Math.PI))),
    };
    const run = drive(l, m, 600);
    expect(l.index).toBe(1);
    expect(run.changes.length).toBeGreaterThan(2);
    for (let i = 0; i < run.changes.length; i += 2) {
      expect(run.changes[i]!.index).toBe(0);
      expect(run.changes[i + 1]?.index).toBe(1);
    }
  });

  it('is kept when the frames on the rung above hold the line', () => {
    // At the top the rate swings about 49, never under 45: the top tried
    // at the start holds.
    const l = ladderFor(1.25, 1, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) =>
        r.ratio < 1.25 ? 12 : 1000 / (49.5 + 4 * Math.sign(Math.sin((at / 1000) * Math.PI))),
    };
    expect(drive(l, m, 600).changes.map((c) => c.index)).toEqual([0]);
    expect(l.fellEarly).toBe(false);
  });

  it("is held at the start by the median of the top's windows", () => {
    // Started a rung down; the top alternates 43 and 49 a second, a rung
    // down draws 60: the top's median holds the line, half its windows
    // do not, and neither calls for a step down.
    const l = ladderFor(1.25, 1, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => (r.ratio < 1.25 ? 10 : 1000 / (Math.floor(at / 1000) % 2 ? 43 : 49)),
    };
    expect(drive(l, m, 300).changes.map((c) => c.index)).toEqual([0]);
  });

  it('comes to a page started below the top that has room there, at once', () => {
    // 54 frames a second whatever the rung, started two rungs down by an
    // earlier match: at the top from the start probe on.
    const l = ladderFor(1.25, 2, 60);
    const run = drive(l, scriptBound(60, 1000 / 54), 1800);
    expect(l.index).toBe(0);
    expect(run.changes).toEqual([{ at: expect.any(Number), index: 0 }]);
    expect(run.changes[0]!.at).toBeLessThan(SETTLE + 1500);
    expect(l.spentMs.slice(1)).toEqual([0, 0, 0, 0]);
  });

  // Forty heavy seconds at the top in each span, which a rung down draws
  // at 60: a step down kept for each, the top tried again on probation
  // while the span lasts, and back three minutes after the first.
  const spans = (spans: [number, number][]): Machine => ({
    refreshMs: P,
    workMs: (r, at) =>
      r.ratio === 1.25 && spans.some(([a, b]) => at >= a * 1000 && at < b * 1000) ? 30 : 10,
  });

  it('kept clears the holds of the ones undone before it', () => {
    // Heavy at the top, room a rung down: looks undone, five minutes then
    // ten apart. Light from the seventh minute: kept at the next look.
    // Heavy again from the twentieth: the look after the next step down
    // waits five minutes again, not twenty.
    const heavy = (at: number) => at < 400_000 || at >= 1_200_000;
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => (r.ratio < 1.25 ? 10 : heavy(at) ? 25 : 10),
    };
    const run = drive(ladderFor(1.25, 0, 60), m, 2400);
    const ups = run.changes.filter((c) => c.index === 0).map((c) => c.at);
    expect(ups.some((at) => at > 900_000 && at < 1_000_000)).toBe(true);
    expect(ups.some((at) => at > 1_500_000 && at < 1_600_000)).toBe(true);
  });

  it('given up within three minutes of being kept holds the ladder for the match', () => {
    const l = ladderFor(1.25, 0, 60);
    const run = drive(
      l,
      spans([
        [60, 120],
        [420, 480],
        [900, 960],
      ]),
      1500,
    );
    expect(run.settled).toEqual([0, 1, 0, 1]);
    expect(swings(run)).toBe(1);
    expect(l.index).toBe(1);
    expect(run.changes.at(-1)!.at).toBeLessThan(480_000);
  });

  it('given up later is tried again', () => {
    const l = ladderFor(1.25, 0, 60);
    const run = drive(
      l,
      spans([
        [60, 120],
        [620, 680],
      ]),
      1500,
    );
    expect(run.settled).toEqual([0, 1, 0, 1, 0]);
    expect(l.index).toBe(0);
  });

  it('given up over a deep slowdown is tried again', () => {
    // A step up kept, then within three minutes a minute at 5 frames a
    // second at the top, its pixels to blame: the steps down it takes are
    // no hover, and the ladder climbs back once it is over.
    const l = ladderFor(1.25, 0, 60);
    const m: Machine = {
      refreshMs: P,
      workMs: (r, at) => {
        if (at >= 60_000 && at < 120_000) return r.ratio < 1.25 ? 10 : 30;
        if (at >= 420_000 && at < 480_000) return 200 * (r.ratio / 1.25) ** 2;
        return 10;
      },
    };
    const run = drive(l, m, 1500);
    expect(Math.max(...run.settled.slice(3))).toBeGreaterThanOrEqual(2);
    expect(l.index).toBe(0);
  });
});

describe('a page held back by something else', () => {
  it('gets a trial that is undone, then is left alone a while', () => {
    const l = ladderFor(1.25);
    const run = drive(l, scriptBound(60, 36), 1200);
    expect(l.index).toBe(0);
    expect(run.settled).toEqual([0]);
    // One rung each time: its frames came one and two refreshes apart.
    expect(run.changes.every((c) => c.index <= 1)).toBe(true);
    const trials = run.changes.filter((c) => c.index === 1).map((c) => c.at);
    // Three minutes, then six, then twelve: three trials in twenty minutes.
    expect(trials.length).toBe(3);
    expect(trials[1]! - trials[0]!).toBeGreaterThan(180_000);
    expect(trials[2]! - trials[1]!).toBeGreaterThan(360_000);
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

  it('a run of stalls is left out whole until it has lasted three seconds', () => {
    // A machine at 60 whose frames come 310 ms apart for runs of 1.55 to
    // 2.79 s, each run after a second at 60, for five minutes: the runs
    // are never the frame rate, and only the seconds at 60 are judged.
    for (const frames of [5, 7, 9]) {
      const l = ladderFor(1.25, 0, 60);
      const seen = new Set<number>();
      let at = 0;
      let normal = 0;
      while (at < 300_000) {
        for (let k = 0; k < 60; k++) {
          at += P;
          if (at > SETTLE) normal += P;
          seen.add(l.frame(at));
        }
        for (let k = 0; k < frames; k++) {
          at += 310;
          seen.add(l.frame(at));
        }
      }
      expect([...seen], `${frames} frames`).toEqual([0]);
      // The window open at the settling counts whole.
      expect(l.judgedMs, `${frames} frames`).toBeLessThanOrEqual(normal + 1000);
    }
  });

  it('a run of stalls past three seconds is the new pace, weighed at once', () => {
    // 60 frames a second, then frames 310 ms apart for good: the tenth,
    // 3.1 s in, starts the new pace, and the four windows after the one
    // spanning the change are a step down's before.
    const l = ladderFor(1.25, 0, 60);
    let at = 0;
    while (at < 30_000) {
      at += P;
      l.frame(at);
    }
    const drop = at;
    let tried: number | null = null;
    while (at < drop + 30_000 && tried === null) {
      at += 310;
      l.frame(at);
      if (l.index !== 0) tried = at - drop;
    }
    expect(tried).not.toBeNull();
    expect(tried!).toBeGreaterThan(3100 + 4 * 1240);
    expect(tried!).toBeLessThan(10_000);
  });

  it('slow frames with a frame at the usual rate between them never run on', () => {
    // Every other frame 310 ms late, the ones between on time, for five
    // minutes: each on-time frame ends the run, so the late ones are never
    // the rate.
    const l = ladderFor(1.25, 0, 60);
    const seen = new Set<number>();
    let at = 0;
    while (at < 30_000) {
      at += P;
      l.frame(at);
    }
    const judged = l.judgedMs;
    let normal = 0;
    while (at < 330_000) {
      at += 310;
      seen.add(l.frame(at));
      at += P;
      normal += P;
      seen.add(l.frame(at));
    }
    expect([...seen]).toEqual([0]);
    // The window open at the start counts whole.
    expect(l.judgedMs - judged).toBeLessThanOrEqual(normal + 1000);
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
