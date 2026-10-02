// The ground seam (src/sim/ground.ts, ADR 0029): the plane's ground answers
// exactly what its grid and A* answer, the sphere's hands sphere points to
// the planet's navigation and turns a point without y away, and the open
// sphere the tests stand on is open everywhere.

import { describe, expect, it } from 'vitest';
import {
  OpenSphereGround,
  PlaneGround,
  SphereGround,
  type SphereNav,
  type SpherePoint,
} from '../src/sim/ground';
import { NavGrid } from '../src/sim/navgrid';
import { findPath } from '../src/sim/pathfind';
import { TerrainNavGrid } from '../src/sim/terrain_nav';

describe('the plane ground', () => {
  const walls = [
    { x: 10, z: 10, r: 3 },
    { x: 20, z: 6, r: 2 },
  ];

  it('answers what the grid and its A* answer', () => {
    const nav = new NavGrid(30, walls, 1);
    const twin = new NavGrid(30, walls, 1);
    const ground = new PlaneGround(nav);
    const points = [
      { x: 10, z: 10 },
      { x: 4.2, z: 9.7 },
      { x: 0.5, z: 0.5 },
      { x: 20.3, z: 6.1 },
      { x: 27.9, z: 28.4 },
    ];
    for (const p of points) {
      expect(ground.isWalkableAt(p)).toBe(twin.isWalkableAt(p.x, p.z));
      expect(ground.nearestWalkable(p)).toEqual(twin.nearestWalkable(p.x, p.z));
      expect(ground.nearestWalkable(p, 2)).toEqual(twin.nearestWalkable(p.x, p.z, 2));
      for (const q of points) {
        expect(ground.lineOfWalk(p, q)).toBe(twin.lineOfWalk(p, q));
        expect(ground.findPath(p, q)).toEqual(findPath(twin, p, q));
      }
    }
    expect(ground.heightAt({ x: 5, z: 5 })).toBe(0);
  });

  it('blocks and restores the grid it stands on', () => {
    const nav = new NavGrid(20, [], 0);
    const ground = new PlaneGround(nav);
    const before = ground.snapshotBlockers();
    ground.blockCircle({ x: 8, z: 8 }, 1.5);
    expect(nav.isWalkableAt(8, 8)).toBe(false);
    ground.unblockCircle({ x: 8, z: 8 }, 1.5);
    expect(nav.isWalkableAt(8, 8)).toBe(true);
    ground.blockCircle({ x: 3, z: 3 }, 1);
    ground.restoreBlockers(before);
    expect(nav.isWalkableAt(3, 3)).toBe(true);
  });

  it('reads the terrain grid its heights', () => {
    const heights = new Int16Array(16).fill(1500);
    heights[5] = -32768;
    const nav = new TerrainNavGrid({
      cells: 4,
      cellSize: 0.5,
      origin: { x: 0, z: 0 },
      heightScale: 0.001,
      heights,
      blockedValue: -32768,
    });
    const ground = new PlaneGround(nav);
    for (const p of [
      { x: 0.2, z: 0.2 },
      { x: 0.7, z: 0.7 },
      { x: 1.9, z: 1.1 },
    ]) {
      expect(ground.heightAt(p)).toBe(nav.heightAt(p.x, p.z));
    }
    expect(ground.heightAt({ x: 0.2, z: 0.2 })).toBeCloseTo(1.5, 12);
  });
});

// A planet grid that walks nothing itself: it records what it was asked.
function fakeSphereNav(): SphereNav & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    radius: 80,
    n: 4,
    cellCount: 96,
    cellOf: () => 0,
    cellCenter: () => ({ x: 80, y: 0, z: 0 }),
    isWalkableCell: () => true,
    isWalkableAt: (p) => {
      calls.push(`walkable ${p.y}`);
      return p.y > 0;
    },
    neighbors: () => 0,
    nearestWalkable: (p, cells) => {
      calls.push(`nearest ${cells}`);
      return { x: p.x, y: Math.abs(p.y), z: p.z };
    },
    lineOfWalk: () => {
      calls.push('line');
      return true;
    },
    heightAt: () => 0.25,
    blockCircle: (_p, r) => calls.push(`block ${r}`),
    unblockCircle: (_p, r) => calls.push(`unblock ${r}`),
    snapshotBlockers: () => new Uint8Array([7]),
    restoreBlockers: (b) => calls.push(`restore ${b[0]}`),
  };
}

describe('the sphere ground', () => {
  const up: SpherePoint = { x: 0, y: 80, z: 0 };
  const down: SpherePoint = { x: 0, y: -80, z: 0 };

  it('hands sphere points to the planet and its A*', () => {
    const grid = fakeSphereNav();
    const ground = new SphereGround(grid, (g, from, to) => {
      expect(g).toBe(grid);
      return [from, to];
    });
    expect(ground.isWalkableAt(up)).toBe(true);
    expect(ground.isWalkableAt(down)).toBe(false);
    expect(ground.nearestWalkable(down, 3)).toEqual(up);
    expect(ground.lineOfWalk(up, down)).toBe(true);
    expect(ground.findPath(down, up)).toEqual([down, up]);
    expect(ground.heightAt(up)).toBe(0.25);
    ground.blockCircle(up, 2);
    ground.unblockCircle(up, 2);
    expect(ground.snapshotBlockers()).toEqual(new Uint8Array([7]));
    ground.restoreBlockers(new Uint8Array([9]));
    expect(grid.calls).toEqual([
      'walkable 80',
      'walkable -80',
      'nearest 3',
      'line',
      'block 2',
      'unblock 2',
      'restore 9',
    ]);
  });

  it('turns away a point without y, never reaching the grid', () => {
    const grid = fakeSphereNav();
    const ground = new SphereGround(grid, () => {
      throw new Error('no path search for a plane point');
    });
    const flat = { x: 3, z: 4 };
    expect(ground.isWalkableAt(flat)).toBe(false);
    expect(ground.nearestWalkable(flat)).toBeNull();
    expect(ground.lineOfWalk(flat, up)).toBe(false);
    expect(ground.findPath(up, flat)).toEqual([]);
    expect(ground.heightAt(flat)).toBe(0);
    ground.blockCircle(flat, 1);
    expect(grid.calls).toEqual([]);
  });
});

describe('the open sphere', () => {
  it('is walkable everywhere on the sphere, a path straight to the goal', () => {
    const ground = new OpenSphereGround(80);
    const a = { x: 80, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 80 };
    expect(ground.isWalkableAt(a)).toBe(true);
    expect(ground.isWalkableAt({ x: 1, z: 1 })).toBe(false);
    expect(ground.lineOfWalk(a, b)).toBe(true);
    expect(ground.findPath(a, b)).toEqual([b]);
    // A goal a hair off the sphere is put back on it.
    const [g] = ground.findPath(a, { x: 0, y: 0, z: 80.5 });
    expect(g).toEqual({ x: 0, y: 0, z: 80 });
    expect(ground.nearestWalkable(a)).toEqual(a);
    expect(ground.snapshotBlockers()).toEqual(new Uint8Array(0));
  });
});
