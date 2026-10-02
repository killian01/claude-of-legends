// Ally-seeking dashes: a dash declared with `toAlly` goes TO an allied
// champion, not in their direction. It picks the ally nearest the aim that
// is inside the dash's range and lands touching them. With nobody in reach
// there is no destination, so the cast is refused outright and costs
// nothing (Dain's Cinder Guard: a rescue jump needs someone to rescue).

import { copy, dirTo, dist, offset } from '../geo';
import type { CombatCtx } from '../sim_context';
import type { Vec2 } from '../types';
import type { Unit } from '../unit';

// Landing gap beyond the two radii, so the pair does not resolve overlapped.
const CLEARANCE = 0.15;

// The destination beside `ally`, or null when no ally qualifies.
export function allyDashAim(
  ctx: CombatCtx,
  caster: Unit,
  aim: Vec2,
  range: number,
  searchRadius: number,
): Vec2 | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of ctx.units.values()) {
    if (u.id === caster.id || u.kind !== 'champion') continue;
    if (u.neutral || u.team !== caster.team || u.dead || ctx.dead.has(u.id)) continue;
    if (dist(u.pos, caster.pos) - u.radius > range) continue;
    const d = dist(u.pos, aim) - u.radius;
    if (d > searchRadius) continue;
    // Ties broken by id: the same ally is chosen on every host.
    if (d < bestD || (d === bestD && best !== null && u.id < best.id)) {
      bestD = d;
      best = u;
    }
  }
  if (!best) return null;
  const gap = dist(caster.pos, best.pos);
  const dir = gap === 0 ? null : dirTo(caster.pos, best.pos);
  if (!dir) return copy(caster.pos);
  const stop = Math.max(0, gap - caster.radius - best.radius - CLEARANCE);
  return offset(caster.pos, dir, stop);
}
