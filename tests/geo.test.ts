// Ground geometry (src/sim/geo.ts, ADR 0029): the plane's formulas are the
// arithmetic the sim wrote inline, and the sphere's keep a point on the
// sphere, a distance exact and a heading on its great circle.

import { describe, expect, it } from 'vitest';
import { hypot } from '../src/sim/exact';
import {
  addScaled,
  advance,
  along,
  away,
  basis,
  cross,
  delta,
  dirTo,
  dist,
  dot,
  heading,
  lerp,
  norm,
  offset,
  point,
  rotate,
  segmentDist,
  shift,
  stepToward,
  sub,
  tangent,
  turnLeft,
  unit,
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

describe('the functions added for the sim systems', () => {
  it('keeps the plane forms the systems wrote inline', () => {
    const v = { x: 3.3, z: -4.1 };
    const len = hypot(v.x, v.z);
    expect(unit(v)).toEqual({ x: v.x / len, z: v.z / len });
    expect(unit({ x: 0, z: 0 })).toBeNull();
    const p = { x: 12.3456, z: -7.891 };
    const dir = { x: 0.6, z: 0.8 };
    // An aftershock's eruption point: p + dir * length * t, left to right.
    expect(along(p, dir, 13.7, 0.3)).toEqual({
      x: p.x + dir.x * 13.7 * 0.3,
      z: p.z + dir.z * 13.7 * 0.3,
    });
    expect(point(1, 2)).toEqual({ x: 1, z: 2 });
    expect(point(1, 2, 3)).toEqual({ x: 1, y: 3, z: 2 });
  });

  it('measures along a great circle on the sphere', () => {
    const p = sph(0.3, 0.5, 0.8);
    const q = sph(0.35, 0.45, 0.82);
    const dir = dirTo(p, q)!;
    const u = unit({ x: dir.x * 5, y: (dir.y ?? 0) * 5, z: dir.z * 5 })!;
    expect(Math.sqrt(u.x * u.x + (u.y ?? 0) ** 2 + u.z * u.z)).toBeCloseTo(1, 12);
    expect(dot(u, dir)).toBeCloseTo(1, 12);
    const a = along(p, dir, 10, 0.25);
    expect(dist(p, a)).toBeCloseTo(2.5, 9);
    expect(onR(a)).toBeCloseTo(R, 9);
  });
});

describe('the placement helpers', () => {
  it('round on the plane exactly as the inline arithmetic did', () => {
    const a = { x: 12.3456, z: -7.891 };
    const b = { x: -3.21, z: 44.4 };
    const v = { x: b.x - a.x, z: b.z - a.z };
    const d = hypot(v.x, v.z);
    expect(unit(v)).toEqual({ x: v.x / d, z: v.z / d });
    expect(unit({ x: 0, z: 0 })).toBeNull();
    expect(away(a, b)).toEqual({ x: a.x - b.x, z: a.z - b.z });
    expect(tangent(a, 0.3, -1.7)).toEqual({ x: 0.3, z: -1.7 });
    const side = 1.32 * 2.4;
    expect(shift(a, tangent(a, side * 2, 0.7 * 2))).toEqual({
      x: a.x + side * 2,
      z: a.z + 0.7 * 2,
    });
  });

  it('keep a point on the sphere and a push tangent where it starts', () => {
    const p = sph(0.3, 0.5, 0.8);
    const q = sph(0.36, 0.44, 0.81);
    const out = away(p, q);
    expect(Math.abs(dot(out, p))).toBeLessThan(1e-9);
    expect(norm(out)).toBeCloseTo(dist(p, q), 9);
    // Away from q at p is the reverse of the way toward q.
    expect(dot(unit(out)!, dirTo(p, q)!)).toBeCloseTo(-1, 12);
    const t = tangent(p, 3, 4);
    expect(Math.abs(dot(t, p))).toBeLessThan(1e-9);
    expect(norm(t)).toBeCloseTo(5, 12);
    expect(dot(t, basis(p).east)).toBeCloseTo(3, 12);
    const moved = shift(p, t);
    expect(onR(moved)).toBeCloseTo(R, 9);
    expect(dist(p, moved)).toBeCloseTo(5, 9);
    expect(shift(p, tangent(p, 0, 0))).toEqual(p);
  });
});

describe('the raw vector sums', () => {
  it('subtract and blend on every axis, the plane keeping to two', () => {
    expect(sub({ x: 3, y: 5, z: 7 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 2, y: 3, z: 4 });
    expect(sub({ x: 3, z: 7 }, { x: 1, z: 3 })).toEqual({ x: 2, z: 4 });
    expect(addScaled({ x: 1, y: 0, z: 0 }, { x: 0, y: 2, z: 4 }, 1.5)).toEqual({
      x: 1,
      y: 3,
      z: 6,
    });
    expect(addScaled({ x: 1, z: 0 }, { x: 0, z: 4 }, 0.5)).toEqual({ x: 1, z: 2 });
  });
});
