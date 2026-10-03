// What the battle royale reads off the planet (ADR 0031): the places the
// mode's rules stand on (the cache spots, the launch pads, the camps, the
// big creatures' sites, the regions' hearts) and the two questions it asks
// of the ground (walkable here, the nearest walkable point). The planet's
// own layout record (content/planet.ts) is assembled into this shape once
// per match, so every rule here is written and tested against the shape
// and not the file. Sphere points only: every position carries y.

import type { CampKind } from '../content/camps';
import type { Vec3 } from '../geo';
import { dist2, heading, offset, settle } from '../geo';
import type { Rng } from '../rng';

export type RegionId = 'sanctuary' | 'open' | 'ruins' | 'groves' | 'lakes' | 'cliffs';

export interface CacheSpot {
  pos: Vec3;
  // Golden caches give two pieces; the Sanctuary's and every region's
  // heart are golden, and a golden spot is always drawn.
  golden: boolean;
}

export interface PadSpot {
  at: Vec3;
  to: Vec3;
}

export interface CampSpotRoyale {
  pos: Vec3;
  kind: CampKind;
}

export interface RoyaleLayout {
  // The sphere's radius, meters.
  radius: number;
  // The six regions, each with its heart (where its golden cache stands
  // and where a bot spreading over the regions aims its drop).
  regions: readonly { id: RegionId; heart: Vec3 }[];
  cacheSpots: readonly CacheSpot[];
  pads: readonly PadSpot[];
  camps: readonly CampSpotRoyale[];
  // The big creatures: the Pyrefang at the Ruins' heart, the Voidmaul at
  // the Cliffs', the Warden in the Sanctuary.
  pyrefang: Vec3;
  voidmaul: Vec3;
  warden: Vec3;
}

// The ground's two answers the mode needs: whether a champion may stand
// at a point, and the nearest point where one may (null when none is near).
export interface RoyaleGround {
  walkable(p: Vec3): boolean;
  nearestWalkable(p: Vec3): Vec3 | null;
}

// The poles carry the planet's two impassable landmarks (the Sanctuary's
// spire at +Y, the Open ground's monolith at -Y; ADR 0029), and the tangent
// frame is singular there: nothing the mode draws lands within this chord
// of either pole.
export const POLE_CLEARANCE_M = 10;

export function nearPole(p: Vec3, radius: number, clearance = POLE_CLEARANCE_M): boolean {
  const north = { x: 0, y: radius, z: 0 };
  const south = { x: 0, y: -radius, z: 0 };
  const c2 = clearance * clearance;
  return dist2(p, north) < c2 || dist2(p, south) < c2;
}

// A point drawn uniformly over the sphere: a point drawn in the cube,
// kept when it falls inside the unit ball (and not at its very center),
// pushed out to the surface. The square root only (ADR 0019); the number
// of draws varies but is the same on every host for the same stream.
export function randomSpherePoint(rng: Rng, radius: number): Vec3 {
  for (;;) {
    const x = rng.next() * 2 - 1;
    const y = rng.next() * 2 - 1;
    const z = rng.next() * 2 - 1;
    const r2 = x * x + y * y + z * z;
    if (r2 > 1 || r2 < 1e-6) continue;
    const r = Math.sqrt(r2);
    return { x: (x / r) * radius, y: (y / r) * radius, z: (z / r) * radius };
  }
}

// A direction at p drawn uniformly around the circle.
export function randomHeading(rng: Rng, p: Vec3): Vec3 {
  return heading(p, rng.next() * 2 * Math.PI) as Vec3;
}

// The point s along a direction from p, kept on the sphere.
export function along(p: Vec3, dir: Vec3, s: number, radius: number): Vec3 {
  return settle(offset(p, dir, s), radius) as Vec3;
}

// The point at chord distance s from p in a uniformly drawn direction.
export function randomAround(rng: Rng, p: Vec3, s: number, radius: number): Vec3 {
  return along(p, randomHeading(rng, p), s, radius);
}

// The walkable ground point drawn uniformly over the sphere, away from the
// poles; null after `tries` misses.
export function randomWalkable(
  rng: Rng,
  layout: RoyaleLayout,
  ground: RoyaleGround,
  tries = 200,
): Vec3 | null {
  for (let i = 0; i < tries; i++) {
    const p = randomSpherePoint(rng, layout.radius);
    if (nearPole(p, layout.radius)) continue;
    if (ground.walkable(p)) return p;
  }
  return null;
}
