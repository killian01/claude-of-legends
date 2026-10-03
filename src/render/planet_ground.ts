// The Wanderseed's ground as the renderer reads it (docs/plan-royale.md,
// docs/planet.md): the cube-sphere grid's height of every cell
// (navigation.bin, the sim's own grid), and the layout's places (pads,
// caches, crossroads), all on the sphere of radius 80. Presentation only:
// heights lift what is drawn, the sim's ground is the sphere itself
// (ADR 0029). Pure, so the lookups are testable without a renderer.

import type { Vec3 } from '../sim/geo';

export const PLANET_RADIUS = 80;
export const PLANET_CELLS = 320;
// A blocked cell's height in navigation.bin.
export const BLOCKED_HEIGHT = -32768;

// The faces of the cube-sphere grid, the generator's own table
// (scripts/planet/sphere.mjs): outward normal N and tangent axes U, V
// with U x V = N. Regions sit on the faces: the Ruins (+X), the Cypress
// groves (-X), the Sanctuary (+Y), the Open ground (-Y), the Lakes (+Z),
// the Cliffs (-Z).
export const FACES: readonly { N: Vec3; U: Vec3; V: Vec3 }[] = [
  { N: { x: 1, y: 0, z: 0 }, U: { x: 0, y: 0, z: -1 }, V: { x: 0, y: 1, z: 0 } },
  { N: { x: -1, y: 0, z: 0 }, U: { x: 0, y: 0, z: 1 }, V: { x: 0, y: 1, z: 0 } },
  { N: { x: 0, y: 1, z: 0 }, U: { x: 1, y: 0, z: 0 }, V: { x: 0, y: 0, z: -1 } },
  { N: { x: 0, y: -1, z: 0 }, U: { x: 1, y: 0, z: 0 }, V: { x: 0, y: 0, z: 1 } },
  { N: { x: 0, y: 0, z: 1 }, U: { x: 1, y: 0, z: 0 }, V: { x: 0, y: 1, z: 0 } },
  { N: { x: 0, y: 0, z: -1 }, U: { x: -1, y: 0, z: 0 }, V: { x: 0, y: 1, z: 0 } },
];

export const REGION_NAMES = [
  'Ruins',
  'Cypress groves',
  'Sanctuary',
  'Open ground',
  'Lakes',
  'Cliffs',
] as const;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// A point's face: the axis of its largest component, that component's
// sign, ties broken in the order x, y, z.
export function faceOf(p: Vec3): number {
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const az = Math.abs(p.z);
  if (ax >= ay && ax >= az) return p.x >= 0 ? 0 : 1;
  if (ay >= az) return p.y >= 0 ? 2 : 3;
  return p.z >= 0 ? 4 : 5;
}

// The gnomonic coordinates of a point on its face, each in [-1, 1].
export function faceUV(f: number, p: Vec3): { u: number; v: number } {
  const F = FACES[f]!;
  const pn = dot(p, F.N);
  return { u: dot(p, F.U) / pn, v: dot(p, F.V) / pn };
}

// The unit direction at face coordinates (u, v).
export function faceDir(f: number, u: number, v: number): Vec3 {
  const F = FACES[f]!;
  const x = F.N.x + F.U.x * u + F.V.x * v;
  const y = F.N.y + F.U.y * u + F.V.y * v;
  const z = F.N.z + F.U.z * u + F.V.z * v;
  const d = Math.sqrt(x * x + y * y + z * z);
  return { x: x / d, y: y / d, z: z / d };
}

// The cell a point falls in: f * n * n + j * n + i.
export function cellOf(p: Vec3, n = PLANET_CELLS): number {
  const f = faceOf(p);
  const { u, v } = faceUV(f, p);
  const i = Math.max(0, Math.min(n - 1, Math.floor(((u + 1) * n) / 2)));
  const j = Math.max(0, Math.min(n - 1, Math.floor(((v + 1) * n) / 2)));
  return f * n * n + j * n + i;
}

// The ground's height field: meters above the sim sphere per cell, read
// smoothly between cell centers over the walkable cells around a point.
export class PlanetHeights {
  constructor(
    readonly cells: Int16Array,
    readonly n = PLANET_CELLS,
  ) {
    if (cells.length !== 6 * n * n) throw new Error(`a planet grid holds ${6 * n * n} cells`);
  }

  blocked(p: Vec3): boolean {
    return this.cells[cellOf(p, this.n)] === BLOCKED_HEIGHT;
  }

