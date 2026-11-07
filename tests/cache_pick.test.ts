// A walk ordered onto or beside a standing cache goes to its middle, where
// standing opens it, and so does a steered walk (stick or arrow keys) that
// comes to rest beside one; a walk ordered elsewhere is left as it was.

import { describe, expect, it } from 'vitest';
import { CACHE_PICK_M, cacheGoal } from '../src/game/cache_pick';
import type { SnapCache } from '../src/net/royale_wire';
import { CACHE_REACH_M } from '../src/sim/royale/types';

const R = 100;
// A cache on the planet's top, and one a little round from it.
const top: SnapCache = [7, 0, R, 0, 0];
const near: SnapCache = [8, 4, Math.sqrt(R * R - 16), 0, 1];

describe('cacheGoal', () => {
  it('sends a click just past the reach to the cache middle', () => {
    const p = { x: 0, y: R, z: CACHE_REACH_M + 0.8 };
    expect(cacheGoal(p, [top])).toEqual({ x: 0, y: R, z: 0 });
  });

  it('leaves a click far from every cache alone', () => {
    expect(cacheGoal({ x: 0, y: R, z: CACHE_PICK_M[0] + 0.5 }, [top])).toBeNull();
    expect(cacheGoal({ x: 0, y: R, z: 1 }, [])).toBeNull();
    expect(cacheGoal({ x: 0, y: R, z: 1 }, null)).toBeNull();
  });

  it('picks the nearest of two caches in catch', () => {
    const p = { x: 2.5, y: R, z: 0 };
    expect(cacheGoal(p, [top, near])).toEqual({ x: 4, y: near[2], z: 0 });
    expect(cacheGoal({ x: 1, y: R, z: 0 }, [near, top])).toEqual({ x: 0, y: R, z: 0 });
  });

  it('catches from farther round a bigger chest', () => {
    const p = { x: 0, y: R, z: 3.2 };
    expect(cacheGoal(p, [top])).toBeNull();
    expect(cacheGoal(p, [[9, 0, R, 0, 1]])).toEqual({ x: 0, y: R, z: 0 });
  });

  it('takes a steered walk resting beside a cache on into its reach', () => {
    // The stick rested or the arrow keys let go 2.4 m off: outside the
    // reach, where standing opens nothing, and inside the catch.
    const rest = { x: 2.4 * Math.SQRT1_2, y: R, z: 2.4 * Math.SQRT1_2 };
    expect(Math.hypot(rest.x, rest.z)).toBeGreaterThan(CACHE_REACH_M);
    expect(cacheGoal(rest, [top])).toEqual({ x: 0, y: R, z: 0 });
    // Passing farther off, the rest stays where it is.
    expect(cacheGoal({ x: 0, y: R, z: 4 }, [top])).toBeNull();
  });

  it('ends inside the reach the bots walk to', () => {
    expect(CACHE_PICK_M[0]).toBeGreaterThan(CACHE_REACH_M);
  });
});
