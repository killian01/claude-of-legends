// The sight walls' spatial index (src/sim/wall_index.ts) answers exactly
// what testing every wall answers, on the sphere and on the plane: the
// planet's thousands of rocks cost a handful of tests a line, never a
// different sight.

import { describe, expect, it } from 'vitest';
import type { WallShape } from '../src/sim/content/map';
import { segmentDist } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import { along, randomHeading, randomSpherePoint } from '../src/sim/royale/layout';
import type { Vec2 } from '../src/sim/types';
import { anyWallOnLine, WALL_INDEX_MIN } from '../src/sim/wall_index';

function brute(walls: readonly WallShape[], a: Vec2, b: Vec2): boolean {
  return walls.some((w) => segmentDist(w, a, b).d <= w.r);
}

describe('the wall index', () => {
  it('agrees with every wall tested on the sphere', () => {
    const rng = new Rng(5);
    const walls: WallShape[] = [];
    for (let i = 0; i < 2400; i++) {
      const p = randomSpherePoint(rng, 80);
      walls.push({ x: p.x, y: p.y, z: p.z, r: 0.4 + rng.next() * 3 });
    }
    let blocked = 0;
    for (let i = 0; i < 4000; i++) {
      const a = randomSpherePoint(rng, 80);
      const b = along(a, randomHeading(rng, a), 0.5 + rng.next() * 20, 80);
      const want = brute(walls, a, b);
      expect(anyWallOnLine(walls, a, b)).toBe(want);
      if (want) blocked++;
    }
    expect(blocked).toBeGreaterThan(400);
    expect(blocked).toBeLessThan(3600);
  });

  it('agrees on the plane, and below its size the plain loop runs', () => {
    const rng = new Rng(8);
    const walls: WallShape[] = [];
    for (let i = 0; i < 300; i++) {
      walls.push({ x: rng.next() * 150, z: rng.next() * 150, r: 0.5 + rng.next() * 4 });
    }
    expect(walls.length).toBeGreaterThan(WALL_INDEX_MIN);
    for (let i = 0; i < 3000; i++) {
      const a = { x: rng.next() * 150, z: rng.next() * 150 };
      const b = { x: a.x + (rng.next() - 0.5) * 30, z: a.z + (rng.next() - 0.5) * 30 };
      expect(anyWallOnLine(walls, a, b)).toBe(brute(walls, a, b));
      expect(anyWallOnLine(walls.slice(0, 10), a, b)).toBe(brute(walls.slice(0, 10), a, b));
    }
  });
});
