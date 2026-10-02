// Ground geometry (ADR 0029): the flat ground of the Star Orchard and the
// planet's sphere through one set of functions, so a spell, a step or a
// sight line is written once and plays on both. A point on the plane is
// {x, z}, as it always was; a point on the sphere carries y as well and lies
// on the sphere, |p| = R, the sphere's radius read off the point itself.
// Distances on the sphere are chord lengths, which every function here keeps
// consistent: offsetting a point by s puts it exactly s away. Directions are
// unit tangent vectors at the point they belong to; one carried along with a
// moving point is turned with it (advance).
//
// The plane formulas are the arithmetic the sim wrote inline before, in the
// same operation order, so the 5v5 rounds alike (ADR 0019). The sphere's
// use only the four operations and the square root, exact on every engine.

import { cos, hypot, sin } from './exact';
import type { Vec2 } from './types';

// A point or a direction on the sphere: y is present.
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function onSphere(p: Vec2): p is Vec2 & Vec3 {
  return p.y !== undefined;
}

function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

// Distance between two ground points: the plane's length, the sphere's
// chord.
export function dist(a: Vec2, b: Vec2): number {
  if (a.y === undefined || b.y === undefined) return hypot(a.x - b.x, a.z - b.z);
  return len3(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Squared distance, for comparisons against a squared radius.
export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  if (a.y === undefined || b.y === undefined) return dx * dx + dz * dz;
  const dy = a.y - b.y;
  return dx * dx + dy * dy + dz * dz;
}

// Within r of each other, edges included.
export function within(a: Vec2, b: Vec2, r: number): boolean {
  return dist2(a, b) <= r * r;
}

// The vector from a to b. On the plane, b - a. On the sphere, the chord
// turned into a's tangent plane and given the chord's length, so its
// direction is the great circle's heading at a and its length the distance.
export function delta(a: Vec2, b: Vec2): Vec2 {
  if (a.y === undefined || b.y === undefined) return { x: b.x - a.x, z: b.z - a.z };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const chord = len3(dx, dy, dz);
  const r = len3(a.x, a.y, a.z);
  // The component of the chord along a's normal, taken out.
  const k = (dx * a.x + dy * a.y + dz * a.z) / (r * r);
  const tx = dx - k * a.x;
  const ty = dy - k * a.y;
  const tz = dz - k * a.z;
  const t = len3(tx, ty, tz);
  if (t <= 0) return { x: 0, y: 0, z: 0 };
  const s = chord / t;
  return { x: tx * s, y: ty * s, z: tz * s };
}

// The unit direction from a toward b, or null when they coincide.
export function dirTo(a: Vec2, b: Vec2): Vec2 | null {
  if (a.y === undefined || b.y === undefined) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = hypot(dx, dz);
    if (d <= 0) return null;
    return { x: dx / d, z: dz / d };
  }
  const v = delta(a, b);
  const d = len3(v.x, v.y ?? 0, v.z);
  if (d <= 0) return null;
  return { x: v.x / d, y: (v.y ?? 0) / d, z: v.z / d };
}

// Length of a direction or a delta.
export function norm(v: Vec2): number {
  return v.y === undefined ? hypot(v.x, v.z) : len3(v.x, v.y, v.z);
}

export function dot(u: Vec2, v: Vec2): number {
  if (u.y === undefined || v.y === undefined) return u.x * v.x + u.z * v.z;
  return u.x * v.x + u.y * v.y + u.z * v.z;
}

// The plane's 2D cross product u.x * v.z - u.z * v.x, signed the same way
// on the sphere about the outward normal at `at`.
export function cross(u: Vec2, v: Vec2, at: Vec2): number {
  if (at.y === undefined || u.y === undefined || v.y === undefined) return u.x * v.z - u.z * v.x;
  const r = len3(at.x, at.y, at.z);
  // (v x u) . n: the plane's form with n = +y.
  const cx = v.y * u.z - v.z * u.y;
  const cy = v.z * u.x - v.x * u.z;
  const cz = v.x * u.y - v.y * u.x;
  return (cx * at.x + cy * at.y + cz * at.z) / r;
}

