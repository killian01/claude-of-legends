// Test fixture: the synthetic planet the sphere tests share (ADR 0029). A
// sphere of radius 80, open everywhere (OpenSphereGround), under a map
// record with nothing of the 5v5 on it: no lanes, towers, Sanctums,
// fountains, pits, camps or rings, no brush and no walls. A test adds what
// it needs to the record, sets champions down at sphere points, and reads
// back whether everything stayed on the sphere. The planet's own grid
// (sphere_nav.ts) stands behind the same seam once it lands.

import type { GameMap } from '../src/sim/content/map';
import { dot } from '../src/sim/geo';
import { type Ground, OpenSphereGround } from '../src/sim/ground';
import { Sim, type SimOptions } from '../src/sim/sim';
import type { Vec2 } from '../src/sim/types';

export const R = 80;

// The sphere point in the direction (x, y, z).
export function sph(x: number, y: number, z: number): Vec2 {
  const d = Math.sqrt(x * x + y * y + z * z);
  return { x: (x / d) * R, y: (y / d) * R, z: (z / d) * R };
}

// Thirty degrees north, well away from the tangent frame's poles.
export const HOME = sph(0.3, 0.5, 0.8);

// The planet's record: nothing of the 5v5 on it.
export const PLANET: GameMap = {
  size: 1,
  borderMargin: 0,
  laneWidth: 0,
  river: { a: { x: 0, z: 0 }, b: { x: 0, z: 0 }, width: 0 },
  fountains: [],
  sanctums: [],
  towers: [],
  lanes: { top: [], mid: [], bot: [] },
  walls: [],
  brush: [],
  wardenPits: [],
  camps: [],
  rings: [],
};

// The open sphere as a plain record of the ground's operations, so a test
// can break some of its ground by overriding one of them.
export function openSphere(over: Partial<Ground> = {}): Ground {
  const open = new OpenSphereGround(R);
  return {
    isWalkableAt: (p) => open.isWalkableAt(p),
    nearestWalkable: (p) => open.nearestWalkable(p),
    lineOfWalk: (a, b) => open.lineOfWalk(a, b),
    findPath: (from, to) => open.findPath(from, to),
    heightAt: () => open.heightAt(),
    blockCircle: () => open.blockCircle(),
    unblockCircle: () => open.unblockCircle(),
    snapshotBlockers: () => open.snapshotBlockers(),
    restoreBlockers: () => open.restoreBlockers(),
    ...over,
  };
}

// A match on the planet: the bare record on the open sphere, whatever else
// the test asks for (the team count, the respawn, separation) on top.
export function planetSim(options: SimOptions = {}, seed = 3): Sim {
  return new Sim(seed, { map: PLANET, ground: openSphere(), ...options });
}

export function radius(p: Vec2): number {
  return Math.sqrt(p.x * p.x + (p.y ?? 0) * (p.y ?? 0) + p.z * p.z);
}

export function finite(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.y ?? Number.NaN);
}

// What is wrong with a ground point: off the sphere, without y, or NaN.
export function offGround(p: Vec2): string | null {
  if (p.y === undefined) return 'no y';
  if (!finite(p)) return 'not finite';
  const r = radius(p);
  return Math.abs(r - R) <= 1e-6 ? null : `${r - R} off the sphere`;
}

// What is wrong with a direction at p: not a unit tangent there.
export function offTangent(dir: Vec2, p: Vec2): string | null {
  if (!finite(dir)) return 'not finite';
  const len = Math.sqrt(dot(dir, dir));
  if (Math.abs(len - 1) > 1e-9) return `length ${len}`;
  return Math.abs(dot(dir, p)) / R <= 1e-9 ? null : 'not tangent';
}
