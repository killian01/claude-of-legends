// Tower targeting: locks a target until it dies or leaves range (like the
// genre), prefers minions over champions when acquiring. Firing rides the
// shared auto-attack system.

import { isStealthed } from './combat/status';
import { hypot } from './exact';
import type { CombatCtx } from './sim_context';
import type { Unit } from './unit';

function inRange(tower: Unit, o: Unit): boolean {
  const edge = hypot(o.pos.x - tower.pos.x, o.pos.z - tower.pos.z) - tower.radius - o.radius;
  return edge <= tower.stats.attackRange;
}

function nearest(ctx: CombatCtx, tower: Unit, kinds: readonly string[]): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of ctx.units.values()) {
    // Towers ignore the neutral Warden entirely.
    if (o.team === tower.team || o.neutral || o.dead || ctx.dead.has(o.id)) continue;
    if (isStealthed(o, ctx.time)) continue;
    if (!kinds.includes(o.kind)) continue;
    if (!inRange(tower, o)) continue;
    const d = hypot(o.pos.x - tower.pos.x, o.pos.z - tower.pos.z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

const AGGRO_MEMORY_S = 2;

// The dive-punish rule: a champion that damaged an allied champion in tower
// range pulls the tower onto itself, overriding any current lock.
function aggressorInRange(ctx: CombatCtx, tower: Unit): Unit | null {
  for (const ally of ctx.units.values()) {
    if (ally.team !== tower.team || ally.kind !== 'champion' || ally.dead) continue;
    if (ctx.time - ally.lastHitAt > AGGRO_MEMORY_S) continue;
    if (!inRange(tower, ally)) continue;
    const attacker = ctx.units.get(ally.lastHitByChampion);
    if (!attacker || attacker.dead || ctx.dead.has(attacker.id)) continue;
    if (attacker.team === tower.team || attacker.neutral) continue;
    if (isStealthed(attacker, ctx.time)) continue;
    if (inRange(tower, attacker)) return attacker;
  }
  return null;
}

export function stepTowerAi(ctx: CombatCtx): void {
  for (const u of ctx.units.values()) {
    if (u.kind !== 'tower' || u.dead || ctx.dead.has(u.id)) continue;
    const before = u.attackTargetId;
    const aggressor = aggressorInRange(ctx, u);
    if (aggressor) {
      u.attackTargetId = aggressor.id;
      if (u.attackTargetId !== before) u.passiveStacks = 0;
      continue;
    }
    if (u.attackTargetId !== null) {
      const t = ctx.units.get(u.attackTargetId);
      if (
        t &&
        !t.dead &&
        !ctx.dead.has(t.id) &&
        t.team !== u.team &&
        !isStealthed(t, ctx.time) &&
        inRange(u, t)
      ) {
        continue;
      }
      u.attackTargetId = null;
    }
    const target = nearest(ctx, u, ['minion']) ?? nearest(ctx, u, ['champion']);
    u.attackTargetId = target ? target.id : null;
    // Heat (the ramping shot damage) resets on every target change.
    if (u.attackTargetId !== before) u.passiveStacks = 0;
  }
}
