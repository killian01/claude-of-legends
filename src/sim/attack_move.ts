// Attack-move (game definition: A): walk toward a point, engaging the first
// enemy the TEAM can see along the way. The order persists until the point
// is reached or replaced; when the current target dies, the next one is
// acquired automatically.

import type { Sim } from './sim';

const ACQUIRE_RADIUS = 8;
const ARRIVE_RADIUS = 1.2;

export function stepAttackMove(sim: Sim): void {
  for (const u of sim.units.values()) {
    if (u.kind !== 'champion' || u.dead || u.attackMoveTarget === null) continue;
    const goal = u.attackMoveTarget;

    if (u.attackTargetId === null) {
      let best: number | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const o of sim.units.values()) {
        // Attack-move never auto-engages the neutral Warden.
        if (o.team === u.team || o.neutral || o.dead) continue;
        if (!sim.isVisible(u.team, o.id)) continue;
        const d = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z);
        if (d <= ACQUIRE_RADIUS && d < bestD) {
          bestD = d;
          best = o.id;
        }
      }
      if (best !== null) {
        u.attackTargetId = best;
      } else if (u.path.length === 0) {
        const d = Math.hypot(goal.x - u.pos.x, goal.z - u.pos.z);
        if (d <= ARRIVE_RADIUS) {
          u.attackMoveTarget = null;
        } else {
          sim.orderPath(u.id, goal.x, goal.z);
        }
      }
    }
  }
}
