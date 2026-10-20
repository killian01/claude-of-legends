// A bout's plan (ADR 0035; docs/design/thornfray.md, The bout contract): a
// kind and its Thornyard turned into what the seams read. The Dusk's plan
// (dusk.ts DuskPlan: its closings numbered from the end, the Thornyard as
// its first cap, its edge speed, the burn outside before the first
// closing, when the light goes out), the caches' (how many, inside the
// Thornyard, when one comes back), the Seedfalls', the clock, and the map
// a bout stands on: the planet's, with only the camps, the rings and the
// Warden the kind runs. When the kind has Seedfalls the light is held at
// least to its clock plus their forecast, so no Seedfall is ever placed in
// the dark before the bout ends (seedfall.ts seedfallCap).

import type { BoutKind, BoutSeedfalls, BoutSystems } from '../../content/bouts/types';
import type { GameMap } from '../../content/map';
import { creatureOfRing } from '../../content/rings';
import type { Vec3 } from '../../geo';
import type { DuskPlan } from '../dusk';
import type { RegionId, RoyaleLayout } from '../layout';
import type { DuskCap } from '../types';

// A bout's Thornyard: a cap of the kind's chord radius around a region's
// heart.
export interface Thornyard {
  region: RegionId;
  center: Vec3;
  radius: number;
}

export function thornyardOf(layout: RoyaleLayout, region: RegionId, radius: number): Thornyard {
  const heart =
    layout.regions.find((r) => r.id === region)?.heart ??
    layout.regions[0]?.heart ??
    ({ x: layout.radius, y: 0, z: 0 } as Vec3);
  return { region, center: { ...heart }, radius };
}

export interface BoutPlan {
  dusk: DuskPlan;
  thornyard: DuskCap;
  // Seconds from landing to the bout's clock end.
  playS: number;
  caches: { count: number; backS: number | null };
  seedfalls: BoutSeedfalls | null;
}

// When the light goes out in a bout: the kind's own time, held at least to
// the end of its last closing's hold and, with Seedfalls, to its clock
// plus their forecast.
export function boutLightOutS(kind: BoutKind): number {
  const closings = kind.dusk.closings;
  const last = closings[closings.length - 1];
  let out = Math.max(kind.dusk.lightOutS, last ? last.holdTo : 0);
  if (kind.seedfalls) out = Math.max(out, kind.playS + kind.seedfalls.forecastS);
  return out;
}

export function boutPlan(kind: BoutKind, thornyard: Thornyard): BoutPlan {
  const lightOutS = boutLightOutS(kind);
  const n = kind.dusk.closings.length;
  // The last closing holds until the light goes out.
  const phases = kind.dusk.closings.map((c, i) => (i === n - 1 ? { ...c, holdTo: lightOutS } : c));
  const first: DuskCap = { center: { ...thornyard.center }, radius: thornyard.radius };
  return {
    dusk: {
      phases,
      first,
      edgeSpeed: kind.dusk.edgeSpeed,
      burnBefore: kind.dusk.burnBefore,
      lightOutS,
    },
    thornyard: first,
    playS: kind.playS,
    caches: { count: kind.caches.count, backS: kind.caches.backS },
    seedfalls: kind.seedfalls ?? null,
  };
}

// The planet's map as a bout stands on it: its camps only when the kind
// runs them, the rings of the creatures it raises, the Warden's pit only
// when the Warden rises. Nothing else moves.
export function boutGameMap(map: GameMap, systems: BoutSystems): GameMap {
  const risings = systems.risings ?? {};
  return {
    ...map,
    camps: systems.camps === true ? map.camps : [],
    rings: (map.rings ?? []).filter((r) => risings[creatureOfRing(r.id).id] !== undefined),
    wardenPits: risings.warden !== undefined ? map.wardenPits : [],
  };
}
