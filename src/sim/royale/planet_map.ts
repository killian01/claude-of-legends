// The Wanderseed's layout record (public/map/planet/layout.json,
// docs/planet.md) read two ways: as the RoyaleLayout the mode's rules
// stand on (layout.ts), and as the GameMap the sim's shared systems read
// (the camps, the rings' creatures, the Warden's pit, the bushes that hide
// and the solid things that block sight), with none of the 5v5's
// structures: no lanes, no fountains, no towers, no Sanctums. Declared by
// shape, the fields the mode reads, so the record's other fields (the
// navigation's encoding, the dressing) move freely.

import type { CampKind } from '../content/camps';
import type { GameMap, RingSite, WallShape } from '../content/map';
import type { Vec3 } from '../geo';
import type { RegionId, RoyaleLayout } from './layout';

export interface PlanetPoint {
  x: number;
  y: number;
  z: number;
}

export interface PlanetLayoutRecord {
  radius: number;
  regions: readonly { id: string; name?: string; heart: PlanetPoint }[];
  pads: readonly { at: PlanetPoint; to: PlanetPoint }[];
  caches: readonly { at: PlanetPoint; golden: boolean }[];
  camps: readonly { at: PlanetPoint; kind: string }[];
  creatures: {
    warden: { at: PlanetPoint; r: number };
    pyrefang: { at: PlanetPoint; r: number };
    voidmaul: { at: PlanetPoint; r: number };
  };
  bushes?: readonly { at: PlanetPoint; r: number }[];
  sightBlockers?: readonly { at: PlanetPoint; r: number }[];
}

const REGION_IDS: readonly RegionId[] = ['sanctuary', 'open', 'ruins', 'groves', 'lakes', 'cliffs'];
const CAMP_KINDS: readonly CampKind[] = ['spinecrest', 'brackenlings', 'barkmaw'];

function pt(p: PlanetPoint): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

export function royaleLayoutOf(rec: PlanetLayoutRecord): RoyaleLayout {
  return {
    radius: rec.radius,
    regions: rec.regions
      .filter((r) => (REGION_IDS as readonly string[]).includes(r.id))
      .map((r) => ({ id: r.id as RegionId, heart: pt(r.heart) })),
    cacheSpots: rec.caches.map((c) => ({ pos: pt(c.at), golden: c.golden === true })),
    pads: rec.pads.map((p) => ({ at: pt(p.at), to: pt(p.to) })),
    camps: rec.camps
      .filter((c) => (CAMP_KINDS as readonly string[]).includes(c.kind))
      .map((c) => ({ pos: pt(c.at), kind: c.kind as CampKind })),
    pyrefang: pt(rec.creatures.pyrefang.at),
    voidmaul: pt(rec.creatures.voidmaul.at),
    warden: pt(rec.creatures.warden.at),
  };
}

// A big creature's leash past its disc: room to fight it without it
// resetting for a step back.
export const CREATURE_LEASH_MARGIN_M = 5;

function circle(c: { at: PlanetPoint; r: number }): WallShape {
  return { x: c.at.x, y: c.at.y, z: c.at.z, r: c.r };
}

function ringOf(id: 'bot' | 'top', c: { at: PlanetPoint; r: number }): RingSite {
  return {
    id,
    lane: id,
    x: c.at.x,
    y: c.at.y,
    z: c.at.z,
    r: c.r,
    leash: c.r + CREATURE_LEASH_MARGIN_M,
  };
}

// The sim's map of the planet: the Pyrefang on the bot ring and the
// Voidmaul on the top ring (content/rings.ts names each ring's creature),
// the Warden's one pit, the camps, the bushes as brush, the sight blockers
// as the walls that stop a sight line. Movement never reads these walls:
// the planet's own grid (sphere_nav.ts) holds what blocks a step.
export function planetGameMap(rec: PlanetLayoutRecord): GameMap {
  const origin = { x: 0, z: 0 };
  return {
    size: 2 * rec.radius,
    borderMargin: 0,
    laneWidth: 0,
    river: { a: origin, b: origin, width: 0 },
    fountains: [],
    sanctums: [],
    towers: [],
    lanes: { top: [], mid: [], bot: [] },
    walls: (rec.sightBlockers ?? []).map(circle),
    brush: (rec.bushes ?? []).map(circle),
    wardenPits: [
      {
        x: rec.creatures.warden.at.x,
        y: rec.creatures.warden.at.y,
        z: rec.creatures.warden.at.z,
        name: 'the Sanctuary',
      },
    ],
    camps: rec.camps
      .filter((c) => (CAMP_KINDS as readonly string[]).includes(c.kind))
      .map((c) => ({ x: c.at.x, y: c.at.y, z: c.at.z, kind: c.kind as CampKind })),
    rings: [ringOf('bot', rec.creatures.pyrefang), ringOf('top', rec.creatures.voidmaul)],
  };
}
