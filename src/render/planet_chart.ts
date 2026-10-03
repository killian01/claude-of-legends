// The planet seen through a flat chart (ADR 0029, docs/plan-royale.md step
// 8). The renderer was written for a plane: it places every body, bolt,
// telegraph and spark at (x, height, z). On the Wanderseed it keeps doing
// exactly that, in a local flat map of the sphere around the camera's
// focus, the azimuthal equidistant chart: a sphere point lands at the
// heading it lies at from the center, as far out as its arc distance. A
// vertex shader then bends every chart vertex back onto the sphere
// (planet_bend.ts) with the formula `bend` below, the chart's exact
// inverse, so a body drawn in the chart stands exactly on the planet that
// is drawn on the sphere itself.
//
// The chart moves with the camera: re-centering carries its frame along
// the great circle to the new center (parallel transport), so the view
// never turns on a re-center; over a whole loop of the planet it may turn
// a little, the sphere's own holonomy, which is fine. Presentation only:
// the engine's trigonometry is allowed here, nothing of this reaches the
// sim.

import type { Vec3 } from '../sim/geo';

export interface ChartPoint {
  x: number;
  z: number;
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function unit(v: Vec3): Vec3 {
  const d = len(v);
  return d > 0 ? { x: v.x / d, y: v.y / d, z: v.z / d } : { x: 0, y: 1, z: 0 };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

// v turned by angle about the unit axis k (Rodrigues).
export function rotateAbout(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return {
    x: v.x * c + kv.x * s + k.x * kd,
    y: v.y * c + kv.y * s + k.y * kd,
    z: v.z * c + kv.z * s + k.z * kd,
  };
}

// The east of geo.ts's basis at a point (+y x p), with a fixed stand-in at
// the poles: where a chart starts when nothing came before it.
function eastAt(up: Vec3): Vec3 {
  const ex = up.z;
  const ez = -up.x;
  const e = Math.hypot(ex, ez);
  return e > 1e-9 ? { x: ex / e, y: 0, z: ez / e } : { x: 1, y: 0, z: 0 };
}

export class PlanetChart {
  // The outward unit normal at the center; the chart's +y.
  readonly up: Vec3;
  // Unit tangents at the center: the chart's +x and +z. North is the
  // quarter turn left of east (east x up, geo.ts's turnLeft), as +z is of
  // +x on the plane, so the plane's formulas keep their handedness.
  readonly east: Vec3;
  readonly north: Vec3;

  constructor(
    up: Vec3,
    east: Vec3,
    readonly radius: number,
  ) {
    this.up = unit(up);
    const k = dot(east, this.up);
    const e = unit({ x: east.x - k * this.up.x, y: east.y - k * this.up.y, z: east.z - k * this.up.z });
    this.east = e;
    this.north = cross(e, this.up);
  }

  // A chart around a sphere point, its east the one geo.ts's basis gives
  // there.
  static around(p: Vec3, radius = len(p)): PlanetChart {
    const up = unit(p);
    return new PlanetChart(up, eastAt(up), radius);
  }

  get center(): Vec3 {
    const r = this.radius;
    return { x: this.up.x * r, y: this.up.y * r, z: this.up.z * r };
  }

  // Where a sphere point lands on the chart. The antipode, the chart's one
  // singular point, lands on the +x edge, as far as the chart reaches.
  toChart(p: Vec3): ChartPoint {
    const u = unit(p);
    const c = dot(u, this.up);
    const tx = u.x - c * this.up.x;
    const ty = u.y - c * this.up.y;
    const tz = u.z - c * this.up.z;
    const s = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const angle = Math.atan2(s, c);
    if (s < 1e-12) return c > 0 ? { x: 0, z: 0 } : { x: Math.PI * this.radius, z: 0 };
    const d = (this.radius * angle) / s;
    return {
      x: d * (tx * this.east.x + ty * this.east.y + tz * this.east.z),
      z: d * (tx * this.north.x + ty * this.north.y + tz * this.north.z),
    };
  }

  // The sphere point a chart point stands for, on the sphere of this
  // chart's radius: the chart's exact inverse.
  fromChart(x: number, z: number): Vec3 {
    const r = Math.hypot(x, z);
    const R = this.radius;
    if (r < 1e-12) return this.center;
    const angle = r / R;
    const c = Math.cos(angle) * R;
    const s = (Math.sin(angle) * R) / r;
    const e = this.east;
    const n = this.north;
    return {
      x: this.up.x * c + (e.x * x + n.x * z) * s,
      y: this.up.y * c + (e.y * x + n.y * z) * s,
      z: this.up.z * c + (e.z * x + n.z * z) * s,
    };
  }

  // The same chart moved to a new center, its frame carried there along
  // the great circle between the two (parallel transport): near the new
  // center the new chart reads as the old one shifted, never turned.
  recentered(p: Vec3): PlanetChart {
    const to = unit(p);
    const axis = cross(this.up, to);
    const s = len(axis);
    const c = dot(this.up, to);
    if (s < 1e-12) {
      // Staying put, or the antipode, where every great circle leads: keep
      // the frame (turned over for the antipode, so it stays right-handed).
      return c > 0
        ? new PlanetChart(to, this.east, this.radius)
        : new PlanetChart(to, { x: -this.east.x, y: -this.east.y, z: -this.east.z }, this.radius);
    }
    const k = { x: axis.x / s, y: axis.y / s, z: axis.z / s };
    const east = rotateAbout(this.east, k, Math.atan2(s, c));
    return new PlanetChart(to, east, this.radius);
  }

  // The chart direction of a tangent direction taken at a sphere point,
  // a unit chart vector (a heading, a bolt's line). Read off a short step.
  dirToChart(at: Vec3, dir: Vec3): ChartPoint {
    const STEP = 0.05;
    const a = this.toChart(at);
    const r = len(at);
    const k = dot(dir, at) / (r * r);
    const t = unit({ x: dir.x - k * at.x, y: dir.y - k * at.y, z: dir.z - k * at.z });
    const b = this.toChart({
      x: at.x + t.x * STEP,
      y: at.y + t.y * STEP,
      z: at.z + t.z * STEP,
    });
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    return d > 0 ? { x: dx / d, z: dz / d } : { x: 1, z: 0 };
  }

  // The tangent direction at the sphere point of chart point (x, z) that
  // the chart direction (dx, dz) stands for, a unit vector.
  dirFromChart(x: number, z: number, dx: number, dz: number): Vec3 {
    const STEP = 0.05;
    const d = Math.hypot(dx, dz);
    if (d <= 0) return this.east;
    const a = this.fromChart(x, z);
    const b = this.fromChart(x + (dx / d) * STEP, z + (dz / d) * STEP);
    const v = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const r = len(a);
    const k = dot(v, a) / (r * r);
    return unit({ x: v.x - k * a.x, y: v.y - k * a.y, z: v.z - k * a.z });
  }

  // The rotation taking sphere coordinates into the chart's axes, rows
  // east, up, north: a sphere point p sits at (rows . p) - (0, R, 0)
  // relative to the chart's origin once the planet is turned this way.
  rows(): [Vec3, Vec3, Vec3] {
    return [this.east, this.up, this.north];
  }
}

// Where a chart point drawn h above the ground is shown: relative to the
// chart's origin, with the sphere's center at (0, -R, 0), the chart's
// point carried onto the sphere of radius R + h at its arc distance. Near
// the origin a chart point is almost itself; the whole chart lands
// exactly on the sphere (the GLSL twin is in planet_bend.ts).
export function bend(x: number, z: number, h: number, radius: number): Vec3 {
  const r = Math.hypot(x, z);
  if (r < 1e-9) return { x, y: h, z };
  const phi = r / radius;
  const s = ((radius + h) * Math.sin(phi)) / r;
  const half = Math.sin(phi / 2);
  return { x: x * s, y: h * Math.cos(phi) - 2 * radius * half * half, z: z * s };
}

// The inverse of bend: a shown point back to its chart point and height.
export function unbend(p: Vec3, radius: number): { x: number; z: number; h: number } {
  const dy = p.y + radius;
  const r = Math.hypot(p.x, p.z);
  const h = Math.sqrt(p.x * p.x + dy * dy + p.z * p.z) - radius;
  if (r < 1e-12) return { x: 0, z: 0, h };
  const arc = radius * Math.atan2(r, dy);
  return { x: (p.x / r) * arc, z: (p.z / r) * arc, h };
}

// What a direction becomes where the chart point (x, z) is shown: the
// tilt of the ground there, turning +y onto the sphere's normal. A camera
// offset, a normal, the up of a billboard.
export function bendTurn(v: Vec3, x: number, z: number, radius: number): Vec3 {
  const r = Math.hypot(x, z);
  if (r < 1e-9) return { x: v.x, y: v.y, z: v.z };
  return rotateAbout(v, { x: z / r, y: 0, z: -x / r }, r / radius);
}
