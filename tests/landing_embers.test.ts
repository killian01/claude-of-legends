// The embers over the landing (ui/landing_embers.ts): where each one
// starts and how it travels is decided here, without a browser, and
// decided the same way on every load.

import { describe, expect, it } from 'vitest';
import { emberSpecs } from '../src/ui/landing_embers';

describe('the landing embers', () => {
  it('are laid out the same way every time', () => {
    expect(emberSpecs(28)).toEqual(emberSpecs(28));
    expect(emberSpecs(28)).toHaveLength(28);
    expect(emberSpecs(0)).toEqual([]);
  });

  it('stay on the page and within what a mote can be', () => {
    for (const e of emberSpecs(40)) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThan(100);
      expect(e.size).toBeGreaterThanOrEqual(2);
      expect(e.size).toBeLessThanOrEqual(6);
      expect(e.delay).toBeGreaterThanOrEqual(0);
      expect(e.delay).toBeLessThan(18);
      expect(e.duration).toBeGreaterThanOrEqual(14);
      expect(e.duration).toBeLessThanOrEqual(26);
      expect(Math.abs(e.drift)).toBeLessThanOrEqual(80);
      expect(e.opacity).toBeGreaterThan(0);
      expect(e.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('scatter rather than queue: no two share a column, and every fifth of the width has some', () => {
    const specs = emberSpecs(28);
    const xs = specs.map((e) => e.x);
    expect(new Set(xs).size).toBe(xs.length);
    for (let fifth = 0; fifth < 5; fifth++) {
      expect(xs.some((x) => x >= fifth * 20 && x < (fifth + 1) * 20)).toBe(true);
    }
    // Nor do they all rise at once: the first pass is staggered over the
    // whole delay range, so the layer is never empty and never a wall.
    const delays = specs.map((e) => e.delay);
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(10);
  });
});
