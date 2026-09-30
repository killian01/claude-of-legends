// The Pyrefang's opening as data: when it plays which clip, and the fire
// column it rises from, ported from the Codex scene that authored it
// (scripts/pyrefang_codex_rise_column.py). Pure numbers and zero three.js
// imports, so the timings and the geometry are tested from plain node;
// vfx/pyrefang_rise_fx.ts turns them into meshes, creatures/pyrefang_visual.ts
// plays the clips. Distances are source metres (the Pyrefang is about one
// metre long) in Blender's axes, Z up; the effect module converts.

// The opening: the Emerge clip (a slow wake in the fire), then the Roar,
// then the creature's idle. Clip lengths as exported
// (public/models/creatures/pyrefang.export.json).
export const EMERGE_S = 3.0;
export const ROAR_S = 1.5;

export type OpeningClip = 'Emerge' | 'Roar';

// What plays `age` seconds after the creature rose: a clip and the time
// into it, or null once the opening is over (and for a creature first seen
// long after its rise, which simply stands in its idle).
export function openingAt(age: number): { clip: OpeningClip; time: number } | null {
  if (!(age >= 0)) return null;
  if (age < EMERGE_S) return { clip: 'Emerge', time: age };
  if (age < EMERGE_S + ROAR_S) return { clip: 'Roar', time: age - EMERGE_S };
  return null;
}

// The column's beats: (seconds, pose). Pose 0 is the fire hidden at the
// floor, 1..5 are rise, vortex, full column, opening in two, low flames.
export const COLUMN_BEATS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.15, 1],
  [0.35, 2],
  [0.55, 3],
  [0.75, 3],
  [0.95, 4],
  [1.25, 5],
  [1.7, 0],
];
export const CROWN_BEATS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.06, 1],
  [0.2, 2],
  [0.5, 1],
  [0.75, 0],
  [1.1, 1],
  [1.4, 2],
  [1.75, 0],
];
export const FIRE_END_S = 1.75;
// The whole effect, the cooling pit included.
export const RISE_FX_S = 3.0;
export const PIT_RADIUS = 0.45;

export function smooth(x: number): number {
  const k = Math.max(0, Math.min(1, x));
  return k * k * k * (k * (6 * k - 15) + 10);
}

// Each pose's weight at time t: a smooth cross-fade between beats.
export function beatWeights(
  t: number,
  beats: readonly (readonly [number, number])[],
  poses: number,
): number[] {
  const weights = new Array<number>(poses).fill(0);
  const first = beats[0]!;
  if (t <= first[0]) {
    weights[first[1]] = 1;
    return weights;
  }
  for (let i = 0; i + 1 < beats.length; i++) {
    const [t0, p0] = beats[i]!;
    const [t1, p1] = beats[i + 1]!;
    if (t <= t1) {
      const k = smooth((t - t0) / (t1 - t0));
      weights[p0]! += 1 - k;
      weights[p1]! += k;
      return weights;
    }
  }
  weights[beats[beats.length - 1]![1]] = 1;
  return weights;
}

// How much fire stands at t, 0..1 (drives the light).
export function fireAt(t: number): number {
  const heights = [0, 0.45, 0.85, 1, 0.85, 0.35];
  return beatWeights(t, COLUMN_BEATS, 6).reduce((s, w, i) => s + w * heights[i]!, 0);
}

// The fades the Codex keyed on each material, 0..1.
export const riseFade = {
  swirl: (t: number) => smooth(t / 0.08) * (1 - 0.8 * smooth((t - 1.2) / 1.5)),
  ring: (t: number) => 1 - smooth(t / 0.45),
  crown: (t: number) => 1 - smooth((t - FIRE_END_S + 0.3) / 0.3),
  column: (t: number) => 1 - smooth((t - FIRE_END_S + 0.25) / 0.25),
  core: (t: number) => 1 - smooth((t - 1.3) / 0.3),
  spark: (t: number) => 1 - 0.5 * smooth(t / 2.0),
};

export function swirlScale(t: number): number {
  return 0.35 + 0.65 * smooth(t / 0.18);
}
export function ringScale(t: number): number {
  return 0.3 + 1.1 * smooth(t / 0.45);
}
export function lightEnergy(t: number): number {
  return (
    10 + 120 * fireAt(t) * (1 + 0.15 * Math.sin(Math.PI * 2 * 8 * t)) + 40 * Math.exp(-t / 0.1)
  );
}

// ------------------------------------------------------------ geometry

// A small seeded generator: the column looks the same every time it rises.
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export type RibbonPoint = readonly [number, number, number, number]; // x, y, z, half width

// One climbing tongue: it leaves the floor at radius r0, winds by `twist`
// radians while narrowing to r1, leans out with `lean`, and is drawn toward
// the nearer of two lobes (angle 0 or pi) by `lobe`.
export function helix(
  angle: number,
  height: number,
  r0: number,
  r1: number,
  twist: number,
  width: number,
  lean = 0,
  lobe = 0,
  n = 18,
): RibbonPoint[] {
  const points: RibbonPoint[] = [];
  const target = Math.cos(angle) >= 0 ? 0 : Math.PI;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    let theta = angle + twist * s;
    if (lobe) {
      const delta = Math.atan2(Math.sin(target - theta), Math.cos(target - theta));
      theta += lobe * s * delta;
    }
    const r = r0 + (r1 - r0) * s + lean * s * s;
    const half =
      width * (1 - 0.8 * s) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, s * 1.6)) ** 0.5);
    points.push([r * Math.cos(theta), r * Math.sin(theta), height * s, Math.max(half, 1e-4)]);
  }
  return points;
}

