// The seam combat systems talk to instead of Sim itself: live views of the
// state a system needs plus the event and death buffers. Sim stays a thin
// coordinator; systems stay host-agnostic modules a test can drive directly.

import type { Ground } from './ground';
import type { NavGrid } from './navgrid';
import type { Projectile } from './projectiles';
import type { Rng } from './rng';
import type { SimEvent } from './sim';
import type { TeamBuffs } from './team_buffs';
import type { Unit } from './unit';
import type { Wall } from './walls';
import type { Zone } from './zones';

export interface CombatCtx {
  readonly time: number;
  readonly rng: Rng;
  // The grid the 5v5's own systems (lanes, waves, towers, the fountain)
  // walk; everything that also runs on the planet goes through `ground`.
  readonly nav: NavGrid;
  // The ground the match stands on (ground.ts, ADR 0029): the plane over
  // `nav`, or the planet's sphere.
  readonly ground: Ground;
  readonly units: Map<number, Unit>;
  readonly projectiles: Map<number, Projectile>;
  readonly zones: Map<number, Zone>;
  readonly walls: Map<number, Wall>;
  readonly events: SimEvent[];
  readonly dead: Set<number>;
  // Who last-hit each unit in `dead`, for kill rewards.
  readonly killers: Map<number, number>;
  // Team-wide, death-surviving buffs (the Warden's Boon).
  readonly teamBuffs: TeamBuffs;
  // Every champion on a team of its own (ADR 0030): a battle royale. Rules
  // about allies read it, since nobody has any.
  readonly freeForAll?: boolean;
  allocId(): number;
}
