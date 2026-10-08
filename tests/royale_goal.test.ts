// The goal across battle royales (src/ui/royale_goal.ts): the points a
// browser's seats earned, climbed as levels on Respawn's end card, the bar
// from the last level reached to the next, starting partly filled, and the
// count kept as the points come.

import { describe, expect, it } from 'vitest';
import {
  GOAL_FIRST_SPAN,
  GOAL_HEAD_START,
  GOAL_MAX_POINTS,
  GOAL_SPAN_GROWTH,
  GoalTrack,
  goalModel,
  goalShare,
  goalStep,
} from '../src/ui/royale_goal';

describe('the levels', () => {
  it('start at level 1, a first match away from level 2, each span a little longer', () => {
    expect(goalStep(0)).toEqual({ level: 1, from: 0, to: GOAL_FIRST_SPAN });
    expect(goalStep(GOAL_FIRST_SPAN - 1).level).toBe(1);
    expect(goalStep(GOAL_FIRST_SPAN)).toEqual({
      level: 2,
      from: GOAL_FIRST_SPAN,
      to: 2 * GOAL_FIRST_SPAN + GOAL_SPAN_GROWTH,
    });
    // 50, 125, 225, 350: three takedowns and five assists alone (55) are a
    // level at first; a full match later is about one.
    expect([50, 125, 225, 350].map((p) => goalStep(p).level)).toEqual([2, 3, 4, 5]);
    expect([49, 124, 224, 349].map((p) => goalStep(p).level)).toEqual([1, 2, 3, 4]);
  });

  it('reads junk as nothing and caps a stored total', () => {
    expect(goalStep(-40).level).toBe(1);
    expect(goalStep(Number.NaN).level).toBe(1);
    expect(goalStep(GOAL_MAX_POINTS * 10)).toEqual(goalStep(GOAL_MAX_POINTS));
  });

  it('fills the first bar from a head start, every later one from empty', () => {
    expect(goalShare(0, goalStep(0))).toBe(GOAL_HEAD_START);
    expect(goalShare(25, goalStep(25))).toBeCloseTo(GOAL_HEAD_START + (1 - GOAL_HEAD_START) / 2);
    expect(goalShare(50, goalStep(50))).toBe(0);
    expect(goalShare(87.5, goalStep(87.5))).toBeCloseTo(0.5);
  });
});

describe('the card', () => {
  it("shows a first match's points on a bar that started partly filled", () => {
    const g = goalModel(0, 34);
    expect(g).toMatchObject({ level: 1, next: 2, reached: null, earned: 34, left: 16 });
    expect(g.was).toBe(GOAL_HEAD_START);
    expect(g.now).toBeGreaterThan(g.was);
    expect(g.title).toBe('Level 1');
    expect(g.line).toBe('+34 points this match · 16 more to Level 2');
  });

  it('carries the bar from where the last match left it', () => {
    const g = goalModel(70, 30);
    expect(g).toMatchObject({ level: 2, next: 3, reached: null, left: 25 });
    expect(g.was).toBeCloseTo(20 / 75);
    expect(g.now).toBeCloseTo(50 / 75);
  });

  it('says the level a match reached, the bar starting on its floor', () => {
    const g = goalModel(40, 100);
    expect(g).toMatchObject({ level: 3, next: 4, reached: 3, left: 85 });
    expect(g.was).toBe(0);
    expect(g.now).toBeCloseTo(15 / 100);
    expect(g.title).toBe('Level 3 reached');
    expect(g.line).toBe('+100 points this match · 85 more to Level 4');
  });

  it('says a match without points plainly, one point in the singular', () => {
    expect(goalModel(10, 0).line).toBe('No points this match · 40 more to Level 2');
    expect(goalModel(10, 1).line).toBe('+1 point this match · 39 more to Level 2');
    expect(goalModel(10, -5).earned).toBe(0);
  });
});

describe('the count', () => {
  it('reads the total once, writes it as each award comes, and models the match', () => {
    let stored = 60;
    const reads: number[] = [];
    const track = new GoalTrack(
      () => {
        reads.push(stored);
        return stored;
      },
      (total) => {
        stored = total;
      },
    );
    track.earn(10);
    track.earn(5);
    track.earn(0);
    track.earn(-3);
    expect(stored).toBe(75);
    expect(reads).toEqual([60]);
    expect(track.model()).toMatchObject({ earned: 15, level: 2, left: 50 });
  });
});
