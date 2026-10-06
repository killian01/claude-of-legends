// How finely a match is drawn, stepped by the frame rate
// (src/game/quality_ladder.ts), held to each of its rules at their edges:
// the top drawn twenty judged seconds first, the line at three quarters of
// the target, four fresh windows, two windows for a change and eight judged,
// a gain of 1.15 or the shadows' documented one less a margin, the next step
// at once while still short, the walk past rungs that take the same
// refreshes, the holds and their ceilings, the step back up at nine tenths
// or once a step no longer pays, the script's share, the top's own rate, and
// what is not the frame rate: stalls, hitches, a pause, a frame not drawn.
// Whole matches through the dial are in quality_scenarios.test.ts.

import { describe, expect, it } from 'vitest';
import type { QualityLadder } from '../src/game/quality_ladder';
import { DESK_RATIO_FLOOR, ladderRungs, PHONE_RATIO_FLOOR } from '../src/render/quality_dial';
import { drive, exact, ladderFor, type Machine, SETTLE } from './quality_machine';

const P = 1000 / 60;
// Seconds after the settling.
const sinceSettle = (at: number) => (at - SETTLE) / 1000;
const indexes = (changes: { index: number }[]) => changes.map((c) => c.index);
// The times the ladder left the top for a trial.
const downsFromTop = (changes: { at: number; index: number }[]) =>
  changes.filter((c, i) => c.index > 0 && (i === 0 || changes[i - 1]!.index === 0));
const gaps = (xs: { at: number }[]) => xs.slice(1).map((x, i) => (x.at - xs[i]!.at) / 1000);

// Draws `n` frames `dt` ms apart on `l` after `at`; answers the last time.
function frames(l: QualityLadder, at: number, n: number, dt: number): number {
  let t = at;
  for (let k = 0; k < n; k++) {
    t += dt;
    l.frame(t);
  }
  return t;
}

// Draws frames `dt` ms apart on `l` after `at` until `end`.
const until = (l: QualityLadder, at: number, end: number, dt: number) =>
  frames(l, at, Math.max(0, Math.ceil((end - at) / dt)), dt);

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
    // 1.25 is not worth taking from 1.3; a phone stops at 1.
    expect(ladderRungs(1.3, DESK_RATIO_FLOOR).map((r) => r.ratio)).toEqual([
      1.3, 1, 0.85, 0.75, 0.75,
    ]);
    expect(ladderRungs(1.5, PHONE_RATIO_FLOOR).map((r) => r.ratio)).toEqual([1.5, 1.25, 1, 1]);
  });
});

