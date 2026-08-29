// Ally-seeking dashes: a dash declared with `toAlly` goes TO an allied
// champion, not in their direction. It picks the ally nearest the aim that
// is inside the dash's range and lands touching them. With nobody in reach
// there is no destination, so the cast is refused outright and costs
// nothing (Dain's Cinder Guard: a rescue jump needs someone to rescue).

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
    if (Math.hypot(u.pos.x - caster.pos.x, u.pos.z - caster.pos.z) - u.radius > range) continue;
    const d = Math.hypot(u.pos.x - aim.x, u.pos.z - aim.z) - u.radius;
    if (d > searchRadius) continue;
    // Ties broken by id: the same ally is chosen on every host.
    if (d < bestD || (d === bestD && best !== null && u.id < best.id)) {
      bestD = d;
      best = u;
    }
  }
  if (!best) return null;
  const dx = best.pos.x - caster.pos.x;
  const dz = best.pos.z - caster.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return { x: caster.pos.x, z: caster.pos.z };
  const stop = Math.max(0, dist - caster.radius - best.radius - CLEARANCE);
  return { x: caster.pos.x + (dx / dist) * stop, z: caster.pos.z + (dz / dist) * stop };
}
