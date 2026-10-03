// Soft unit collision: overlapping bodies push each other apart a little
// each tick, so waves read as formations instead of a single stacked blob
// (review F.0). The 5v5 separates its minions alone; a match on the planet
// can separate its champions too (SimOptions.separation). Deterministic
// pair order; pushes never land on blocked ground; a body in a dash's
// flight is the dash's.

import { isUntargetable } from './combat/status';
import { assign, carry, dirTo, dist, offset } from './geo';
import type { CombatCtx } from './sim_context';
import type { Unit, UnitKind } from './unit';

export const MINIONS_ONLY: readonly UnitKind[] = ['minion'];

export function stepSeparation(ctx: CombatCtx, kinds: readonly UnitKind[] = MINIONS_ONLY): void {
  const bodies: Unit[] = [];
  for (const u of ctx.units.values()) {
    if (!kinds.includes(u.kind) || u.dead || ctx.dead.has(u.id) || u.activeDash) continue;
    // A body nothing can touch (a launch pad's flier, a champion gone
    // untargetable) is not pushed and pushes nobody.
    if (isUntargetable(u, ctx.time)) continue;
    bodies.push(u);
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      const d = dist(a.pos, b.pos);
      const minDist = a.radius + b.radius;
      if (d >= minDist || d < 1e-6) continue;
      const dir = dirTo(a.pos, b.pos);
      if (!dir) continue;
      const push = Math.min(0.12, (minDist - d) / 2);
      // a steps back along the line, b forward along it, the heading
      // carried to b's own ground (the same heading on the plane).
      const aTo = offset(a.pos, dir, -push);
      const bTo = offset(b.pos, carry(dir, a.pos, b.pos), push);
      if (ctx.ground.isWalkableAt(aTo)) assign(a.pos, aTo);
      if (ctx.ground.isWalkableAt(bTo)) assign(b.pos, bTo);
    }
  }
}
