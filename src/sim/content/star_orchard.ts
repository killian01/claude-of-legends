// The Star Orchard (docs/star-orchard.md): the authored Blender map played
// in the test mode. Its gameplay points are exported beside the model
// (public/map/star-orchard/, scripts/import_map.mjs) and assembled here into
// the same GameMap record the launch map is, so the sim, the bots and the
// HUD read one shape. Data only: no I/O, the host hands the exported records
// in.

import { hypot } from '../exact';
import { decodeTerrainNav, type TerrainNavData } from '../terrain_nav';
import type { TeamId, Vec2 } from '../types';
import { CAMP_ROUND, type CampKind } from './camps';
import type { CampSpot, GameMap, LaneId, RingSite, TowerSpot, WardenPit } from './map';

// The playable square the export is placed in, in meters. The navigation
// grid covers a little more than the square on every side.
export const STAR_ORCHARD_SIZE = 156;
export const STAR_ORCHARD_TOWERS = 22;
export const STAR_ORCHARD_LANE_WIDTH = 11.5;

// gameplay.json: the lanes, bases and towers of one Blender revision.
export interface StarOrchardLayout {
  revision: number;
  laneWidth?: number;
  // The Blender source the layout was traced from; must match the model's.
  sourceSha256: string;
  bases: Vec2[];
  lanes: Record<LaneId, Vec2[]>;
  junglePaths?: Vec2[][];
  // The two rings (CONTEXT.md), one at the elbow of each side lane, in
  // the layout's own frame like the towers.
  objectiveSites?: {
    id: string;
    center: Vec2;
    radius: number;
    lane: LaneId;
    // The fan stairs, each from its foot on the ground to the disc's edge.
    stairCrossings?: { from: Vec2; to: Vec2 }[];
  }[];
  towers: (TowerSpot & { name: string; height: number })[];
}

// manifest.json: the export's landmarks and navigation parameters. The
// coordinates here are the model's (glTF, z negated from the sim's).
export interface StarOrchardLandmark extends Vec2 {
  id: string;
  kind: 'spawn' | 'camp' | 'center';
  height: number;
  team?: number;
  slot?: number;
}

export interface StarOrchardManifest {
  version: number;
  revision: number;
  sourceSha256?: string;
  model: string;
  navigation: string;
  cells: number;
  cellSize: number;
  origin: Vec2;
  heightScale: number;
  blockedValue: number;
  landmarks: StarOrchardLandmark[];
  visualReport?: { glbBytes?: number; quality?: string; materialBakeVersion?: number };
}

// The shipped map as a host holds it once it has read the export: the map
// record, the decoded grid, and what the records came from. Every match on
// every host is built on it (src/net/replay.ts buildMatchSim, ADR 0021):
// the server and the environment read the files from disk
// (server/star_orchard.ts), the browser fetches them
// (src/game/star_orchard_records.ts). A match builds its own walkability
// grid over the shared data, since the sim blocks its towers into it; the
// model for the renderer is the browser's business alone.
export interface StarOrchard {
  map: GameMap;
  navigation: TerrainNavData;
  revision: number;
  sourceSha256: string;
  // The model beside the records, by name and size, for the one host that
  // downloads it (the browser).
  model: string;
  modelBytes: number;
}

export function assembleStarOrchard(
  layout: StarOrchardLayout,
  manifest: StarOrchardManifest,
  navigation: ArrayBuffer,
): StarOrchard {
  return {
    map: starOrchardMap(layout, manifest),
    navigation: decodeTerrainNav(manifest, navigation),
    revision: manifest.revision,
    sourceSha256: manifest.sourceSha256 ?? '',
    model: manifest.model,
    modelBytes: manifest.visualReport?.glbBytes ?? 0,
  };
}

// The Warden's pits beside the plaza (ADR 0023): four rooms in the
// forests, the widest ground the corridors open into away from the camps,
// measured on the grid (seven to fourteen meters across; the forests hold
// nothing wider). Each has its point mirror on the other side, so a match
// draws them fairly on average; a pit in one team's forest is that team's
// shorter walk, and nobody knows which was drawn until the Warden stands
// there. The first Warden rises at the plaza.
// tests/warden_pits.test.ts pins that each room is open ground away from
// the camps and the lanes.
const STAR_ORCHARD_FOREST_PITS: readonly WardenPit[] = [
  { name: 'west glade', x: 23.4, z: 49 },
  { name: 'west hollow', x: 28.2, z: 101 },
  { name: 'east glade', x: 125, z: 104.6 },
  { name: 'east hollow', x: 123.8, z: 48.6 },
];

// The spawn slot whose landmark stands for the fountain: the middle of the
// five on each platform.
const FOUNTAIN_SLOT = 3;
const FOUNTAIN_RADIUS = 5;

