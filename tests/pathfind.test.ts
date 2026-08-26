// Pathfinding gate: routes exist, avoid walls, handle blocked targets, and
// are deterministic.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { NavGrid } from '../src/sim/navgrid';
import { findPath } from '../src/sim/pathfind';

const grid = new NavGrid(GAME_MAP.size, GAME_MAP.walls, GAME_MAP.borderMargin);
const fountain0 = { x: 7, z: 7 };
const fountain1 = { x: 143, z: 143 };

describe('findPath', () => {
  it('routes between the two fountains with every segment walkable', () => {
    const path = findPath(grid, fountain0, fountain1);
    expect(path.length).toBeGreaterThan(0);
    let anchor = fountain0;
    for (const wp of path) {
      expect(grid.lineOfWalk(anchor, wp)).toBe(true);
      anchor = wp;
    }
    const end = path[path.length - 1]!;
    expect(Math.hypot(end.x - fountain1.x, end.z - fountain1.z)).toBeLessThan(1.5);
  });

  it('routes around a jungle wall when the straight line is blocked', () => {
    const from = { x: 32, z: 40 };
    const to = { x: 32, z: 70 };
    expect(grid.lineOfWalk(from, to)).toBe(false);
    const path = findPath(grid, from, to);
    expect(path.length).toBeGreaterThanOrEqual(2);
    let anchor = from;
    for (const wp of path) {
      expect(grid.lineOfWalk(anchor, wp)).toBe(true);
      anchor = wp;
    }
  });

  it('redirects a target inside a wall to the nearest walkable point', () => {
    const wall = GAME_MAP.walls[0]!;
    const path = findPath(grid, fountain0, { x: wall.x, z: wall.z });
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1]!;
    expect(grid.isWalkableAt(end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - wall.x, end.z - wall.z)).toBeLessThan(wall.r + 3);
  });

  it('is deterministic', () => {
    const a = findPath(grid, fountain0, { x: 100, z: 120 });
    const b = findPath(grid, fountain0, { x: 100, z: 120 });
    expect(a).toEqual(b);
  });
});
