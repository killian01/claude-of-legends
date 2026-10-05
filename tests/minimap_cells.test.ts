// One cell of the planet's minimap ground (src/render/minimap_cells.ts): the
// color worked out in numbers matches what the minimap's layered canvas
// fills made of it (each translucent fill laid source over, the canvas
// rounding to a byte after each), within a step of rounding, for every
// layer: the region, the water, the relief, the night, the light's edge
// and the next cap's line.

import { describe, expect, it } from 'vitest';
import { type CellDusk, paintCell, type Rgb, WATER_RGB } from '../src/render/minimap_cells';

// The canvas way: an opaque fill, then each translucent fill over it.
function filled(layers: readonly { c: Rgb; a: number }[]): Rgb {
  let px = [0, 0, 0];
  for (const { c, a } of layers) {
    px = px.map((v, k) => Math.round(c[k]! * a + v * (1 - a)));
  }
  return [px[0]!, px[1]!, px[2]!];
}

// The fills the minimap used to issue for a cell, the same rules in the
// order it laid them.
function fillsOf(base: Rgb, h: number, dusk: CellDusk, span: number): { c: Rgb; a: number }[] {
  const out = [{ c: h < -0.4 ? WATER_RGB : base, a: 1 }];
  const shade = Math.max(-0.25, Math.min(0.25, h * 0.12));
  out.push(shade > 0 ? { c: [255, 255, 255], a: shade } : { c: [0, 0, 0], a: -shade });
  if (dusk.past !== null) {
    if (dusk.past > 0) out.push({ c: [8, 14, 46], a: Math.min(0.72, 0.35 + dusk.past * 0.08) });
    if (Math.abs(dusk.past) < span * 0.6) out.push({ c: [255, 140, 60], a: 0.85 });
  }
  if (dusk.next !== null && dusk.next < span * 0.5) out.push({ c: [255, 214, 90], a: 0.9 });
  return out;
}

function painted(base: Rgb, h: number, dusk: CellDusk, span = 110 / 56): number[] {
  const out = new Uint8ClampedArray(8);
  paintCell(out, 4, base, h, dusk, span);
  return [...out.slice(4)];
}

const MEADOW: Rgb = [92, 132, 82];
const SPAN = 110 / 56;
const NO_DUSK: CellDusk = { past: null, next: null };

describe('a minimap cell', () => {
  const cases: [string, number, CellDusk][] = [
    ['flat ground', 0, NO_DUSK],
    ['a hill', 1.6, NO_DUSK],
    ['a hollow', -0.3, NO_DUSK],
    ['under the water line', -1.2, NO_DUSK],
    ['deep in the night', 0.4, { past: 30, next: null }],
    ['on the light edge', 0.4, { past: 0.5, next: null }],
    ['just inside the light', 0.4, { past: -4, next: null }],
    ['on the next cap line', 0.4, { past: -12, next: 0.3 }],
    ['on both lines', -0.2, { past: 0.2, next: 0.1 }],
  ];
  for (const [name, h, dusk] of cases) {
    it(`matches the layered fills for ${name}`, () => {
      const want = filled(fillsOf(MEADOW, h, dusk, SPAN));
      const got = painted(MEADOW, h, dusk);
      for (let k = 0; k < 3; k++) expect(Math.abs(got[k]! - want[k]!)).toBeLessThanOrEqual(2);
      expect(got[3]).toBe(255);
    });
  }

  it('reads the relief: lighter up high, darker down low', () => {
    const flat = painted(MEADOW, 0, NO_DUSK);
    expect(flat.slice(0, 3)).toEqual([...MEADOW]);
    const high = painted(MEADOW, 2, NO_DUSK);
    const low = painted(MEADOW, -0.3, NO_DUSK);
    for (let k = 0; k < 3; k++) {
      expect(high[k]!).toBeGreaterThan(flat[k]!);
      expect(low[k]!).toBeLessThan(flat[k]!);
    }
  });

  it('shows the water whatever the region', () => {
    const a = painted(MEADOW, -1, NO_DUSK);
    const b = painted([214, 206, 170], -1, NO_DUSK);
    expect(a).toEqual(b);
  });

  it('writes only its own four bytes', () => {
    const out = new Uint8ClampedArray(12);
    paintCell(out, 4, MEADOW, 0, NO_DUSK, SPAN);
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...out.slice(8)]).toEqual([0, 0, 0, 0]);
  });
});
