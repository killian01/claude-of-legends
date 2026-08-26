// Ground zones: damage-over-time fields, entry triggers, and delayed
// detonations. A zone affects enemies of its owning team only.

import { applyEffects, type EffectSpec, type Power } from './combat/effects';
import type { CombatCtx } from './sim_context';
import type { TeamId, Vec2 } from './types';
import type { Unit } from './unit';

export interface Zone {
  id: number;
  sourceId: number;
  team: TeamId;
  pos: Vec2;
  radius: number;
  until: number;
  tickEvery: number;
  nextTickAt: number;
  power: Power;
  onEnter: readonly EffectSpec[];
  onTick: readonly EffectSpec[];
  detonateAt: number | null;
  onDetonate: readonly EffectSpec[];
  entered: Set<number>;
}

function enemiesInside(ctx: CombatCtx, z: Zone): Unit[] {
  const out: Unit[] = [];
  for (const u of ctx.units.values()) {
    if (u.team === z.team || ctx.dead.has(u.id)) continue;
    if (Math.hypot(u.pos.x - z.pos.x, u.pos.z - z.pos.z) <= z.radius + u.radius) out.push(u);
  }
  return out;
}

export function stepZones(ctx: CombatCtx): void {
  for (const z of [...ctx.zones.values()]) {
    const inside = enemiesInside(ctx, z);

    if (z.onEnter.length > 0) {
      for (const u of inside) {
        if (!z.entered.has(u.id)) {
          z.entered.add(u.id);
          applyEffects(ctx, z.sourceId, z.power, u, z.onEnter);
        }
      }
    }

    if (z.onTick.length > 0 && ctx.time >= z.nextTickAt) {
      for (const u of inside) applyEffects(ctx, z.sourceId, z.power, u, z.onTick);
      z.nextTickAt += z.tickEvery;
    }

    if (z.detonateAt !== null && ctx.time >= z.detonateAt) {
      for (const u of inside) applyEffects(ctx, z.sourceId, z.power, u, z.onDetonate);
      ctx.zones.delete(z.id);
      continue;
    }

    if (ctx.time >= z.until) ctx.zones.delete(z.id);
  }
}