// The direction a quarter turn from v, as the plane writes it {-v.z, v.x};
// on the sphere the same turn about the outward normal at `at`.
export function turnLeft(v: Vec2, at: Vec2): Vec2 {
  if (at.y === undefined || v.y === undefined) return { x: -v.z, z: v.x };
  const r = len3(at.x, at.y, at.z);
  const nx = at.x / r;
  const ny = at.y / r;
  const nz = at.z / r;
  // v x n: with n = +y it is {-v.z, 0, v.x}.
  return { x: v.y * nz - v.z * ny, y: v.z * nx - v.x * nz, z: v.x * ny - v.y * nx };
}

// The opposite quarter turn, {v.z, -v.x} on the plane.
export function turnRight(v: Vec2, at: Vec2): Vec2 {
  const l = turnLeft(v, at);
  return l.y === undefined ? { x: -l.x, z: -l.z } : { x: -l.x, y: -l.y, z: -l.z };
}

// v turned by an angle, the plane's {x cos - z sin, x sin + z cos}.
export function rotate(v: Vec2, angle: number, at: Vec2): Vec2 {
  const c = cos(angle);
  const s = sin(angle);
  if (at.y === undefined || v.y === undefined) {
    return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
  }
  const l = turnLeft(v, at);
  return { x: v.x * c + l.x * s, y: v.y * c + (l.y ?? 0) * s, z: v.z * c + l.z * s };
}

// v scaled.
export function scale(v: Vec2, s: number): Vec2 {
  return v.y === undefined ? { x: v.x * s, z: v.z * s } : { x: v.x * s, y: v.y * s, z: v.z * s };
}

// The point s along the unit direction dir from p. On the sphere, along the
// great circle so the new point is exactly s from p (chord) and on the
// sphere: q = p (1 - s^2 / 2R^2) + dir s sqrt(1 - s^2 / 4R^2). A negative s
// goes backwards.
export function offset(p: Vec2, dir: Vec2, s: number): Vec2 {
  if (p.y === undefined || dir.y === undefined) return { x: p.x + dir.x * s, z: p.z + dir.z * s };
  const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
  const a = 1 - (s * s) / (2 * r2);
  const half = (s * s) / (4 * r2);
  const b = s * Math.sqrt(half < 1 ? 1 - half : 0);
  return { x: p.x * a + dir.x * b, y: p.y * a + dir.y * b, z: p.z * a + dir.z * b };
}

// Moves p by s along dir in place and turns dir with it, so a projectile or
// a dash keeps to its great circle (on the plane: p += dir * s, the plane's
// own order of operations, dir untouched).
export function advance(p: Vec2, dir: Vec2, s: number): void {
  if (p.y === undefined || dir.y === undefined) {
    p.x += dir.x * s;
    p.z += dir.z * s;
    return;
  }
  const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
  const r = Math.sqrt(r2);
  const half = (s * s) / (4 * r2);
  const sinHalf = Math.sqrt(half);
  const cosHalf = Math.sqrt(half < 1 ? 1 - half : 0);
  // The turn through angle theta = 2 asin(s / 2R): cos and sin of theta
  // from the half angle, the square root only.
  const c = 1 - 2 * half;
  const sn = 2 * sinHalf * cosHalf * (s < 0 ? -1 : 1);
  const px = p.x;
  const py = p.y;
  const pz = p.z;
  p.x = px * c + dir.x * r * sn;
  p.y = py * c + dir.y * r * sn;
  p.z = pz * c + dir.z * r * sn;
  // The heading turns by the same angle, toward -p.
  const dx = dir.x * c - (px / r) * sn;
  const dy = dir.y * c - (py / r) * sn;
  const dz = dir.z * c - (pz / r) * sn;
  const d = len3(dx, dy, dz);
  dir.x = dx / d;
  dir.y = dy / d;
  dir.z = dz / d;
}

