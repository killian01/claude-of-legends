// Projectiles in flight: linear skillshots and homing auto-attack bolts.
// Hit tests use point-to-segment distance so fast projectiles cannot tunnel
// through a unit between two ticks.

import { applyEffects, type EffectSpec, type Power } from './combat/effects';
import type { CombatCtx } from './sim_context';
import type { TeamId, Vec2 } from './types';
import type { Unit } from './unit';

export interface Projectile {
  id: number;
  sourceId: number;
  team: TeamId;
  pos: Vec2;
  dir: Vec2;
  speed: number;
  radius: number;
  maxRange: number;
  traveled: number;
  homingTargetId: number | null;
  power: Power;
  onHit: readonly EffectSpec[];
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  return Math.hypot(p.x - cx, p.z - cz);
}

export function stepProjectiles(ctx: CombatCtx, dt: number): void {
  for (const p of [...ctx.projectiles.values()]) {
    const from = { x: p.pos.x, z: p.pos.z };

    if (p.homingTargetId !== null) {
      const target = ctx.units.get(p.homingTargetId);
      if (!target || target.dead || ctx.dead.has(target.id)) {
        ctx.projectiles.delete(p.id);
        continue;
      }
      const dx = target.pos.x - p.pos.x;
      const dz = target.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const step = p.speed * dt;
      if (d <= step + p.radius + target.radius) {
        applyEffects(ctx, p.sourceId, p.power, target, p.onHit);
        ctx.projectiles.delete(p.id);
        continue;
      }
      p.pos.x += (dx / d) * step;
      p.pos.z += (dz / d) * step;
      continue;
    }

    const step = p.speed * dt;
    p.pos.x += p.dir.x * step;
    p.pos.z += p.dir.z * step;
    p.traveled += step;

    let hit: Unit | null = null;
    let hitDist = Number.POSITIVE_INFINITY;
    for (const u of ctx.units.values()) {
      if (u.team === p.team || u.dead || ctx.dead.has(u.id)) continue;
      if (segmentDistance(u.pos, from, p.pos) > p.radius + u.radius) continue;
      const d = Math.hypot(u.pos.x - from.x, u.pos.z - from.z);
      if (d < hitDist) {
        hitDist = d;
        hit = u;
      }
    }
    if (hit) {
      applyEffects(ctx, p.sourceId, p.power, hit, p.onHit);
      ctx.projectiles.delete(p.id);
      continue;
    }
    if (p.traveled >= p.maxRange) ctx.projectiles.delete(p.id);
  }
}
