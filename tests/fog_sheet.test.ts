// The fog sheet (src/render/fog_sheet.ts): the fog of war's ground mesh
// follows the terrain, so a ring's disc three meters up sits under the
// sheet like the ground does (the forest round, ADR 0023). Pure geometry:
// every vertex lifted the same height over the ground under it, the
// texture mapped the way the fog canvas is painted.

import { describe, expect, it } from 'vitest';
import { FOG_LIFT, fogSheetData } from '../src/render/fog_sheet';

describe('the fog sheet', () => {
  it('drapes every vertex FOG_LIFT over the ground under it', () => {
    const disc = (x: number, z: number): number => (Math.hypot(x - 20, z - 20) < 6 ? 3.3 : 0.1);
    const { positions, uvs, indices } = fogSheetData(40, disc, 20, FOG_LIFT, 0);
    expect(positions.length).toBe(21 * 21 * 3);
    expect(indices.length).toBe(20 * 20 * 6);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!;
      const z = positions[i + 2]!;
      expect(positions[i + 1]).toBeCloseTo(disc(x, z) + FOG_LIFT, 6);
    }
    // The disc's center rides three meters higher than the ground around it.
    const at = (x: number, z: number): number => positions[((z / 2) * 21 + x / 2) * 3 + 1]!;
    expect(at(20, 20) - at(0, 0)).toBeCloseTo(3.2, 6);
    // The texture's u runs along x, its v against z (canvas row zero at z 0).
    expect(uvs[0]).toBe(0);
    expect(uvs[1]).toBe(1);
    expect(uvs[(21 * 21 - 1) * 2]).toBe(1);
    expect(uvs[(21 * 21 - 1) * 2 + 1]).toBe(0);
    for (const i of indices) expect(i).toBeLessThan(21 * 21);
  });

  it('reaches past the map square by its margin, the texture clamped there', () => {
    const { positions, uvs } = fogSheetData(40, () => 0, 4, FOG_LIFT, 10);
    // Corners at -10 and 50; the texture past the square reads its edge.
    expect(positions[0]).toBe(-10);
    expect(positions[2]).toBe(-10);
    expect(positions[(5 * 5 - 1) * 3]).toBe(50);
    expect(positions[(5 * 5 - 1) * 3 + 2]).toBe(50);
    expect(uvs[0]).toBeLessThan(0);
    expect(uvs[(5 * 5 - 1) * 2]).toBeGreaterThan(1);
    // The square's own corner still maps to the canvas's corner.
    const inner = 1 * 5 + 1;
    expect(positions[inner * 3]).toBeCloseTo(5, 6);
    expect(uvs[inner * 2]).toBeCloseTo(5 / 40, 6);
  });
});