// Steps p toward target by at most step, in place. Returns true when it
// arrived (p is then the target exactly).
export function stepToward(p: Vec2, target: Vec2, step: number): boolean {
  if (p.y === undefined || target.y === undefined) {
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = hypot(dx, dz);
    if (d <= step) {
      p.x = target.x;
      p.z = target.z;
      return true;
    }
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    return false;
  }
  const d = dist(p, target);
  if (d <= step) {
    p.x = target.x;
    p.y = target.y;
    p.z = target.z;
    return true;
  }
  const dir = dirTo(p, target);
  if (!dir) return true;
  const q = offset(p, dir, step);
  p.x = q.x;
  p.y = q.y;
  p.z = q.z;
  return false;
}

// The direction at `to` that dir at `from` becomes once carried there: the
// tangent component kept, renormalized. Identity on the plane.
export function carry(dir: Vec2, from: Vec2, to: Vec2): Vec2 {
  if (to.y === undefined || dir.y === undefined || from.y === undefined) return dir;
  const r = len3(to.x, to.y, to.z);
  const k = (dir.x * to.x + dir.y * to.y + dir.z * to.z) / (r * r);
  const x = dir.x - k * to.x;
  const y = dir.y - k * to.y;
  const z = dir.z - k * to.z;
  const d = len3(x, y, z);
  if (d <= 0) return dir;
  return { x: x / d, y: y / d, z: z / d };
}

// The point a fraction t of the way from a to b: the plane's a + (b - a) t,
// the sphere's along the great circle.
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  if (a.y === undefined || b.y === undefined) {
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  const dir = dirTo(a, b);
  if (!dir) return copy(a);
  return offset(a, dir, dist(a, b) * t);
}

export function copy(p: Vec2): Vec2 {
  return p.y === undefined ? { x: p.x, z: p.z } : { x: p.x, y: p.y, z: p.z };
}

// Writes q into p in place, y included when the ground is the sphere.
export function assign(p: Vec2, q: Vec2): void {
  p.x = q.x;
  p.z = q.z;
  if (q.y !== undefined) p.y = q.y;
}

export function same(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.z === b.z && a.y === b.y;
}

// Distance from p to the segment a..b (a skillshot's line, a wall), with the
// fraction along it of the nearest point. On the sphere, the great circle
// arc a..b: the distance to its plane where p's foot falls inside the arc,
// else to the nearer end.
export function segmentDist(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  if (p.y === undefined || a.y === undefined || b.y === undefined) {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t =
      len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
    return { d: hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t)), t };
  }
  const total = dist(a, b);
  if (total <= 0) return { d: dist(p, a), t: 0 };
  // The great circle's plane normal m = a x b.
  let mx = a.y * b.z - a.z * b.y;
  let my = a.z * b.x - a.x * b.z;
  let mz = a.x * b.y - a.y * b.x;
  const m = len3(mx, my, mz);
  if (m <= 0) return { d: dist(p, a), t: 0 };
  mx /= m;
  my /= m;
  mz /= m;
  const off = p.x * mx + p.y * my + p.z * mz;
  // p's foot on the plane, inside the wedge from a to b when a x foot and
  // foot x b both point along m.
  const fx = p.x - off * mx;
  const fy = p.y - off * my;
  const fz = p.z - off * mz;
  const s1 = (a.y * fz - a.z * fy) * mx + (a.z * fx - a.x * fz) * my + (a.x * fy - a.y * fx) * mz;
  const s2 = (fy * b.z - fz * b.y) * mx + (fz * b.x - fx * b.z) * my + (fx * b.y - fy * b.x) * mz;
  if (s1 >= 0 && s2 >= 0) {
    const along = dist(a, p);
    const across = Math.abs(off);
    const ta = along * along - across * across;
    const t = Math.max(0, Math.min(1, Math.sqrt(ta > 0 ? ta : 0) / total));
    return { d: across, t };
  }
  const da = dist(p, a);
  const db = dist(p, b);
  return da <= db ? { d: da, t: 0 } : { d: db, t: 1 };
}

