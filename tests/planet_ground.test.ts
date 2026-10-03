// The Wanderseed's ground as the renderer reads it
// (src/render/planet_ground.ts): the cube-sphere cells of the shipped grid
// (the generator's face table), heights read smoothly between cell
// centers with the blocked cells left out, and the layout read tolerantly.

import { describe, expect, it } from 'vitest';
import {
  BLOCKED_HEIGHT,
  cellOf,
  faceDir,
  faceOf,
  faceUV,
  PlanetHeights,
  parseLayout,
} from '../src/render/planet_ground';

describe('the planet grid', () => {
  it('finds a point its face and cell like the generator', () => {
    expect(faceOf({ x: 80, y: 0, z: 0 })).toBe(0);
    expect(faceOf({ x: -80, y: 1, z: 1 })).toBe(1);
    expect(faceOf({ x: 1, y: 80, z: 1 })).toBe(2);
    expect(faceOf({ x: 1, y: -80, z: 1 })).toBe(3);
    expect(faceOf({ x: 1, y: 1, z: 80 })).toBe(4);
    expect(faceOf({ x: 1, y: 1, z: -80 })).toBe(5);
    // Ties go x, then y, then z.
    expect(faceOf({ x: 50, y: 50, z: 50 })).toBe(0);
    // Face 0: U = -z, V = +y; cell (i, j) at u = (2i + 1) / n - 1.
    const n = 320;
    const d = faceDir(0, (2 * 7 + 1) / n - 1, (2 * 300 + 1) / n - 1);
    expect(cellOf({ x: d.x * 80, y: d.y * 80, z: d.z * 80 }, n)).toBe(300 * n + 7);
    const uv = faceUV(0, { x: 80, y: 40, z: -40 });
    expect(uv.u).toBeCloseTo(0.5, 12);
    expect(uv.v).toBeCloseTo(0.5, 12);
  });

  it('reads heights between cell centers, the blocked cells left out', () => {
    const n = 8;
    const cells = new Int16Array(6 * n * n);
    // Face 2 (+Y): height rises one meter a cell along U.
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells[2 * n * n + j * n + i] = i * 1000;
    const heights = new PlanetHeights(cells, n);
    const at = (u: number, v: number) => {
      const d = faceDir(2, u, v);
      return { x: d.x * 80, y: d.y * 80, z: d.z * 80 };
    };
    // A cell center reads its own height, halfway between two reads half.
    expect(heights.heightAt(at((2 * 3 + 1) / n - 1, 0.01))).toBeCloseTo(3, 3);
    expect(heights.heightAt(at((2 * 3 + 2) / n - 1, 0.01))).toBeCloseTo(3.5, 3);
    // A blocked neighbor does not pull the ground down.
    for (let j = 0; j < n; j++) cells[2 * n * n + j * n + 4] = BLOCKED_HEIGHT;
    expect(heights.blocked(at((2 * 4 + 1) / n - 1, 0.01))).toBe(true);
    expect(heights.heightAt(at((2 * 3 + 2) / n - 1, 0.01))).toBeCloseTo(3, 3);
  });

  it('reads the layout tolerantly, every point on the sphere', () => {
    const layout = parseLayout({
      crossroads: [{ x: 1, y: 1, z: 1 }, 'nonsense'],
      pads: [{ at: { x: 80, y: 0, z: 0 }, to: [0, 80, 0] }, { at: null }],
      caches: [{ at: { x: 0, y: 0, z: 2 }, golden: true }, { at: { x: 0, y: 3, z: 0 } }],
      bushes: [{ at: { x: 0, y: -1, z: 0 }, r: 2.5 }],
      sightBlockers: [{ at: { x: 1, y: 0, z: 0 }, r: 1.2 }],
    });
    expect(layout.crossroads).toHaveLength(1);
    expect(
      Math.hypot(layout.crossroads[0]!.x, layout.crossroads[0]!.y, layout.crossroads[0]!.z),
    ).toBeCloseTo(80, 9);
    expect(layout.pads).toHaveLength(1);
    expect(layout.pads[0]!.to.y).toBeCloseTo(80, 9);
    expect(layout.caches.map((c) => c.golden)).toEqual([true, false]);
    expect(layout.caches[0]!.at.z).toBeCloseTo(80, 9);
    expect(layout.bushes[0]!.r).toBe(2.5);
    expect(layout.blockers).toHaveLength(1);
    expect(parseLayout(null).pads).toEqual([]);
  });
});
