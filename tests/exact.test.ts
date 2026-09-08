// The sim's exact arithmetic (src/sim/exact.ts, ADR 0019): the length is
// the formula every engine rounds alike, and the fixed-polynomial cosine
// and sine agree with the engine's own to the last bits across every
// quadrant and past a full turn either way.

import { describe, expect, it } from 'vitest';
import { cos, hypot, sin } from '../src/sim/exact';
import { Rng } from '../src/sim/rng';

describe('exact arithmetic', () => {
  it('measures a length with the exact formula', () => {
    expect(hypot(3, 4)).toBe(5);
    expect(hypot(0, 0)).toBe(0);
    expect(hypot(-1.5, 2)).toBe(2.5);
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const x = rng.range(-60, 60);
      const z = rng.range(-60, 60);
      expect(hypot(x, z)).toBe(Math.sqrt(x * x + z * z));
    }
  });

  it('lands the cosine and sine of the compass angles', () => {
    expect(cos(0)).toBe(1);
    expect(sin(0)).toBe(0);
    expect(cos(Math.PI / 3)).toBeCloseTo(0.5, 15);
    expect(sin(Math.PI / 6)).toBeCloseTo(0.5, 15);
    expect(cos(Math.PI)).toBeCloseTo(-1, 15);
    expect(sin(-Math.PI / 2)).toBeCloseTo(-1, 15);
  });

  it('agrees with the engine across every quadrant and beyond a turn', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 2000; i++) {
      const x = rng.range(-4 * Math.PI, 4 * Math.PI);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-15);
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-15);
    }
  });
});
