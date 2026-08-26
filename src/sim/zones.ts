// Ground zones: damage-over-time fields, entry triggers, delayed
// detonations, and ally-affecting fields (heals). Enemy effects target the
// zone owner's enemies; allyOnTick targets its allies.

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
  allyOnTick: readonly EffectSpec[];
  detonateAt: number | null;
  onDetonate: readonly EffectSpec[];
  entered: Set<number>;
  // Cosmetic source tag ('championId_KEY' or 'sigil_id'). Renderers pick
  // per-ability visuals from it; never gameplay.
  vfx: string | null;
}

function unitsInside(ctx: CombatCtx, z: Zone, enemies: boolean): Unit[] {
  const out: Unit[] = [];
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id)) continue;
    // Neutral units count as enemies for zones and never as allies.
    if (enemies ? !u.neutral && u.team === z.team : u.neutral || u.team !== z.team) continue;
    if (Math.hypot(u.pos.x - z.pos.x, u.pos.z - z.pos.z) <= z.radius + u.radius) out.push(u);
  }
  return out;
}

export function stepZones(ctx: CombatCtx): void {
  for (const z of [...ctx.zones.values()]) {
    const inside = unitsInside(ctx, z, true);

    if (z.onEnter.length > 0) {
      for (const u of inside) {
        if (!z.entered.has(u.id)) {
          z.entered.add(u.id);
          applyEffects(ctx, z.sourceId, z.power, u, z.onEnter);
        }
      }
    }

    if (ctx.time >= z.nextTickAt && (z.onTick.length > 0 || z.allyOnTick.length > 0)) {
      for (const u of inside) applyEffects(ctx, z.sourceId, z.power, u, z.onTick);
      if (z.allyOnTick.length > 0) {
        for (const u of unitsInside(ctx, z, false)) {
          applyEffects(ctx, z.sourceId, z.power, u, z.allyOnTick);
        }
      }
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
