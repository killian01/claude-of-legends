// What the battle royale bot reads in a decision slot, computed once from
// the observation: its own point on the sphere, the enemies and neutral
// bodies its own sight shows, the light now and next. Fair by
// construction: the observation is the seat's own vision plus what every
// player knows (the planet, the Dusk, the standing caches, the pads), and
// nothing here reaches past it.

import { type ChampionHints, hintsFor } from '../../content/bots/hints';
import type { RoyaleSkill } from '../../content/bots/royale_skills';
import type { ChampionDef } from '../../content/champions';
import { CHAMPIONS } from '../../content/champions';
import { dist, type Vec3 } from '../../geo';
import type { Observation, ObsRoyale, ObsSelf, ObsUnit } from '../../policy';
import type { RoyaleLayout } from '../layout';
import type { DuskCap } from '../types';

export interface Sense {
  readonly obs: Observation;
  readonly s: ObsSelf;
  readonly r: ObsRoyale;
  readonly layout: RoyaleLayout;
  readonly skill: RoyaleSkill;
  readonly me: Vec3;
  readonly def: ChampionDef | undefined;
  readonly hints: ChampionHints;
  // Enemy champions in sight, nearest first.
  readonly enemies: ObsUnit[];
  // Camp bodies, the ring creatures and the Warden in sight, nearest first.
  readonly neutrals: ObsUnit[];
  readonly now: DuskCap;
  readonly next: DuskCap | null;
  // Own walking speed, meters a second.
  readonly speed: number;
  readonly attackRange: number;
  // Hit by an enemy champion within the last two seconds.
  readonly struck: boolean;
}

export function p3(u: { x: number; z: number; y?: number }): Vec3 {
  return { x: u.x, y: u.y ?? 0, z: u.z };
}

export function buildSense(
  obs: Observation,
  r: ObsRoyale,
  layout: RoyaleLayout,
  skill: RoyaleSkill,
): Sense {
  const s = obs.self;
  const me = p3(s);
  const byDist = (a: ObsUnit, b: ObsUnit) => dist(me, p3(a)) - dist(me, p3(b)) || a.id - b.id;
  const enemies = obs.units.filter((u) => !u.friendly && u.kind === 'champion').sort(byDist);
  const neutrals = obs.units
    .filter((u) => u.kind === 'camp' || u.kind === 'creature' || u.kind === 'warden')
    .sort(byDist);
  return {
    obs,
    s,
    r,
    layout,
    skill,
    me,
    def: s.championId ? CHAMPIONS[s.championId] : undefined,
    hints: hintsFor(s.championId),
    enemies,
    neutrals,
    now: r.dusk.now,
    next: r.dusk.next,
    speed: s.moveSpeed ?? 3.7,
    attackRange: s.attackRange ?? 5,
    struck: s.struckAt !== null && s.struckAt !== undefined && obs.time - s.struckAt <= 2,
  };
}