describe('a step down', () => {
  it('is never tried at three quarters of the target, and is just under it', () => {
    expect(exact(ladderFor(), (i) => (i === 0 ? 45.3 : 60), 300).changes).toEqual([]);
    expect(exact(ladderFor(), (i) => (i === 0 ? 44.7 : 60), 120).settled.at(-1)!.index).toBe(1);
  });

  it('waits for the top drawn twenty judged seconds, then four fresh windows', () => {
    // Windows of exactly a second from the settling: the first judged one
    // closes within it, so the trial begins 23 to 24 s in.
    const run = exact(ladderFor(), (i) => (i === 0 ? 25 : 50), 120);
    expect(sinceSettle(run.changes[0]!.at)).toBeGreaterThan(23);
    expect(sinceSettle(run.changes[0]!.at)).toBeLessThan(23.5);
  });

  it('closes a window on four frames at least: at 2 a second, two seconds', () => {
    // The stalls' three seconds, ten windows of the top, four fresh ones.
    const run = exact(ladderFor(), (i) => (i === 0 ? 2 : 2.5), 60);
    expect(sinceSettle(run.changes[0]!.at)).toBeGreaterThan(30.5);
    expect(sinceSettle(run.changes[0]!.at)).toBeLessThan(31.5);
  });

  it('leaves two windows for the change, then judges eight', () => {
    const run = exact(ladderFor(), (i) => (i === 0 ? 25 : 50), 120);
    const [begun, kept] = [run.changes[0]!.at, run.settled[1]!.at];
    expect((kept - begun) / 1000).toBeCloseTo(10, 1);
    expect(run.settled.map((s) => s.index)).toEqual([0, 1]);
  });

  it('is kept for a gain of 1.16 over its before, undone for 1.14', () => {
    expect(exact(ladderFor(), (i) => (i === 0 ? 30 : 34.8), 60).settled.at(-1)!.index).toBe(1);
    const undone = exact(ladderFor(), (i) => (i === 0 ? 30 : 34.2), 60);
    expect(indexes(undone.changes)).toEqual([1, 0]);
  });

  it('onto the shadows is kept for 1.09, its documented 1.11 less a margin, undone for 1.07', () => {
    // A weak GPU on the documented costs: 20 at the top, 47.6 without the
    // shadows, 1.11 over the floor's ratio with them.
    const rates = (last: number) => [20, 28.6, 36.2, 42.9, last];
    // Kept, it pays what it was kept on: nothing tried above it.
    const kept = exact(ladderFor(), (i) => rates(46.8)[i]!, 300);
    expect(indexes(kept.changes)).toEqual([1, 2, 3, 4]);
    expect(kept.settled.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(exact(ladderFor(), (i) => rates(47.6)[i]!, 300).settled.at(-1)!.index).toBe(4);
    const undone = exact(ladderFor(), (i) => rates(45.9)[i]!, 120);
    expect(undone.settled.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(indexes(undone.changes).slice(-2)).toEqual([4, 3]);
  });

  it('is weighed against the fresh windows, not the ones that crossed', () => {
    // 40 at the top for the start, 30 after; 36 a rung down: 1.2 over the
    // fresh 30, kept. The other way round, 0.9 of the fresh 40, undone.
    const fresher = (first: number, then: number) =>
      exact(ladderFor(), (i, at) => (i > 0 ? 36 : at < SETTLE + 20_000 ? first : then), 45);
    expect(fresher(40, 30).settled.at(-1)!.index).toBe(1);
    expect(indexes(fresher(30, 40).changes)).toEqual([1, 0]);
  });

  it('kept but still short, is followed at once by the next against its own windows', () => {
    // 25 at the top, 35 a rung down (1.4, still short), 50 two down (1.43
    // over 35): the second trial begins on the first's last window.
    const run = exact(ladderFor(), (i) => [25, 35, 50, 50, 50][i]!, 60);
    expect(indexes(run.changes)).toEqual([1, 2]);
    expect(run.settled.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(run.settled[1]!.at).toBe(run.changes[1]!.at);
  });

  it('goes rung by rung past rungs that take the same refreshes, four windows each', () => {
    // A strict 60 Hz screen: three refreshes a frame at the top, two from 1
    // to 0.75, one without shadows. A rung gains 1.5; the next gains nothing,
    // every frame still two refreshes: one further, then one more, kept.
    const m: Machine = {
      refreshHz: 60,
      strict: true,
      top: 1.25,
      workMs: (r) => (r.ratio === 1.25 ? 40 : r.shadows ? 25 : 12),
    };
    const run = drive(ladderFor(), m, 80);
    expect(indexes(run.changes).slice(0, 4)).toEqual([1, 2, 3, 4]);
    const [, second, third, fourth] = run.changes;
    expect((third!.at - second!.at) / 1000).toBeCloseTo(10, 0);
    expect((fourth!.at - third!.at) / 1000).toBeCloseTo(6, 0);
    expect(run.settled.map((s) => s.index)).toEqual([0, 1, 4]);
    expect((run.settled[2]!.at - fourth!.at) / 1000).toBeCloseTo(6, 0);
  });

  it('goes no further when the frames take more refreshes some times than others', () => {
    // 30 at the top, 27 a rung down: no gain, no whole refresh, undone; 30
    // on every rung, two refreshes each: one further each time, to the floor.
    expect(indexes(exact(ladderFor(), (i) => (i === 0 ? 30 : 27), 60).changes)).toEqual([1, 0]);
    expect(indexes(exact(ladderFor(), () => 30, 90).changes)).toEqual([1, 2, 3, 4, 0]);
  });

  it('undone, holds the next back 45 s, twice as long after each, three minutes at most', () => {
    // The same 36 whatever the rung: each trial undone; the next one waits
    // out the hold, then four fresh windows, ten after the one before began.
    const run = exact(ladderFor(), () => 36, 900);
    const begun = downsFromTop(run.changes);
    const expected = [45, 90, 180, 180, 180].map((hold) => hold + 10 + 4);
    gaps(begun).forEach((gap, i) => {
      expect(gap).toBeGreaterThan(expected[i]! - 0.5);
      expect(gap).toBeLessThan(expected[i]! + 1.6);
    });
    expect(begun.length).toBe(6);
  });

  it('is tried within the hold once the page slows well under the undone one', () => {
    // 36 whatever the rung, undone; 40 s later the page draws 31 (36 over
    // 1.15 is 31.3) or 32: the first is tried at once, the second waits.
    const tried = (slower: number) => {
      const run = exact(ladderFor(), (_i, at) => (at < SETTLE + 75_000 ? 36 : slower), 140);
      return sinceSettle(downsFromTop(run.changes)[1]!.at);
    };
    expect(tried(31)).toBeLessThan(75 + 14);
    expect(tried(32)).toBeGreaterThan(80);
  });

  it('undone, judges none of the windows from before its trial again', () => {
    // 36 whatever the rung, the trial undone; the page then draws 20 at the
    // top, well under the 36 it was weighed against: eight windows of its
    // own and four fresh ones before the next, not the old ones and four.
    const l = ladderFor();
    let tried = false;
    let undoneAt = Number.POSITIVE_INFINITY;
    const run = exact(
      l,
      (i, at) => {
        if (l.trying) tried = true;
        else if (tried && undoneAt === Number.POSITIVE_INFINITY) undoneAt = at;
        return at < undoneAt ? 36 : i === 0 ? 20 : 40;
      },
      90,
    );
    const next = (downsFromTop(run.changes)[1]!.at - undoneAt) / 1000;
    expect(next).toBeGreaterThan(11.5);
    expect(next).toBeLessThan(13.5);
  });

  it('whose page slowed under it holds nothing, and fresh windows follow at once', () => {
    // 40 whatever the rung until 28 s in, then 20 at the top and 32 a rung
    // down: the trial's windows read 32, well under its 40; four windows
    // later the next one is tried, and kept.
    const run = exact(ladderFor(), (i, at) => (at < SETTLE + 28_000 ? 40 : i === 0 ? 20 : 32), 60);
    expect(indexes(run.changes).slice(0, 3)).toEqual([1, 0, 1]);
    expect((run.changes[2]!.at - run.changes[1]!.at) / 1000).toBeCloseTo(4, 0);
    expect(run.settled[1]!.index).toBe(1);
  });

  it('is not tried for frames held back by their own script', () => {
    const tried = (share: number) =>
      exact(
        ladderFor(),
        () => 36,
        120,
        () => share,
      ).changes.length > 0;
    expect(tried(0.76)).toBe(false);
    expect(tried(0.74)).toBe(true);
  });

  it('is never tried on a 144 Hz screen drawing 46, its target capped at 60', () => {
    const m: Machine = { refreshHz: 144, top: 1.25, workMs: () => 21.7 };
    const l = ladderFor(1.25, 144);
    expect(drive(l, m, 300).changes).toEqual([]);
    expect(l.screenHz).toBeCloseTo(144, 0);
  });
});

describe('a step up', () => {
  it('is tried from a rung drawing nine tenths of the target, not just under', () => {
    // 40 at the top, a rung down 54.5 or 53.5: room above at 54 only.
    const ups = (below: number) =>
      exact(ladderFor(), (i) => (i === 0 ? 40 : below), 200).changes.filter((c) => c.index === 0);
    expect(ups(54.5).length).toBeGreaterThan(0);
    expect(ups(53.5)).toEqual([]);
  });

  it('is tried once its rung no longer draws 1.15 times its step before', () => {
    // 40 at the top, 50 a rung down, then 45.5 (under 46) or 46.5.
    const ups = (later: number) =>
      exact(ladderFor(), (i, at) => (i === 0 ? 40 : at < 100_000 ? 50 : later), 200).changes;
    expect(ups(45.5).some((c) => c.index === 0 && c.at > 100_000)).toBe(true);
    expect(ups(46.5).filter((c) => c.index === 0)).toEqual([]);
  });

  it('is kept when the rung above holds the line again', () => {
    // 40 at the top for the first minute and a half, 60 after; 60 a rung
    // down: the tries 20 and 40 s apart undone, the next kept.
    const run = exact(ladderFor(), (i, at) => (i > 0 || at > 100_000 ? 60 : 40), 200);
    expect(run.settled.map((s) => s.index)).toEqual([0, 1, 0]);
    expect(sinceSettle(run.settled[2]!.at)).toBeCloseTo(124.5, 0);
  });

  it('undone, holds the next back 20 s, twice as long after each, five minutes at most', () => {
    const run = exact(ladderFor(), (i) => (i === 0 ? 40 : 60), 1800);
    const ups = run.changes.filter((c) => c.index === 0);
    const expected = [20, 40, 80, 160, 300, 300, 300, 300].map((hold) => hold + 10);
    gaps(ups).forEach((gap, i) => {
      expect(gap).toBeGreaterThan(expected[i]! - 0.5);
      expect(gap).toBeLessThan(expected[i]! + 1.2);
    });
    expect(ups.length).toBe(9);
  });

  it('kept, starts its holds over', () => {
    // 40 at the top until 90 s, 60 until 190 s, 40 again; 60 a rung down:
    // two tries undone, one kept, then after the next step a try undone
    // waits 20 s again, not 160.
    const run = exact(
      ladderFor(),
      (i, at) => (i > 0 ? 60 : at < SETTLE + 90_000 ? 40 : at < SETTLE + 190_000 ? 60 : 40),
      300,
    );
    const ups = run.changes.filter((c) => c.index === 0);
    expect(ups.length).toBe(5);
    expect(gaps(ups.slice(3))[0]).toBeLessThan(35);
  });

  it('kept, weighs its rung on its own windows at once', () => {
    // Two steps kept (25, 35, 50); the slowdown over at 80 s: the second
    // rung up is tried on the window after the first is kept.
    const run = exact(ladderFor(), (i, at) => (at > SETTLE + 80_000 ? 60 : [25, 35, 50][i]!), 160);
    const ups = run.changes.filter((c, i) => i > 0 && c.index < run.changes[i - 1]!.index);
    expect(ups.map((c) => c.index)).toEqual([1, 0]);
    expect(gaps(ups)[0]).toBeLessThan(12);
  });

  it('goes back to the rung its step left, past the rungs walked over', () => {
    // Two refreshes a frame at the top and the next two rungs, one at 0.75:
    // a step walked from the top; the slowdown over, back to the top at once.
    const m: Machine = {
      refreshHz: 60,
      strict: true,
      top: 1.25,
      workMs: (r, at) => (at < 70_000 && r.ratio > 0.75 ? 25 : 12),
    };
    const run = drive(ladderFor(), m, 120);
    expect(run.settled.map((s) => s.index)).toEqual([0, 3, 0]);
  });

  it('kept, holds the next step down back as one undone', () => {
    // 40 whatever the rung for 27 s, then 60, and from 60 s 40 again at the
    // top only: the step kept as the first slowdown ended, given back, holds
    // the next; a page slowed well under it (30) is tried at once.
    const second = (slower: number) => {
      const run = exact(
        ladderFor(),
        (i, at) => (at < SETTLE + 27_000 ? 40 : at < SETTLE + 60_000 || i > 0 ? 60 : slower),
        200,
      );
      return downsFromTop(run.changes).map((c) => sinceSettle(c.at))[1]!;
    };
    expect(second(40)).toBeGreaterThan(60 + 30);
    expect(second(30)).toBeLessThan(60 + 14);
  });
});

describe("the top's own rate", () => {
  it('is weighed on its judged windows, whatever happens below', () => {
    const l = ladderFor();
    exact(l, (i) => (i === 0 ? 25 : 50), 120);
    expect(l.topShare).toBeCloseTo(25 / 60, 2);
    expect(l.topMs / 1000).toBeGreaterThan(23);
    expect(l.topMs / 1000).toBeLessThan(24.5);
    expect(l.judgedMs / 1000).toBeGreaterThan(109);
  });
});

describe("the screen's refresh", () => {
  it('is the rate known from lighter frames when every frame takes two refreshes', () => {
    // A weak GPU at a steady 30 on a 60 Hz screen: the menus drew at 60.
    const l = ladderFor(1.25, 60);
    const run = drive(l, { refreshHz: 60, top: 1.25, workMs: (r) => 33.4 * r.ratio ** 2 }, 60);
    expect(l.screenHz).toBeCloseTo(60, 0);
    expect(run.settled.at(-1)!.index).toBeGreaterThan(0);
  });

  it('is kept only when the frames came slower than it, some more than others', () => {
    // A steady 30 with nothing known is a 30 Hz screen, left alone.
    const steady = ladderFor(1.25, null);
    const m = { refreshHz: 60, top: 1.25, workMs: () => 33.4 };
    expect(drive(steady, m, 120).changes).toEqual([]);
    expect(steady.screenHz).toBeCloseTo(30, 0);
    expect(steady.refreshRead).toBeNull();
    const mixed = ladderFor(1.25, null);
    drive(mixed, { ...m, workMs: () => 22 }, 60);
    expect(mixed.refreshRead).toBeCloseTo(60, 0);
  });

  it('is the best rate seen when no refresh can be read', () => {
    // Intervals that share no divisor, about 34 a second, nothing known:
    // that is the screen's rate as far as anyone can tell.
    const l = ladderFor(1.25, null);
    const cycle = [23.7, 31.1, 27.9, 35.3, 29.4, 26.2, 33.8, 24.5];
    let at = 0;
    for (let i = 0; i < 6000; i++) at = frames(l, at, 1, cycle[i % cycle.length]!);
    expect(l.screenHz!).toBeGreaterThan(30);
    expect(l.screenHz!).toBeLessThan(40);
    expect([l.index, l.settled]).toEqual([0, 0]);
  });

  it('is not taken from another screen: a 50 Hz panel, a 30 Hz one', () => {
    const fifty = ladderFor(1.25, 60);
    expect(drive(fifty, { refreshHz: 50, top: 1.25, workMs: () => 15 }, 300).changes).toEqual([]);
    expect(fifty.screenHz).toBeCloseTo(50, 0);
    const thirty = ladderFor(1.25, 30);
    expect(drive(thirty, { refreshHz: 30, top: 1.25, workMs: () => 20 }, 300).changes).toEqual([]);
  });
});

describe('what is not the frame rate', () => {
  // Frames at `steady` ms at the top past the settling (60 a second
  // otherwise), and from 40 s, each second, `n` frames of `ms`; whether a
  // step was ever tried.
  function bursts(steady: number, n: number, ms: number, seconds = 300) {
    const l = ladderFor();
    let [at, next, tried] = [0, 40_000, false];
    while (at < seconds * 1000) {
      if (at >= next) {
        next += 1000;
        at = frames(l, at, n, ms);
      }
      at = frames(l, at, 1, l.index === 0 && at > SETTLE ? steady : P);
      tried ||= l.index > 0;
    }
    return Object.assign(l, { tried });
  }

  it('a slow frame in a window is a hitch: four times its median and it is left out', () => {
    // 47 a second and one frame a second 4.1 or 3.9 times as long: with it
    // the window reads 44, and a rung down draws 60.
    const left = bursts(1000 / 47, 1, 4100 / 47);
    expect([left.tried, left.topShare! > 0.75]).toEqual([false, true]);
    expect(bursts(1000 / 47, 1, 3900 / 47).settled).toBe(1);
  });

  it('frames 250 ms or more after usual ones are stalls, shorter ones the rate', () => {
    // Three in a row each second at 60: as stalls they are not counted; as
    // frames they make every window short (the longest left out as a hitch).
    const stalls = bursts(P, 3, 260, 120);
    expect([stalls.tried, stalls.topShare! > 0.9]).toEqual([false, true]);
    expect(bursts(P, 3, 240, 120).tried).toBe(true);
  });

  it('stalls in a row are not the rate until they have lasted three seconds', () => {
    // Runs of 310 ms frames a second apart, 2.79 s at most: never judged.
    for (const n of [5, 7, 9]) {
      const l = bursts(P, n, 310);
      expect(l.topShare!, `${n}`).toBeGreaterThan(0.9);
    }
    // For good: the tenth, 3.1 s in, starts the new pace, all judged after.
    const l = ladderFor();
    const at = until(l, 0, 40_000, P);
    const judged = l.judgedMs;
    frames(l, at, 9, 310);
    expect(l.judgedMs).toBe(judged);
    frames(l, at + 9 * 310, 31, 310);
    expect(l.judgedMs).toBeGreaterThan(judged + 20 * 310);
  });

  it('runs of stalls past three seconds are counted from then', () => {
    // A second at 60, then 9 or 10 frames 310 ms apart, over and over: the
    // tenth of each run is counted, the ninth never.
    const judged = (n: number) => {
      const l = ladderFor();
      let at = 0;
      for (let run = 0; run < 60; run++) at = frames(l, frames(l, at, 60, P), n, 310);
      return l.judgedMs;
    };
    expect(judged(10) - judged(9)).toBeGreaterThan(0.9 * 50 * 310);
  });

  it('a frame of the usual length ends a run of stalls', () => {
    // Every other frame 310 ms late for five minutes: never the rate.
    const l = ladderFor();
    let at = 0;
    while (at < 300_000) at = frames(l, frames(l, at, 1, 310), 1, P);
    expect(l.topShare!).toBeGreaterThan(0.9);
  });

  it('at 10 a second, a frame 3.5 times as long is the rate, not a stall', () => {
    // Four times the usual interval is a stall's least, past 250 ms.
    const l = ladderFor();
    let [at, slow] = [0, 0];
    while (at < 60_000) {
      const dt = at > SETTLE && Math.floor(at / 2000) !== Math.floor((at + 100) / 2000) ? 350 : 100;
      if (at > SETTLE) slow += dt;
      at = frames(l, at, 1, dt);
    }
    expect(l.judgedMs).toBeGreaterThan(slow - 2000);
  });

  it('a pause ends a run of stalls, and drops the windows before it', () => {
    // Two and a half seconds of stalls, a pause, three more after it: as
    // if the first were never drawn.
    const twin = (stalls: boolean) => {
      const l = ladderFor();
      let at = until(l, 0, 40_000, P);
      at = stalls ? frames(l, at, 8, 310) : at + 8 * 310;
      l.pause(at + 4000);
      frames(l, frames(l, frames(l, at, 300, P), 3, 310), 300, P);
      return l.judgedMs;
    };
    expect(twin(true)).toBe(twin(false));
    // Three slow windows before a pause are not the five a crossing needs:
    // eight fresh ones after its settling, then four.
    const l = ladderFor();
    const run = exact(l, (_i, at) => (at < SETTLE + 25_000 ? 60 : 40), 38);
    l.pause(run.at + 4000);
    let at = run.at;
    while (!l.trying) at = frames(l, at, 1, 25);
    expect((at - run.at) / 1000).toBeGreaterThan(15);
  });

  it("a match's first seconds, a pause, and a frame not drawn", () => {
    // Slow while the match loads: not judged.
    const loading = ladderFor();
    expect(
      drive(loading, { refreshHz: 60, top: 1.25, workMs: (_r, at) => (at < SETTLE ? 80 : 10) }, 60)
        .changes,
    ).toEqual([]);
    // A pause drops the windows and judges nothing until it ends.
    const paused = ladderFor();
    let run = drive(paused, { refreshHz: 60, top: 1.25, workMs: () => 10 }, 40);
    const judged = paused.judgedMs;
    paused.pause(run.at + 10_000);
    run = drive(paused, { refreshHz: 60, top: 1.25, workMs: () => 45 }, 9.5, run.at);
    expect(paused.judgedMs).toBe(judged);
    // Every other refresh skipped by the renderer: nothing judged or read.
    const gaps = ladderFor(1.25, null);
    let at = 0;
    for (let i = 0; i < 2000; i++) {
      at += P;
      if (i % 2 === 0) gaps.gap();
      else gaps.frame(at);
    }
    expect([gaps.judgedMs, gaps.screenHz]).toEqual([0, null]);
  });

  it('a pause starts a trial in progress over', () => {
    const l = ladderFor();
    const run = exact(l, (i) => (i === 0 ? 25 : 50), 36);
    expect(l.trying).toBe(true);
    l.pause(run.at + 4000);
    const at = until(l, run.at, run.at + 4000 + 9000, 20);
    expect(l.trying).toBe(true);
    until(l, at, run.at + 4000 + 11_000, 20);
    expect([l.trying, l.settled]).toEqual([false, 1]);
  });
});