// A small flame of the crown, licking outward from the pit's edge.
export function crownTongue(a: number, height: number, width: number, out: number): RibbonPoint[] {
  const points: RibbonPoint[] = [];
  for (let j = 0; j < 10; j++) {
    const s = j / 9;
    const r = 0.34 + out * s;
    const half = width * (1 - 0.85 * s);
    points.push([
      r * Math.cos(a + 0.25 * s),
      r * Math.sin(a + 0.25 * s),
      height * Math.sin(Math.PI * 0.5 * s),
      Math.max(half, 1e-4),
    ]);
  }
  return points;
}

export interface RibbonSpec {
  kind: 'crown' | 'column' | 'core';
  poses: RibbonPoint[][];
  spin: number;
}

// Every tongue of the effect with its poses and its spin (radians a
// second), in the order and with the variation the Codex scene has.
export function riseRibbons(seed = 22): RibbonSpec[] {
  const rng = seeded(seed);
  const uniform = (a: number, b: number) => a + (b - a) * rng();
  const out: RibbonSpec[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (Math.PI * 2 * i) / 20 + uniform(-0.08, 0.08);
    const tall = uniform(0.8, 1.2);
    out.push({
      kind: 'crown',
      poses: [
        crownTongue(a, 0.004, 0.001, 0.02),
        crownTongue(a, 0.1 * tall, 0.035, 0.1),
        crownTongue(a, 0.2 * tall, 0.045, 0.06),
      ],
      spin: 0,
    });
  }
  for (let i = 0; i < 22; i++) {
    const core = i >= 16;
    const count = core ? 6 : 16;
    const a = (Math.PI * 2 * (core ? i - 16 : i)) / count + uniform(-0.1, 0.1);
    const k = uniform(0.9, 1.12);
    const poses = core
      ? [
          helix(a, 0.02, 0.05, 0.05, 0, 0.001),
          helix(a, 0.5 * k, 0.07, 0.03, 3.0, 0.05),
          helix(a, 1.05 * k, 0.06, 0.02, 5.0, 0.06),
          helix(a, 1.25 * k, 0.09, 0.04, 4.4, 0.07),
          helix(a, 0.85 * k, 0.1, 0.1, 2.4, 0.05, 0.18, 0.5),
          helix(a, 0.2 * k, 0.1, 0.12, 1.0, 0.04),
        ]
      : [
          helix(a, 0.02, 0.3, 0.3, 0, 0.002),
          helix(a, 0.42 * k, 0.3, 0.14, 1.7, 0.128),
          helix(a, 0.92 * k, 0.27, 0.07, 3.2, 0.145),
          helix(a, 1.12 * k, 0.33, 0.16, 2.6, 0.17),
          helix(a, 0.9 * k, 0.3, 0.3, 1.5, 0.153, 0.3, 0.55),
          helix(a, 0.3 * k, 0.34, 0.4, 0.6, 0.111),
        ];
    out.push({
      kind: core ? 'core' : 'column',
      poses,
      spin: (core ? 3.4 : 1.6) * (i % 2 === 0 ? 1 : 0.85),
    });
  }
  return out;
}

// A ribbon's strip for one pose: two vertices per point, spread across
// the tongue (perpendicular to its path and to the column's radius), as
// flat x, y, z in Blender axes.
export function ribbonVertices(pose: readonly RibbonPoint[]): Float32Array {
  const n = pose.length;
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const [x, y, z, half] = pose[i]!;
    const a = pose[Math.min(n - 1, i + 1)]!;
    const b = pose[Math.max(0, i - 1)]!;
    let tx = a[0] - b[0];
    let ty = a[1] - b[1];
    let tz = a[2] - b[2];
    let len = Math.hypot(tx, ty, tz);
    if (len < 1e-9) {
      tx = 0;
      ty = 0;
      tz = 1;
      len = 1;
    }
    tx /= len;
    ty /= len;
    tz /= len;
    // across = tangent x radial (or x X when on the axis)
    const rl = Math.hypot(x, y);
    const [rx, ry, rz] = rl > 1e-6 ? [x, y, 0] : [1, 0, 0];
    let cx = ty * rz - tz * ry;
    let cy = tz * rx - tx * rz;
    let cz = tx * ry - ty * rx;
    let cl = Math.hypot(cx, cy, cz);
    if (cl < 1e-6) {
      cx = 1;
      cy = 0;
      cz = 0;
      cl = 1;
    }
    cx /= cl;
    cy /= cl;
    cz /= cl;
    out.set(
      [x - cx * half, y - cy * half, z - cz * half, x + cx * half, y + cy * half, z + cz * half],
      i * 6,
    );
  }
  return out;
}

// The sparks the burst throws: direction, speed, lift, birth and life.
export interface SparkSpec {
  angle: number;
  speed: number;
  up: number;
  born: number;
  life: number;
}

export function riseSparks(seed = 23, count = 48): SparkSpec[] {
  const rng = seeded(seed);
  const uniform = (a: number, b: number) => a + (b - a) * rng();
  return Array.from({ length: count }, () => ({
    angle: uniform(0, Math.PI * 2),
    speed: uniform(0.3, 0.9),
    up: uniform(1.6, 3.4),
    born: uniform(0, 0.6),
    life: uniform(0.6, 1.2),
  }));
}

// A spark's place (Blender axes) and size factor at t; size 0 off its life.
export function sparkAt(
  s: SparkSpec,
  t: number,
): { x: number; y: number; z: number; size: number } {
  const age = t - s.born;
  const k = Math.max(0, age);
  const r = 0.15 + s.speed * k;
  const size = age > 0 && age < s.life ? 1 - smooth(k / s.life) : 0;
  return {
    x: r * Math.cos(s.angle + 1.4 * k),
    y: r * Math.sin(s.angle + 1.4 * k),
    z: Math.max(0.01, 0.05 + s.up * k - 2.9 * k * k),
    size,
  };
}
