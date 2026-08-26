// Idle auto-defense: a champion with no standing orders fights back when an
// enemy its team can see stands inside its attack range. Applies to humans
// and bots identically (review section C: a champion standing still never
// fought back).

import { isRecalling, isStunned } from './combat/status';
import type { Sim } from './sim';

export function stepIdleDefense(sim: Sim): void {
  for (const u of sim.units.values()) {
    if (u.kind !== 'champion' || u.dead) continue;
    if (u.attackTargetId !== null || u.attackMoveTarget !== null || u.path.length > 0) continue;
    if (isRecalling(u, sim.time) || isStunned(u, sim.time)) continue;
    let best: number | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const o of sim.units.values()) {
      if (o.team === u.team || o.dead) continue;
      if (!sim.isVisible(u.team, o.id)) continue;
      const edge = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z) - u.radius - o.radius;
      if (edge <= u.stats.attackRange && edge < bestD) {
        bestD = edge;
        best = o.id;
      }
    }
    if (best !== null) u.attackTargetId = best;
  }
}
