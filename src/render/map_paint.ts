// The map's paint model: scalar distance fields derived from the map record
// (lanes, river, plazas, jungle walls) and the vertex-color chain that turns
// them into ground tint. Kept apart from the mesh build so the flora can
// sample the same fields and colors and stay cohesive with the ground.

import * as THREE from 'three';
import type { GameMap } from '../sim/content/map';
import type { Vec2 } from '../sim/types';
import { clamp01, fbm2 } from './proc';

export const GROUND_PALETTE = {
  grass: 0x579441,
  grassDark: 0x3d7330,
  grassYellow: 0x84a24a,
  dirt: 0x8a6f47,
  dirtDark: 0x73592f,
  sand: 0xbfae7e,
  jungleFloor: 0x2d5526,
  riverBed: 0x2a5666,
  riverDeep: 0x1c4152,
  cobble: 0x8f8c86,
  cobbleDark: 0x6d6a64,
  edgeDark: 0x1b2f14,
} as const;

export const TEAM_GROUND_TINT: readonly number[] = [0x3f6ec0, 0xc05353];

function segDist(px: number, pz: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = px - a.x;
  const apz = pz - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 0 ? clamp01((apx * abx + apz * abz) / len2) : 0;
  const dx = apx - abx * t;
  const dz = apz - abz * t;
  return Math.hypot(dx, dz);
}

export interface MapPaint {
  laneDist(x: number, z: number): number;
  riverDist(x: number, z: number): number;
  wallDist(x: number, z: number): number;
  // Full ground tint at a world position, written into target.
  colorAt(x: number, z: number, target: THREE.Color): void;
  // Just the base grass chain: the tint flora samples so grass and trees
  // are arithmetically the same color as the ground they stand on.
  grassColorAt(x: number, z: number, target: THREE.Color): void;
}

export function buildMapPaint(map: GameMap): MapPaint {
  // The river band comes from the map record, so the painted water, the
  // dressing's sheet and the walkable corridor are the same three numbers.
  const riverA: Vec2 = map.river.a;
  const riverB: Vec2 = map.river.b;
  const riverHalf = map.river.width / 2;
  const laneSegs: [Vec2, Vec2][] = [];
  for (const lane of Object.values(map.lanes)) {
    for (let i = 0; i + 1 < lane.length; i++) laneSegs.push([lane[i]!, lane[i + 1]!]);
  }
  const plazas: { x: number; z: number; r: number }[] = [
    ...map.fountains.map((f) => ({ x: f.x, z: f.z, r: f.r + 2.4 })),
    ...map.sanctums.map((s) => ({ x: s.x, z: s.z, r: 5.6 })),
  ];

  const grass = new THREE.Color(GROUND_PALETTE.grass);
  const grassDark = new THREE.Color(GROUND_PALETTE.grassDark);
  const grassYellow = new THREE.Color(GROUND_PALETTE.grassYellow);
  const dirt = new THREE.Color(GROUND_PALETTE.dirt);
  const dirtDark = new THREE.Color(GROUND_PALETTE.dirtDark);
  const sand = new THREE.Color(GROUND_PALETTE.sand);
  const jungleFloor = new THREE.Color(GROUND_PALETTE.jungleFloor);
  const riverBed = new THREE.Color(GROUND_PALETTE.riverBed);
  const riverDeep = new THREE.Color(GROUND_PALETTE.riverDeep);
  const cobble = new THREE.Color(GROUND_PALETTE.cobble);
  const cobbleDark = new THREE.Color(GROUND_PALETTE.cobbleDark);
  const edgeDark = new THREE.Color(GROUND_PALETTE.edgeDark);
  const teamTints = TEAM_GROUND_TINT.map((c) => new THREE.Color(c));

  const laneDist = (x: number, z: number): number => {
    let best = Infinity;
    for (const [a, b] of laneSegs) {
      const d = segDist(x, z, a, b);
      if (d < best) best = d;
    }
    return best;
  };
  const riverDist = (x: number, z: number): number => segDist(x, z, riverA, riverB);
  const wallDist = (x: number, z: number): number => {
    let best = Infinity;
    for (const w of map.walls) {
      const d = Math.hypot(x - w.x, z - w.z) - w.r;
      if (d < best) best = d;
    }
    return best;
  };

  const grassColorAt = (x: number, z: number, c: THREE.Color): void => {
    // Two uncorrelated fbm scales: broad lush/dry patches plus fine grain.
    const v = fbm2(x * 0.045, z * 0.045, 53, 3);
    c.copy(grass).lerp(grassDark, v);
    const v2 = fbm2(x * 0.16, z * 0.16, 59, 2);
    c.lerp(grassYellow, v2 * 0.35);
  };

  const colorAt = (x: number, z: number, c: THREE.Color): void => {
    grassColorAt(x, z, c);

    // Dry bare patches: two decorrelated scales so wear reads fractal, then
    // threshold-and-sharpen; a single scale stamps same-size polka dots.
    const dry = fbm2(x * 0.026, z * 0.026, 83, 2) * 0.62 + fbm2(x * 0.012, z * 0.012, 89, 2) * 0.38;
    const dryW = clamp01((dry - 0.58) * 3.2);
    if (dryW > 0) {
      c.lerp(dirt, dryW * 0.4);
      c.lerp(grassYellow, dryW * 0.3);
    }

    // Jungle floor darkens around the wall blobs, feathered.
    const wd = wallDist(x, z);
    if (wd < 7) {
      const jw = clamp01(1 - wd / 7);
      c.lerp(jungleFloor, jw * 0.55);
    }

    // A faint team wash around each base corner.
    for (let t = 0; t < map.sanctums.length; t++) {
      const s = map.sanctums[t]!;
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < 26) c.lerp(teamTints[s.team]!, clamp01(1 - d / 26) * 0.09);
    }

    // Riverbed and sandy banks; the water planes float above this paint.
    const rd = riverDist(x, z);
    if (rd < riverHalf) {
      const depth = clamp01(1 - rd / riverHalf);
      c.lerp(riverBed, 0.9);
      c.lerp(riverDeep, depth * 0.8);
    } else if (rd < riverHalf + 2.4) {
      c.lerp(sand, clamp01(1 - (rd - riverHalf) / 2.4) * 0.65);
    }

    // Lanes: hard dirt core, feathered margin, tone broken by noise so the
    // path reads worn rather than painted.
    const ld = laneDist(x, z);
    const coreR = map.laneWidth * 0.26;
    const marginR = map.laneWidth * 0.48;
    if (ld < marginR) {
      const t = ld < coreR ? 1 : 1 - (ld - coreR) / (marginR - coreR);
      const wear = 0.55 + 0.45 * fbm2(x * 0.13, z * 0.13, 71, 2);
      c.lerp(dirt, t * 0.85 * wear);
      c.lerp(dirtDark, t * 0.4 * (1 - wear));
    }

    // Stone plazas under fountains and sanctums, cobble tone broken by noise.
    for (const p of plazas) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 1.6) {
        const t = d < p.r ? 1 : 1 - (d - p.r) / 1.6;
        const tone = fbm2(x * 0.5, z * 0.5, 97, 2);
        c.lerp(cobble, t * 0.9);
        c.lerp(cobbleDark, t * 0.5 * tone);
      }
    }

    // Darken toward the map border so the play field melts into the forest
    // skirt instead of ending on a bright cut line.
    const edge = Math.min(x, z, map.size - x, map.size - z);
    if (edge < 7) c.lerp(edgeDark, clamp01(1 - edge / 7) * 0.4);
  };

  return { laneDist, riverDist, wallDist, colorAt, grassColorAt };
}
