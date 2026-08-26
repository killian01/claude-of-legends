// Sim-space unit picking for pointer input. Generous like the genre: a click
// lands on a unit if it falls within the unit's radius plus slop, and
// champions win over structures when both are under the cursor. Dead units,
// units hidden by the fog of war, and invulnerable structures are never
// pickable.

import { isInvulnerable } from '../sim/structure_rules';
import type { TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { IWorld } from '../world_api';

const CLICK_SLOP = 1.2;

export function pickEnemyAt(world: IWorld, p: Vec2, selfTeam: TeamId): Readonly<Unit> | null {
  let best: Readonly<Unit> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const u of world.units.values()) {
    if (u.team === selfTeam || u.dead) continue;
    if (!world.isVisible(selfTeam, u.id)) continue;
    if ((u.kind === 'tower' || u.kind === 'sanctum') && isInvulnerable(world.units, u)) continue;
    const d = Math.hypot(u.pos.x - p.x, u.pos.z - p.z) - u.radius;
    if (d > CLICK_SLOP) continue;
    const priority = u.kind === 'champion' ? 0 : 1;
    const score = priority * 100 + d;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}
