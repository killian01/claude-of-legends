// Tower targeting: locks a target until it dies or leaves range (like the
// genre), prefers minions over champions when acquiring. Firing rides the
// shared auto-attack system.

import type { CombatCtx } from './sim_context';
import type { Unit } from './unit';

function inRange(tower: Unit, o: Unit): boolean {
  const edge = Math.hypot(o.pos.x - tower.pos.x, o.pos.z - tower.pos.z) - tower.radius - o.radius;
  return edge <= tower.stats.attackRange;
}

function nearest(ctx: CombatCtx, tower: Unit, kinds: readonly string[]): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of ctx.units.values()) {
    if (o.team === tower.team || o.dead || ctx.dead.has(o.id)) continue;
    if (!kinds.includes(o.kind)) continue;
    if (!inRange(tower, o)) continue;
    const d = Math.hypot(o.pos.x - tower.pos.x, o.pos.z - tower.pos.z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

export function stepTowerAi(ctx: CombatCtx): void {
  for (const u of ctx.units.values()) {
    if (u.kind !== 'tower' || u.dead || ctx.dead.has(u.id)) continue;
    if (u.attackTargetId !== null) {
      const t = ctx.units.get(u.attackTargetId);
      if (t && !t.dead && !ctx.dead.has(t.id) && t.team !== u.team && inRange(u, t)) continue;
      u.attackTargetId = null;
    }
    const target = nearest(ctx, u, ['minion']) ?? nearest(ctx, u, ['champion']);
    u.attackTargetId = target ? target.id : null;
  }
}
