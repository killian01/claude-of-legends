// The Pyrefang's opening and its fire column (src/render/pyrefang_rise.ts):
// the clip order after a rise, the beat cross-fades the Codex keyed, and the
// geometry ported from scripts/pyrefang_codex_rise_column.py.

import { describe, expect, it } from 'vitest';
import {
  beatWeights,
  COLUMN_BEATS,
  CROWN_BEATS,
  EMERGE_S,
  FIRE_END_S,
  fireAt,
  openingAt,
  ROAR_S,
  ribbonVertices,
  riseFade,
  riseRibbons,
  riseSparks,
  sparkAt,
} from '../src/render/pyrefang_rise';

describe('the opening', () => {
  it('plays the Emerge, then the Roar, then hands over to the idle', () => {
    expect(openingAt(0)).toEqual({ clip: 'Emerge', time: 0 });
    expect(openingAt(2.9)).toEqual({ clip: 'Emerge', time: 2.9 });
    expect(openingAt(EMERGE_S + 0.5)?.clip).toBe('Roar');
    expect(openingAt(EMERGE_S + 0.5)?.time).toBeCloseTo(0.5);
    expect(openingAt(EMERGE_S + ROAR_S)).toBeNull();
  });

  it('never plays for a creature first seen long after it rose, or with no rise', () => {
    expect(openingAt(60)).toBeNull();
    expect(openingAt(-1)).toBeNull();
    expect(openingAt(Number.NaN)).toBeNull();
  });
});

describe('the beats', () => {
  it('cross-fade two poses at a time, their weights summing to one', () => {
    for (let t = -0.1; t < 2; t += 0.013) {
      const w = beatWeights(t, COLUMN_BEATS, 6);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(w.filter((x) => x > 1e-9).length).toBeLessThanOrEqual(2);
    }
  });

  it('land on each beat exactly', () => {
    expect(beatWeights(0.55, COLUMN_BEATS, 6)[3]).toBeCloseTo(1);
    expect(beatWeights(0.95, COLUMN_BEATS, 6)[4]).toBeCloseTo(1);
    expect(beatWeights(0.2, CROWN_BEATS, 3)[2]).toBeCloseTo(1);
    expect(beatWeights(5, COLUMN_BEATS, 6)[0]).toBe(1);
  });

  it('stand the full column at 0.55 s and put the fire out by the end', () => {
    expect(fireAt(0)).toBe(0);
    expect(fireAt(0.6)).toBeCloseTo(1);
    expect(fireAt(1.8)).toBe(0);
    expect(riseFade.column(FIRE_END_S)).toBe(0);
    expect(riseFade.crown(FIRE_END_S)).toBe(0);
    expect(riseFade.column(0.5)).toBe(1);
  });
});

describe('the geometry', () => {
  const ribbons = riseRibbons();

  it('has the Codex scene tongues: 20 crown, 16 column, 6 core', () => {
    expect(ribbons.filter((r) => r.kind === 'crown')).toHaveLength(20);
    expect(ribbons.filter((r) => r.kind === 'column')).toHaveLength(16);
    expect(ribbons.filter((r) => r.kind === 'core')).toHaveLength(6);
    for (const r of ribbons) {
      expect(r.poses).toHaveLength(r.kind === 'crown' ? 3 : 6);
      const n = r.poses[0]!.length;
      for (const pose of r.poses) expect(pose).toHaveLength(n);
    }
  });

  it('is the same every rise', () => {
    expect(riseRibbons()).toEqual(ribbons);
    expect(riseSparks()).toEqual(riseSparks());
  });

  it('stands the full column about a metre tall, within the pit', () => {
    const column = ribbons.filter((r) => r.kind === 'column');
    const top = Math.max(...column.map((r) => Math.max(...r.poses[3]!.map((p) => p[2]))));
    expect(top).toBeGreaterThan(1);
    expect(top).toBeLessThan(1.3);
    for (const r of column) {
      const [x, y, z] = r.poses[1]![0]!;
      expect(z).toBe(0);
      expect(Math.hypot(x, y)).toBeCloseTo(0.3, 5);
    }
  });

  it('spreads a strip two vertices a point, as wide as the tongue', () => {
    const pose = ribbons[25]!.poses[3]!;
    const v = ribbonVertices(pose);
    expect(v).toHaveLength(pose.length * 6);
    for (let i = 0; i < pose.length; i++) {
      const w = Math.hypot(
        v[i * 6]! - v[i * 6 + 3]!,
        v[i * 6 + 1]! - v[i * 6 + 4]!,
        v[i * 6 + 2]! - v[i * 6 + 5]!,
      );
      expect(w).toBeCloseTo(2 * pose[i]![3], 6);
    }
  });

  it('throws sparks that live, fly out and never sink under the floor', () => {
    for (const s of riseSparks()) {
      expect(sparkAt(s, s.born - 0.01).size).toBe(0);
      expect(sparkAt(s, s.born + s.life / 2).size).toBeGreaterThan(0);
      expect(sparkAt(s, s.born + s.life + 0.01).size).toBe(0);
      for (let t = 0; t < 3; t += 0.1) expect(sparkAt(s, t).z).toBeGreaterThan(0);
    }
  });
});
