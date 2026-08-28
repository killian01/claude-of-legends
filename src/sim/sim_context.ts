// The seam combat systems talk to instead of Sim itself: live views of the
// state a system needs plus the event and death buffers. Sim stays a thin
// coordinator; systems stay host-agnostic modules a test can drive directly.

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
  readonly nav: NavGrid;
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
  allocId(): number;
}
