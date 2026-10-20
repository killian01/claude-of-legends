// A person's seat over a whole Thornfray for the seat report
// (server/thornfray_seat.ts, ADR 0035): each stint folded onto the match's
// clock, the first moments kept, the counts summed, the champion's counters
// counted from where each stint began. Pure.

import { describe, expect, it } from 'vitest';
import { freshStats } from '../server/match';
import { countersOf, foldStats, foldStint, newTally } from '../server/thornfray_seat';

describe('a stint folded in', () => {
  it('moves the first bout onto the match clock as it is', () => {
    const s = freshStats(0, 1, 2);
    s.loadedTick = 30;
    s.orders = 4;
    s.kinds = { move: 3, cast: 1 };
    s.firstOrderTick = 220;
    s.steps = ['br_fight'];
    s.walked = 12;
    s.firstHitTick = 300;
    const folded = foldStats(null, s, 0);
    expect(folded).toMatchObject({
      startTick: 0,
      loadedTick: 30,
      orders: 4,
      firstOrderTick: 220,
      firstHitTick: 300,
      walked: 12,
    });
  });

  it('keeps the first moments, sums the counts and the steps, past the bouts before', () => {
    const first = freshStats(0, 0, 0);
    first.orders = 2;
    first.kinds = { move: 2 };
    first.steps = ['br_fight'];
    first.points = 10;
    first.firstOrderTick = 250;
    const second = freshStats(0, 0, 0);
    second.orders = 3;
    second.kinds = { move: 1, cast: 2 };
    second.steps = ['br_fight', 'br_cache'];
    second.points = 5;
    second.firstOrderTick = 210;
    second.firstCacheTick = 400;
    second.loadedTick = 20;
    const folded = foldStats(foldStats(null, first, 0), second, 1500);
    expect(folded.orders).toBe(5);
    expect(folded.kinds).toEqual({ move: 3, cast: 2 });
    expect(folded.steps).toEqual(['br_fight', 'br_cache']);
    expect(folded.points).toBe(15);
    // The first order the first bout's; the first cache the second's, on
    // the match's clock.
    expect(folded.firstOrderTick).toBe(250);
    expect(folded.firstCacheTick).toBe(1900);
    expect(folded.loadedTick).toBe(1520);
    expect(folded.startTick).toBe(0);
  });

  it("counts the champion's counters from where each stint began", () => {
    const t = newTally();
    const u = { level: 6, kills: 0, deaths: 0, assists: 0, cs: 0 };
    foldStint(t, freshStats(0, 0, 0), 0, countersOf(u), { ...u, kills: 2, deaths: 1 });
    // A rejoin in the same bout: the stint begins where the bot left it.
    const from = { level: 6, kills: 3, deaths: 1, assists: 0, cs: 0 };
    foldStint(t, freshStats(400, 0, 0), 0, from, { ...from, level: 7, kills: 4, assists: 2 });
    expect(t.unit).toEqual({ level: 7, kills: 3, deaths: 1, assists: 2, cs: 0 });
    expect(countersOf(undefined)).toEqual({ level: 0, kills: 0, deaths: 0, assists: 0, cs: 0 });
  });
});