// Assembles the GameMap of one export. Throws when the layout and the model
// come from different Blender sources: a lane traced on one revision over
// the collisions of another is exactly the mismatch a test mode must refuse.
export function starOrchardMap(layout: StarOrchardLayout, manifest: StarOrchardManifest): GameMap {
  if (
    layout.revision !== manifest.revision ||
    layout.towers.length !== STAR_ORCHARD_TOWERS ||
    !layout.sourceSha256 ||
    layout.sourceSha256 !== manifest.sourceSha256
  ) {
    throw new Error('Star Orchard gameplay export does not match the model export');
  }
  const spawns = manifest.landmarks.filter((p) => p.kind === 'spawn');
  const fountains = spawns.filter((p) => p.slot === FOUNTAIN_SLOT);
  const center = manifest.landmarks.find((p) => p.kind === 'center');
  if (fountains.length !== 2 || !center) throw new Error('Star Orchard export lacks its spawns');
  const teamOf = (p: StarOrchardLandmark): TeamId => (p.team === 1 ? 1 : 0);
  return {
    size: STAR_ORCHARD_SIZE,
    borderMargin: 0,
    laneWidth: layout.laneWidth ?? STAR_ORCHARD_LANE_WIDTH,
    river: { a: { x: center.x, z: 18 }, b: { x: center.x, z: STAR_ORCHARD_SIZE - 18 }, width: 9 },
    fountains: fountains.map((p) => ({
      team: teamOf(p),
      x: p.x,
      z: -p.z,
      r: FOUNTAIN_RADIUS,
      // The fountain heals and sells around every seat of the platform, not
      // only the middle one: the terrace is a band around the Sanctum, and
      // the seats at its ends stand eleven meters from the middle.
      pads: spawns
        .filter((s) => teamOf(s) === teamOf(p))
        .map((s) => ({ x: s.x, z: -s.z, r: FOUNTAIN_RADIUS })),
    })),
    spawns: spawns
      .slice()
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .map((p) => ({ team: teamOf(p), x: p.x, z: -p.z })),
    sanctums: layout.bases.map((p, team) => ({
      x: p.x,
      z: p.z,
      team: (team === 1 ? 1 : 0) as TeamId,
    })),
    towers: layout.towers.map((t) => ({
      team: t.team,
      lane: t.lane,
      tier: t.tier,
      x: t.x,
      z: t.z,
    })),
    lanes: {
      top: layout.lanes.top.map((p) => ({ x: p.x, z: p.z })),
      mid: layout.lanes.mid.map((p) => ({ x: p.x, z: p.z })),
      bot: layout.lanes.bot.map((p) => ({ x: p.x, z: p.z })),
    },
    walls: [],
    brush: [],
    wardenPits: [{ name: 'plaza', x: center.x, z: -center.z }, ...STAR_ORCHARD_FOREST_PITS],
    camps: starOrchardCamps(
      manifest.landmarks.filter((p) => p.kind === 'camp').map((p) => ({ x: p.x, z: -p.z })),
      fountains.map((p) => ({ team: teamOf(p), x: p.x, z: -p.z })),
    ),
    rings: starOrchardRings(layout),
  };
}

// The forests' camps by kind (content/camps.ts, CAMP_ROUND): each spot
// belongs to the team whose fountain is nearer, and a team's spots, from
// the nearest its door to the farthest, are the Spinecrest, the
// Brackenlings and the Barkmaw, so both junglers walk the same round and
// the buff camp is the far, contested end of each forest. The export's
// six spots (three a forest) fill one round each.
export function starOrchardCamps(
  spots: readonly Vec2[],
  fountains: readonly { team: TeamId; x: number; z: number }[],
): CampSpot[] {
  const home = (p: Vec2): TeamId => {
    let best: TeamId = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (const f of fountains) {
      const d = hypot(f.x - p.x, f.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = f.team;
      }
    }
    return best;
  };
  const out: CampSpot[] = [];
  for (const team of [0, 1] as const) {
    const fountain = fountains.find((f) => f.team === team);
    const mine = spots
      .filter((p) => home(p) === team)
      .sort(
        (a, b) =>
          (fountain ? hypot(a.x - fountain.x, a.z - fountain.z) : 0) -
          (fountain ? hypot(b.x - fountain.x, b.z - fountain.z) : 0),
      );
    mine.forEach((p, i) => {
      const kind: CampKind = CAMP_ROUND[i % CAMP_ROUND.length]!;
      out.push({ x: p.x, z: p.z, kind });
    });
  }
  // In the export's order, so a spot's index means the same everywhere.
  return spots.map((p) => out.find((c) => c.x === p.x && c.z === p.z)!);
}

// The rings the layout traces, keyed by the side lane they sit on. A
// layout from before the rings were traced yields none, and the match
// plays without creatures rather than refusing to start.
const RING_LEASH_MARGIN = 6;

function starOrchardRings(layout: StarOrchardLayout): RingSite[] {
  const rings: RingSite[] = [];
  for (const site of layout.objectiveSites ?? []) {
    if (site.lane !== 'top' && site.lane !== 'bot') continue;
    // The leash reaches the foot of the farthest stair; an export without
    // stairs gets a margin past the disc.
    let leash = site.radius + RING_LEASH_MARGIN;
    for (const stair of site.stairCrossings ?? []) {
      const d = hypot(stair.from.x - site.center.x, stair.from.z - site.center.z);
      if (d > leash) leash = d;
    }
    rings.push({
      id: site.lane,
      lane: site.lane,
      x: site.center.x,
      z: site.center.z,
      r: site.radius,
      leash,
    });
  }
  return rings;
}
