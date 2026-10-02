// A small stand-in planet for the battle royale's pure rules: the
// Wanderseed's radius, six region hearts on the faces of the die, the
// poles' spires and one lake as the only ground nobody stands on, cache
// spots, pads at the cube's corners, camps. The real planet's files are
// read by tests/royale_match.test.ts; these tests pin the rules alone.

import type { CampKind } from '../src/sim/content/camps';
import { dirTo, dist, type Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import {
  along,
  type RegionId,
  type RoyaleGround,
  type RoyaleLayout,
  randomSpherePoint,
} from '../src/sim/royale/layout';

export const R = 80;

export function sph(x: number, y: number, z: number): Vec3 {
  const d = Math.sqrt(x * x + y * y + z * z);
  return { x: (x / d) * R, y: (y / d) * R, z: (z / d) * R };
}

// The blocked discs: the two spires and a lake beside the Lakes' heart.
export const BLOCKS: { at: Vec3; r: number }[] = [
  { at: sph(0, 1, 0), r: 6 },
  { at: sph(0, -1, 0), r: 6 },
  { at: sph(0.15, 0, 1), r: 8 },
];

export const fakeGround: RoyaleGround = {
  walkable(p) {
    return BLOCKS.every((b) => dist(p, b.at) > b.r);
  },
  nearestWalkable(p) {
    for (const b of BLOCKS) {
      const d = dist(p, b.at);
      if (d > b.r) continue;
      const dir = d > 1e-6 ? dirTo(b.at, p) : { x: 1, y: 0, z: 0 };
      return along(b.at, dir as Vec3, b.r + 0.5, R);
    }
    return p;
  },
};

const REGIONS: { id: RegionId; heart: Vec3 }[] = [
  { id: 'sanctuary', heart: sph(0.25, 1, 0.1) },
  { id: 'open', heart: sph(-0.2, -1, 0.15) },
  { id: 'ruins', heart: sph(1, 0, 0) },
  { id: 'groves', heart: sph(-1, 0, 0) },
  { id: 'lakes', heart: sph(-0.15, 0.1, 1) },
  { id: 'cliffs', heart: sph(0, 0, -1) },
];

function corners(): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) out.push(sph(sx, sy, sz));
    }
  }
  return out;
}

export function fakeLayout(seed = 7): RoyaleLayout {
  const rng = new Rng(seed);
  const cacheSpots: RoyaleLayout['cacheSpots'][number][] = REGIONS.map((r) => ({
    pos: r.heart,
    golden: true,
  }));
  cacheSpots.push({ pos: sph(-0.25, 1, -0.15), golden: true });
  while (cacheSpots.length < 250) {
    const p = randomSpherePoint(rng, R);
    if (!fakeGround.walkable(p)) continue;
    if (cacheSpots.some((c) => dist(c.pos, p) < 4)) continue;
    cacheSpots.push({ pos: p, golden: false });
  }
  const pads = corners().map((at) => {
    const face = sph(at.x, 0, 0);
    return { at, to: along(at, dirTo(at, face) as Vec3, 50, R) };
  });
  const kinds: CampKind[] = ['spinecrest', 'brackenlings', 'barkmaw'];
  const camps: RoyaleLayout['camps'][number][] = [];
  while (camps.length < 20) {
    const p = randomSpherePoint(rng, R);
    if (!fakeGround.walkable(p)) continue;
    camps.push({ pos: p, kind: kinds[camps.length % 3]! });
  }
  return {
    radius: R,
    regions: REGIONS,
    cacheSpots,
    pads,
    camps,
    pyrefang: REGIONS[2]!.heart,
    voidmaul: REGIONS[5]!.heart,
    warden: REGIONS[0]!.heart,
  };
}
