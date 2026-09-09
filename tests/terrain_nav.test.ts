// The terrain walkability grid (src/sim/terrain_nav.ts): an exported grid
// decoded into sim orientation, exact cell traversal, and heights that
// follow the ground. Small hand-built grids, no export file.

import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/pathfind';
import { decodeTerrainNav, TerrainNavGrid, type TerrainNavSpec } from '../src/sim/terrain_nav';

const CELLS = 8;
const spec: TerrainNavSpec = {
  version: 1,
  cells: CELLS,
  cellSize: 0.4,
  origin: { x: -4, z: -156 },
  heightScale: 0.001,
  blockedValue: -32768,
};

// A grid in the MODEL's frame: `blocked` indexes rows along the model's z,
// the way the export writes them.
function grid(
  blocked: readonly number[] = [],
  heights?: (index: number) => number,
): TerrainNavGrid {
  const raw = new Int16Array(CELLS * CELLS);
  for (let i = 0; i < raw.length; i++) raw[i] = heights ? heights(i) : 1900;
  for (const i of blocked) raw[i] = spec.blockedValue;
  return new TerrainNavGrid(decodeTerrainNav(spec, raw.buffer));
}

// The sim point at the center of a model cell (column, model row).
function at(column: number, modelRow: number): { x: number; z: number } {
  return { x: -4 + (column + 0.5) * 0.4, z: 156 - (modelRow + 0.5) * 0.4 };
}

describe('terrain navigation grid', () => {
  it('flips the model rows into sim z and keeps the heights with them', () => {
    const nav = grid([], (i) => (i === 3 * CELLS + 5 ? 3820 : 1900));
    expect(nav.origin).toEqual({ x: -4, z: 156 - CELLS * 0.4 });
    expect(nav.isWalkableAt(at(0, 0).x, at(0, 0).z)).toBe(true);
    expect(nav.heightAt(at(5, 3).x, at(5, 3).z)).toBeCloseTo(3.82);
    expect(nav.heightAt(at(0, 0).x, at(0, 0).z)).toBeCloseTo(1.9);
    // Off the grid on the near side.
    expect(nav.isWalkableAt(-4.01, 155)).toBe(false);
  });

  it('rejects a buffer or a spec that cannot be a grid', () => {
    expect(() => decodeTerrainNav(spec, new ArrayBuffer(4))).toThrow();
    expect(() => decodeTerrainNav({ ...spec, version: 2 }, new ArrayBuffer(128))).toThrow();
    expect(() => decodeTerrainNav({ ...spec, cellSize: 0 }, new ArrayBuffer(128))).toThrow();
  });

  it('keeps blocked cells unwalkable and off the straight line', () => {
    const nav = grid([2 * CELLS + 2, 2 * CELLS + 3, 2 * CELLS + 4]);
    expect(nav.isWalkableAt(at(2, 2).x, at(2, 2).z)).toBe(false);
    expect(nav.lineOfWalk(at(0, 2), at(7, 2))).toBe(false);
    expect(nav.lineOfWalk(at(0, 1), at(7, 1))).toBe(true);
  });

  it('never squeezes diagonally between two blocked corners', () => {
    const nav = grid([1, CELLS]);
    expect(nav.lineOfWalk(at(0, 0), at(1, 1))).toBe(false);
    expect(nav.lineOfWalk(at(1, 1), at(0, 0))).toBe(false);
  });

  it('checks every crossed cell, even a hairline clip past a corner', () => {
    const nav = grid([2 * CELLS + 3]);
    const start = { x: -4 + 1.5 * 0.4, z: 156 - 1.5 * 0.4 };
    const goal = { x: -4 + 5.5 * 0.4, z: 156 - 5.48 * 0.4 };
    expect(nav.lineOfWalk(start, goal)).toBe(false);
    expect(nav.lineOfWalk(goal, start)).toBe(false);
  });

  it('routes around a wall through the sim pathfinder', () => {
    const nav = grid([3, 11, 19, 27, 35, 43]);
    const start = at(1, 1);
    const goal = at(6, 1);
    const route = findPath(nav, start, goal);
    expect(route.length).toBeGreaterThan(1);
    expect(route[route.length - 1]).toEqual(goal);
    let previous = start;
    for (const point of route) {
      expect(nav.lineOfWalk(previous, point)).toBe(true);
      previous = point;
    }
  });

  it('finds no route across a wall that cuts the grid in two', () => {
    const nav = grid([3, 11, 19, 27, 35, 43, 51, 59]);
    expect(findPath(nav, at(1, 1), at(6, 1))).toEqual([]);
  });

  it('blocks and unblocks footprints in meters, on top of the baked cells', () => {
    const nav = grid([2 * CELLS + 2]);
    const baseline = nav.snapshotBlockers();
    const p = at(5, 5);
    nav.blockCircle(p.x, p.z, 0.5);
    expect(nav.isWalkableAt(p.x, p.z)).toBe(false);
    nav.unblockCircle(p.x, p.z, 0.5);
    expect(nav.snapshotBlockers()).toEqual(baseline);
    expect(nav.isWalkableAt(at(2, 2).x, at(2, 2).z)).toBe(false);
  });

  it('reads the ground under a blocked point from the nearest open cell', () => {
    const nav = grid([2 * CELLS + 2], (i) => (i === 2 * CELLS + 3 ? 3000 : 1000));
    const p = at(2, 2);
    expect(nav.heightAt(p.x, p.z)).toBeGreaterThan(0);
    expect(nav.nearestWalkable(p.x, p.z)).not.toBeNull();
  });

  it('rejects nonfinite points without searching', () => {
    const nav = grid();
    expect(nav.lineOfWalk({ x: Number.NaN, z: 0 }, at(1, 1))).toBe(false);
    expect(nav.isWalkableAt(Number.POSITIVE_INFINITY, 0)).toBe(false);
  });
});
