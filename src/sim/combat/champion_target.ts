// The champion a champion-targeted spell reaches (Ysmer's In My Stead):
// the living champion nearest the aim, of either side, the caster aside,
// within `range` of the caster (both bodies' edges, as an enemy-targeted
// spell measures) and `searchRadius` of the aim. An enemy hidden in
// stealth is never reached, and nobody untargetable on either side.
// Ties go to the lower id, so every host picks the same champion.

import { dist } from '../geo';
import type { CombatCtx } from '../sim_context';
import type { Vec2 } from '../types';
import { hostile, type Unit } from '../unit';
import { isStealthed, isUntargetable } from './status';

export function championNearAim(
  ctx: CombatCtx,
  caster: Unit,
  aim: Vec2,
  range: number,
  searchRadius: number,
): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of ctx.units.values()) {
    if (u.id === caster.id || u.kind !== 'champion' || u.neutral) continue;
    if (u.dead || ctx.dead.has(u.id) || u.hp <= 0) continue;
    const foe = hostile(caster, u);
    if (!foe && u.team !== caster.team) continue;
    if (foe && isStealthed(u, ctx.time)) continue;
    if (isUntargetable(u, ctx.time)) continue;
    if (dist(u.pos, caster.pos) - u.radius - caster.radius > range) continue;
    const d = dist(u.pos, aim) - u.radius;
    if (d > searchRadius) continue;
    if (d < bestD || (d === bestD && best !== null && u.id < best.id)) {
      bestD = d;
      best = u;
    }
  }
  return best;
}
