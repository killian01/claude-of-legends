// The Star Orchard (docs/star-orchard.md): the authored Blender map played
// in the test mode. Its gameplay points are exported beside the model
// (public/map/star-orchard/, scripts/import_map.mjs) and assembled here into
// the same GameMap record the launch map is, so the sim, the bots and the
// HUD read one shape. Data only: no I/O, the host hands the exported records
// in.

import { decodeTerrainNav, type TerrainNavData } from '../terrain_nav';
import type { TeamId, Vec2 } from '../types';
import type { GameMap, LaneId, RingSite, TowerSpot } from './map';

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
  objectiveSites?: { id: string; center: Vec2; radius: number; lane: LaneId }[];
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
    wardenPits: [{ x: center.x, z: -center.z }],
    camps: manifest.landmarks
      .filter((p) => p.kind === 'camp')
      .map((p, index, all) => ({ x: p.x, z: -p.z, buff: index === 0 || index === all.length - 1 })),
    rings: starOrchardRings(layout),
  };
}

// The rings the layout traces, keyed by the side lane they sit on. A
// layout from before the rings were traced yields none, and the match
// plays without creatures rather than refusing to start.
function starOrchardRings(layout: StarOrchardLayout): RingSite[] {
  const rings: RingSite[] = [];
  for (const site of layout.objectiveSites ?? []) {
    if (site.lane !== 'top' && site.lane !== 'bot') continue;
    rings.push({
      id: site.lane,
      lane: site.lane,
      x: site.center.x,
      z: site.center.z,
      r: site.radius,
    });
  }
  return rings;
}
