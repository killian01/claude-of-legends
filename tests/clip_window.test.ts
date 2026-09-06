// Scoring a match for the thirty seconds worth filming. The weights are a
// judgement call and not a fact, so what is pinned here is the ordering
// they are supposed to produce: the calibration that matters is that a
// crowd standing still never outranks a fight, which is exactly the way
// the first version of this got it wrong.

import { describe, expect, it } from 'vitest';
import { bestWindow, mixedCluster, type Spot, tickScore } from '../scripts/clip_window';

const quiet = { deaths: 0, towers: 0, warden: 0, casts: 0, clustered: 0 };

describe('what makes a tick worth filming', () => {
  it('is worth nothing when nothing happens', () => {
    expect(tickScore(quiet)).toBe(0);
  });

  it('ranks a death above every other single thing', () => {
    const death = tickScore({ ...quiet, deaths: 1 });
    expect(death).toBeGreaterThan(tickScore({ ...quiet, towers: 1 }));
    expect(death).toBeGreaterThan(tickScore({ ...quiet, casts: 10 }));
    expect(death).toBeGreaterThan(tickScore({ ...quiet, clustered: 10 }));
  });

  it('pays nothing for a crowd of three, which is a skirmish anywhere', () => {
    expect(tickScore({ ...quiet, clustered: 3 })).toBe(0);
    expect(tickScore({ ...quiet, clustered: 4 })).toBeGreaterThan(0);
  });
});

describe('the calibration between a fight and a crowd', () => {
  it('keeps a full window of standing around below a handful of kills', () => {
    // The crowd term is the only one that accrues on every tick, so it is
    // the one that can quietly dominate a 600 tick window. Ten champions
    // on top of each other for the whole of it must still lose to four
    // deaths, or the scout films a lane that is not fighting.
    const width = 600;
    const standing = Array.from({ length: width }, () =>
      tickScore({ ...quiet, clustered: 10 }),
    ).reduce((a, b) => a + b, 0);
    const fourKills = 4 * tickScore({ ...quiet, deaths: 1 });
    expect(standing).toBeLessThan(fourKills);
  });
});

describe('the best window', () => {
  it('is the run of ticks with the most in it', () => {
    const scores = [0, 0, 5, 5, 0, 0, 9, 0];
    expect(bestWindow(scores, 2)).toEqual({ start: 2, total: 10 });
  });

  it('takes the earliest of equals, so a rerun films the same thing', () => {
    expect(bestWindow([3, 3, 3, 3], 2)).toEqual({ start: 0, total: 6 });
  });

  it('handles a window wider than the match without inventing ticks', () => {
    expect(bestWindow([1, 2], 10)).toEqual({ start: 0, total: 3 });
  });

  it('says nothing rather than throw on an empty match', () => {
    expect(bestWindow([], 600)).toEqual({ start: 0, total: 0 });
    expect(bestWindow([1, 2, 3], 0)).toEqual({ start: 0, total: 0 });
  });
});

describe('the cluster that counts', () => {
  const near = (team: number, x: number): Spot => ({ team, x, z: 0 });

  it('ignores a team that is alone, however tightly packed', () => {
    expect(mixedCluster([near(0, 0), near(0, 1), near(0, 2), near(0, 3)], 13)).toBe(0);
  });

  it('counts everyone within reach of one of them once both teams are there', () => {
    expect(mixedCluster([near(0, 0), near(0, 1), near(1, 2)], 13)).toBe(3);
  });

  it('does not join two fights that are far apart', () => {
    const spots = [near(0, 0), near(1, 1), near(0, 100), near(1, 101)];
    expect(mixedCluster(spots, 13)).toBe(2);
  });

  it('is empty when the map is', () => {
    expect(mixedCluster([], 13)).toBe(0);
  });
});
