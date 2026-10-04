// Idle auto-defense: a champion with no standing orders fights back when an
// enemy its team can see stands inside its attack range. Applies to humans
// and bots identically (review section C: a champion standing still never
// fought back). A champion in its Grace (royale/grace.ts) holds its fire
// whatever it was last ordered: only its own attack or cast ends the Grace.

import { isRecalling, isStunned } from './combat/status';
import { dist } from './geo';
import { inGrace } from './royale/grace';
import type { Sim } from './sim';

export function stepIdleDefense(sim: Sim): void {
  for (const u of sim.units.values()) {
    if (u.kind !== 'champion' || u.dead || u.holding) continue;
    if (u.attackTargetId !== null || u.attackMoveTarget !== null || u.path.length > 0) continue;
    if (isRecalling(u, sim.time) || isStunned(u, sim.time)) continue;
    if (sim.royaleMode && inGrace(sim.royaleMode, u.id, sim.time)) continue;
    let best: number | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const o of sim.units.values()) {
      // The Warden is opt-in: idle defense never walks you into its pit.
      if (o.team === u.team || o.neutral || o.dead) continue;
      if (!sim.isVisible(u.team, o.id)) continue;
      const edge = dist(o.pos, u.pos) - u.radius - o.radius;
      if (edge <= u.stats.attackRange && edge < bestD) {
        bestD = edge;
        best = o.id;
      }
    }
    if (best !== null) u.attackTargetId = best;
  }
}
