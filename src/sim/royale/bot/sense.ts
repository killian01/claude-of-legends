// What the battle royale bot reads in a decision slot, computed once from
// the observation: its own point on the sphere, the enemies and neutral
// bodies its own sight shows, the light now and next. Fair by
// construction: the observation is the seat's own vision plus what every
// player knows (the planet, the Dusk, the standing caches, the pads), and
// nothing here reaches past it.

import { BOUT_BOTS } from '../../content/bots/bout_skills';
import { type ChampionHints, hintsFor } from '../../content/bots/hints';
import type { RoyaleSkill } from '../../content/bots/royale_skills';
import type { BoutBots } from '../../content/bouts/types';
import type { ChampionDef } from '../../content/champions';
import { CHAMPIONS } from '../../content/champions';
import { dist, type Vec3 } from '../../geo';
import type { ObsBurr, Observation, ObsRoyale, ObsSelf, ObsUnit } from '../../policy';
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
  // Crewmates standing (ADR 0034: always in the crew's sight), nearest
  // first; none in Solo.
  readonly allies: ObsUnit[];
  // Every crewmate's unit id, fallen ones too.
  readonly crew: ReadonlySet<number>;
  // Camp bodies, the ring creatures and the Warden in sight, nearest first.
  readonly neutrals: ObsUnit[];
  readonly now: DuskCap;
  readonly next: DuskCap | null;
  // Own walking speed, meters a second.
  readonly speed: number;
  readonly attackRange: number;
  // Hit by an enemy champion within the last two seconds.
  readonly struck: boolean;
  // The seat's own Burr while it lasts (ObsRoyale.burr), else null.
  readonly burr: ObsBurr | null;
  // In a Thornfray's bout (ObsRoyale.bout), the kind's numbers its bots
  // read in place of the fifty seat tunings (content/bots/bout_skills.ts),
  // BOUT_BOTS when the policy was given none; null on the planet.
  readonly bout: BoutBots | null;
}

export function p3(u: { x: number; z: number; y?: number }): Vec3 {
  return { x: u.x, y: u.y ?? 0, z: u.z };
}

export function buildSense(
  obs: Observation,
  r: ObsRoyale,
  layout: RoyaleLayout,
  skill: RoyaleSkill,
  bout: BoutBots | null = null,
): Sense {
  const s = obs.self;
  const me = p3(s);
  const byDist = (a: ObsUnit, b: ObsUnit) => dist(me, p3(a)) - dist(me, p3(b)) || a.id - b.id;
  const enemies = obs.units.filter((u) => !u.friendly && u.kind === 'champion').sort(byDist);
  const mates = obs.units.filter((u) => u.friendly && u.kind === 'champion');
  const allies = mates.filter((u) => u.hpFrac > 0).sort(byDist);
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
    allies,
    crew: new Set(mates.map((u) => u.id)),
    neutrals,
    now: r.dusk.now,
    next: r.dusk.next,
    speed: s.moveSpeed ?? 3.7,
    attackRange: s.attackRange ?? 5,
    struck: s.struckAt !== null && s.struckAt !== undefined && obs.time - s.struckAt <= 2,
    burr: r.burr && r.burr.until >= obs.time ? r.burr : null,
    bout: r.bout ? (bout ?? BOUT_BOTS) : null,
  };
}