  // Meters above the sphere at a point: bilinear between the four cell
  // centers around it on its face, the blocked ones left out; zero where
  // all four are blocked (deep water, a cliff's inside).
  heightAt(p: Vec3): number {
    const n = this.n;
    const f = faceOf(p);
    const { u, v } = faceUV(f, p);
    const fi = Math.max(0, Math.min(n - 1, ((u + 1) * n) / 2 - 0.5));
    const fj = Math.max(0, Math.min(n - 1, ((v + 1) * n) / 2 - 0.5));
    const i0 = Math.min(n - 2, Math.floor(fi));
    const j0 = Math.min(n - 2, Math.floor(fj));
    const ti = fi - i0;
    const tj = fj - j0;
    const base = f * n * n;
    let sum = 0;
    let weight = 0;
    for (let dj = 0; dj < 2; dj++) {
      for (let di = 0; di < 2; di++) {
        const h = this.cells[base + (j0 + dj) * n + i0 + di]!;
        if (h === BLOCKED_HEIGHT) continue;
        const w = (di ? ti : 1 - ti) * (dj ? tj : 1 - tj) + 1e-6;
        sum += h * w;
        weight += w;
      }
    }
    return weight > 0 ? sum / weight / 1000 : 0;
  }
}

export interface PlanetPad {
  at: Vec3;
  to: Vec3;
}

export interface PlanetCacheSpot {
  at: Vec3;
  golden: boolean;
}

// What of the layout the renderer draws: everything on |p| = radius.
export interface PlanetLayout {
  radius: number;
  crossroads: Vec3[];
  pads: PlanetPad[];
  caches: PlanetCacheSpot[];
  bushes: { at: Vec3; r: number }[];
  // Circles approximating every tall solid thing (sight blockers).
  blockers: { at: Vec3; r: number }[];
}

// A point read off the layout, as [x, y, z] or {x, y, z}, put on the sphere.
function pointOf(v: unknown, radius: number): Vec3 | null {
  let x: number;
  let y: number;
  let z: number;
  if (Array.isArray(v) && v.length >= 3) {
    [x, y, z] = v as [number, number, number];
  } else if (v && typeof v === 'object' && 'x' in v && 'y' in v && 'z' in v) {
    ({ x, y, z } = v as Vec3);
  } else return null;
  const d = Math.sqrt(x * x + y * y + z * z);
  if (!(d > 0)) return null;
  return { x: (x / d) * radius, y: (y / d) * radius, z: (z / d) * radius };
}

function listOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// The layout file (public/map/planet/layout.json), read tolerantly: a
// place without a readable point is skipped, never thrown on.
export function parseLayout(json: unknown, radius = PLANET_RADIUS): PlanetLayout {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const crossroads = listOf(o.crossroads)
    .map((c) => pointOf((c as { at?: unknown })?.at ?? c, radius))
    .filter((p): p is Vec3 => p !== null);
  const pads = listOf(o.pads)
    .map((p) => {
      const at = pointOf((p as { at?: unknown })?.at, radius);
      const to = pointOf((p as { to?: unknown })?.to, radius);
      return at && to ? { at, to } : null;
    })
    .filter((p): p is PlanetPad => p !== null);
  const caches = listOf(o.caches)
    .map((c) => {
      const at = pointOf((c as { at?: unknown })?.at ?? c, radius);
      return at ? { at, golden: (c as { golden?: unknown })?.golden === true } : null;
    })
    .filter((c): c is PlanetCacheSpot => c !== null);
  const bushes = listOf(o.bushes)
    .map((b) => {
      const at = pointOf((b as { at?: unknown })?.at ?? b, radius);
      const r = Number((b as { r?: unknown })?.r ?? 2);
      return at ? { at, r: Number.isFinite(r) ? r : 2 } : null;
    })
    .filter((b): b is { at: Vec3; r: number } => b !== null);
  const blockers = listOf(o.sightBlockers)
    .map((b) => {
      const at = pointOf((b as { at?: unknown })?.at ?? b, radius);
      const r = Number((b as { r?: unknown })?.r ?? 1);
      return at ? { at, r: Number.isFinite(r) ? r : 1 } : null;
    })
    .filter((b): b is { at: Vec3; r: number } => b !== null);
  return { radius, crossroads, pads, caches, bushes, blockers };
}

// The cube's eight corners on the sphere: where three regions meet.
export function cubeCorners(radius = PLANET_RADIUS): Vec3[] {
  const k = radius / Math.sqrt(3);
  const out: Vec3[] = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1]) for (const z of [-1, 1]) out.push({ x: x * k, y: y * k, z: z * k });
  return out;
}
