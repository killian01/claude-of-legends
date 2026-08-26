// Ability casting: validates mana, cooldown, and range, then turns the
// ability's declarative CastSpec into live projectiles, zones, or immediate
// effects. Content only declares; this module executes.

import type { CombatCtx } from '../sim_context';
import type { AbilityKey, Vec2 } from '../types';
import type { Unit } from '../unit';
import { applyEffects, type EffectSpec } from './effects';

export type CastSpec =
  | {
      kind: 'skillshot';
      speed: number;
      radius: number;
      range: number;
      onHit: readonly EffectSpec[];
    }
  | {
      kind: 'zone';
      radius: number;
      duration: number;
      tickEvery?: number;
      onEnter?: readonly EffectSpec[];
      onTick?: readonly EffectSpec[];
      detonateDelay?: number;
      onDetonate?: readonly EffectSpec[];
    }
  | { kind: 'self_or_ally'; searchRadius: number; effects: readonly EffectSpec[] };

export interface AbilityDef {
  name: string;
  manaCost: number;
  cooldown: number;
  castRange: number;
  spec: CastSpec;
}

function clampToRange(from: Vec2, aim: Vec2, range: number): Vec2 {
  const dx = aim.x - from.x;
  const dz = aim.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d <= range || d === 0) return { x: aim.x, z: aim.z };
  return { x: from.x + (dx / d) * range, z: from.z + (dz / d) * range };
}

export function castAbility(
  ctx: CombatCtx,
  caster: Unit,
  key: AbilityKey,
  def: AbilityDef,
  aim: Vec2,
): boolean {
  if (ctx.dead.has(caster.id) || caster.dead) return false;
  if ((caster.cooldowns[key] ?? 0) > ctx.time) return false;
  if (caster.mana < def.manaCost) return false;

  caster.cooldowns[key] = ctx.time + def.cooldown;
  caster.mana -= def.manaCost;
  ctx.events.push({ type: 'cast', unitId: caster.id, key });
  const power = { ad: caster.stats.ad, ap: caster.stats.ap };
  const spec = def.spec;

  switch (spec.kind) {
    case 'skillshot': {
      const dx = aim.x - caster.pos.x;
      const dz = aim.z - caster.pos.z;
      const d = Math.hypot(dx, dz);
      const dir = d > 0 ? { x: dx / d, z: dz / d } : { x: 1, z: 0 };
      const id = ctx.allocId();
      ctx.projectiles.set(id, {
        id,
        sourceId: caster.id,
        team: caster.team,
        pos: { x: caster.pos.x, z: caster.pos.z },
        dir,
        speed: spec.speed,
        radius: spec.radius,
        maxRange: spec.range,
        traveled: 0,
        homingTargetId: null,
        power,
        onHit: spec.onHit,
      });
      break;
    }
    case 'zone': {
      const at = clampToRange(caster.pos, aim, def.castRange);
      const tickEvery = spec.tickEvery ?? 0.5;
      const id = ctx.allocId();
      ctx.zones.set(id, {
        id,
        sourceId: caster.id,
        team: caster.team,
        pos: at,
        radius: spec.radius,
        until: ctx.time + spec.duration,
        tickEvery,
        nextTickAt: ctx.time + tickEvery,
        power,
        onEnter: spec.onEnter ?? [],
        onTick: spec.onTick ?? [],
        detonateAt: spec.detonateDelay !== undefined ? ctx.time + spec.detonateDelay : null,
        onDetonate: spec.onDetonate ?? [],
        entered: new Set(),
      });
      break;
    }
    case 'self_or_ally': {
      const at = clampToRange(caster.pos, aim, def.castRange);
      let target = caster;
      let bestD = spec.searchRadius;
      for (const u of ctx.units.values()) {
        if (u.team !== caster.team || u.kind !== 'champion' || u.id === caster.id) continue;
        if (ctx.dead.has(u.id)) continue;
        const d = Math.hypot(u.pos.x - at.x, u.pos.z - at.z);
        if (d <= bestD) {
          bestD = d;
          target = u;
        }
      }
      applyEffects(ctx, caster.id, power, target, spec.effects);
      break;
    }
  }
  return true;
}
