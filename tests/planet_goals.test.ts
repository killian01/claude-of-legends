// A bout's goals drawn from the shape alone (src/render/planet_goals.ts):
// every primitive of the closed set has a look, its color the holder's (the
// viewer, another seat, nobody), and a dot on the minimap.

import { describe, expect, it } from 'vitest';
import type { WireGoal } from '../src/net/goal_wire';
import {
  GOAL_NONE,
  GOAL_OTHER,
  GOAL_SELF,
  goalDots,
  goalLook,
  MAX_GOALS,
} from '../src/render/planet_goals';

const at = { x: 0, y: 80, z: 0 };

describe("a bout's goals on the planet", () => {
  it('draws every shape of the closed set', () => {
    expect(goalLook({ shape: 'circle', holder: null }, 3)).toEqual({
      color: GOAL_NONE,
      column: 14,
      double: false,
    });
    expect(goalLook({ shape: 'target', holder: null }, 3).double).toBe(true);
    expect(goalLook({ shape: 'carrier', holder: 3 }, 3)).toEqual({
      color: GOAL_SELF,
      column: 4,
      double: false,
    });
  });

  it('colors a goal by who holds it: the viewer, another seat, nobody', () => {
    expect(goalLook({ shape: 'circle', holder: 3 }, 3).color).toBe(GOAL_SELF);
    expect(goalLook({ shape: 'circle', holder: 5 }, 3).color).toBe(GOAL_OTHER);
    expect(goalLook({ shape: 'circle', holder: null }, 3).color).toBe(GOAL_NONE);
    // A viewer with no unit (a replay) sees every holder as another seat.
    expect(goalLook({ shape: 'circle', holder: 5 }, null).color).toBe(GOAL_OTHER);
  });

  it('puts each on the minimap, a ring for what stands on the ground, at most MAX_GOALS', () => {
    const goals: WireGoal[] = [
      { shape: 'circle', at, radius: 6, holder: 3 },
      { shape: 'carrier', at, radius: 2, holder: null },
    ];
    expect(goalDots(goals, 3)).toEqual([
      { at, radius: 6, color: '#ffd35a', ring: true },
      { at, radius: 2, color: '#bfe0ff', ring: false },
    ]);
    const many = Array.from({ length: MAX_GOALS + 3 }, () => goals[0]!);
    expect(goalDots(many, 3)).toHaveLength(MAX_GOALS);
  });
});
