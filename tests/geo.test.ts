// Ground geometry (src/sim/geo.ts, ADR 0029): the plane's formulas are the
// arithmetic the sim wrote inline, and the sphere's keep a point on the
// sphere, a distance exact and a heading on its great circle.

import { describe, expect, it } from 'vitest';
import { hypot } from '../src/sim/exact';
import {
  advance,
  basis,
  cross,
  delta,
  dirTo,
  dist,
  dot,
  heading,
  lerp,
  offset,
  rotate,
  segmentDist,
  stepToward,
  turnLeft,
} from '../src/sim/geo';
import type { Vec2 } from '../src/sim/types';

const R = 80;
const onR = (p: Vec2) => Math.sqrt(p.x * p.x + (p.y ?? 0) ** 2 + p.z * p.z);
function sph(x: number, y: number, z: number): Vec2 {
  const d = Math.sqrt(x * x + y * y + z * z);
  return { x: (x / d) * R, y: (y / d) * R, z: (z / d) * R };
}

describe('the plane', () => {
  it('rounds exactly as the inline arithmetic did', () => {
    const a = { x: 12.3456, z: -7.891 };
    const b = { x: -3.21, z: 44.4 };
    expect(dist(a, b)).toBe(hypot(a.x - b.x, a.z - b.z));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = hypot(dx, dz);
    expect(dirTo(a, b)).toEqual({ x: dx / d, z: dz / d });
    expect(offset(a, { x: 0.6, z: 0.8 }, 3)).toEqual({ x: a.x + 0.6 * 3, z: a.z + 0.8 * 3 });
    const p = { ...a };
    stepToward(p, b, 2.5);
    expect(p).toEqual({ x: a.x + (dx / d) * 2.5, z: a.z + (dz / d) * 2.5 });
    expect(turnLeft({ x: 1, z: 0 }, a)).toEqual({ x: -0, z: 1 });
    expect(cross({ x: 1, z: 0 }, { x: 0, z: 1 }, a)).toBe(1);
    expect(basis(a).north).toEqual({ x: 0, z: 1 });
    expect(heading(a, 0)).toEqual({ x: 1, z: 0 });
    expect(delta(a, b)).toEqual({ x: dx, z: dz });
    expect(lerp(a, b, 0.25)).toEqual({ x: a.x + (b.x - a.x) * 0.25, z: a.z + (b.z - a.z) * 0.25 });
    const r = rotate({ x: 1, z: 0 }, Math.PI / 2, a);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.z).toBeCloseTo(1, 12);
  });
});

describe('the sphere', () => {
  const p = sph(0.3, 0.5, 0.8);
  const q = sph(0.35, 0.45, 0.82);

  it('measures chords and offsets by exactly that much, staying on the sphere', () => {
    const dir = dirTo(p, q)!;
    expect(Math.abs(dot(dir, p))).toBeLessThan(1e-9);
    const o = offset(p, dir, dist(p, q));
    expect(onR(o)).toBeCloseTo(R, 9);
    expect(dist(o, q)).toBeLessThan(1e-6);
    for (const s of [0.1, 3, 25, 120]) {
      const t = offset(p, dir, s);
      expect(dist(p, t)).toBeCloseTo(s, 9);
      expect(onR(t)).toBeCloseTo(R, 9);
    }
  });

  it('advances along a great circle all the way round', () => {
    const pos = { ...p };
    const dir = { ...dirTo(p, q)! };
    // 500 m of 0.185 m steps: the circumference is 2 pi R, about 502.65 m.
    const steps = Math.round((2 * Math.PI * R) / 0.185);
    let chord = 0;
    for (let i = 0; i < steps; i++) {
      advance(pos, dir, 0.185);
      chord += 0.185;
    }
    expect(onR(pos)).toBeCloseTo(R, 6);
    // Chord steps of 0.185 m cover a hair more arc than their length; back
    // within a step or so of the start.
    expect(dist(pos, p)).toBeLessThan(0.5);
    expect(chord).toBeGreaterThan(500);
  });

  it('steps toward a target and arrives exactly', () => {
    const pos = { ...p };
    let arrived = false;
    for (let i = 0; i < 1000 && !arrived; i++) arrived = stepToward(pos, q, 0.3);
    expect(arrived).toBe(true);
    expect(pos).toEqual(q);
  });

  it('turns left the way the plane does, about the outward normal', () => {
    const top = { x: 0, y: R, z: 0 };
    const east = { x: 1, y: 0, z: 0 };
    // At the north pole the outward normal is +y, the plane's up.
    expect(turnLeft(east, top)).toEqual({ x: 0, y: 0, z: 1 });
    const b = basis(p);
    expect(dot(b.east, p)).toBeCloseTo(0, 9);
    expect(dot(b.north, p)).toBeCloseTo(0, 9);
    expect(dot(b.east, b.north)).toBeCloseTo(0, 12);
    expect(cross(b.east, b.north, p)).toBeCloseTo(1, 12);
    const h = heading(p, Math.PI / 2);
    expect(dot(h, b.north)).toBeCloseTo(1, 12);
    const r = rotate(b.east, Math.PI / 2, p);
    expect(dot(r, b.north)).toBeCloseTo(1, 12);
  });

  it('measures a point against an arc', () => {
    const a = sph(1, 0, 0);
    const b = offset(a, { x: 0, y: 0, z: 1 }, 20);
    const mid = lerp(a, b, 0.5);
    const side = offset(mid, { x: 0, y: 1, z: 0 }, 1.5);
    const s = segmentDist(side, a, b);
    expect(s.d).toBeCloseTo(1.5, 2);
    expect(s.t).toBeGreaterThan(0.4);
    expect(s.t).toBeLessThan(0.6);
    const beyond = offset(
      b,
      dirTo(a, b)
        ? { ...dirTo(b, a)!, x: -dirTo(b, a)!.x, y: -(dirTo(b, a)!.y ?? 0), z: -dirTo(b, a)!.z }
        : { x: 0, y: 0, z: 1 },
      4,
    );
    expect(segmentDist(beyond, a, b).t).toBe(1);
  });
});