// A unit tangent basis at p: east and north. On the plane +x and +z. On the
// sphere east is +y x p, so the frame is singular at the poles (0, +-R, 0),
// which the planet keeps impassable; there a fixed east stands in.
export function basis(p: Vec2): { east: Vec2; north: Vec2 } {
  if (p.y === undefined) return { east: { x: 1, z: 0 }, north: { x: 0, z: 1 } };
  let ex = p.z;
  let ez = -p.x;
  let e = hypot(ex, ez);
  if (e <= 1e-9) {
    ex = 1;
    ez = 0;
    e = 1;
  }
  const east = { x: ex / e, y: 0, z: ez / e };
  // north = east x n, with n the outward normal: the quarter turn left of
  // east, as +z is of +x on the plane.
  return { east, north: turnLeft(east, p) };
}

// The direction at p an angle from east, toward north: the plane's
// {cos, sin}.
export function heading(p: Vec2, angle: number): Vec2 {
  const c = cos(angle);
  const s = sin(angle);
  if (p.y === undefined) return { x: c, z: s };
  const { east, north } = basis(p);
  return {
    x: east.x * c + north.x * s,
    y: (east.y ?? 0) * c + (north.y ?? 0) * s,
    z: east.z * c + north.z * s,
  };
}

// The outward unit normal at a ground point: +y on the plane.
export function up(p: Vec2): Vec3 {
  if (p.y === undefined) return { x: 0, y: 1, z: 0 };
  const r = len3(p.x, p.y, p.z);
  return { x: p.x / r, y: p.y / r, z: p.z / r };
}

// A sphere point put back on its sphere of radius r (after arithmetic that
// left it a hair off).
export function settle(p: Vec2, r: number): Vec2 {
  if (p.y === undefined) return p;
  const d = len3(p.x, p.y, p.z);
  return { x: (p.x / d) * r, y: (p.y / d) * r, z: (p.z / d) * r };
}

// A vector made unit length: the plane's {v.x / len, v.z / len} with len
// its length, the sphere's the same over all three axes; null for a zero
// vector.
export function unit(v: Vec2): Vec2 | null {
  const len = norm(v);
  if (len <= 0) return null;
  return v.y === undefined
    ? { x: v.x / len, z: v.z / len }
    : { x: v.x / len, y: v.y / len, z: v.z / len };
}

// The point a fraction t of a line of the given length along the unit
// direction dir from p: the plane's p + dir * length * t, in that order of
// operations; the sphere's offset by length * t.
export function along(p: Vec2, dir: Vec2, length: number, t: number): Vec2 {
  if (p.y === undefined || dir.y === undefined) {
    return { x: p.x + dir.x * length * t, z: p.z + dir.z * length * t };
  }
  return offset(p, dir, length * t);
}

// A ground point from its coordinates, as an order names it: the plane's
// {x, z}, the sphere's with y.
export function point(x: number, z: number, y?: number): Vec2 {
  return y === undefined ? { x, z } : { x, y, z };
}

// The vector at p pointing away from `from`, as long as the distance
// between them: the plane's p - from. On the sphere the reverse of the
// delta from p toward `from`, a tangent at p (a knockback's push, the
// heading a cast arrives with at its aim).
export function away(p: Vec2, from: Vec2): Vec2 {
  if (p.y === undefined || from.y === undefined) return { x: p.x - from.x, z: p.z - from.z };
  const v = delta(p, from);
  return { x: -v.x, y: -(v.y ?? 0), z: -v.z };
}

// The tangent at p with components e toward east and n toward north
// (basis): the plane's {x: e, z: n}, unscaled.
export function tangent(p: Vec2, e: number, n: number): Vec2 {
  if (p.y === undefined) return { x: e, z: n };
  const { east, north } = basis(p);
  return {
    x: east.x * e + north.x * n,
    y: (east.y ?? 0) * e + (north.y ?? 0) * n,
    z: east.z * e + north.z * n,
  };
}

// p moved by the tangent v: the plane's p + v; on the sphere along v's
// great circle by v's length, so the point stays on the sphere.
export function shift(p: Vec2, v: Vec2): Vec2 {
  if (p.y === undefined || v.y === undefined) return { x: p.x + v.x, z: p.z + v.z };
  const dir = unit(v);
  if (!dir) return copy(p);
  return offset(p, dir, len3(v.x, v.y, v.z));
}
