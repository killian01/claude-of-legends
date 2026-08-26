// Ability casting: validates mana, cooldown, and range, then turns the
// ability's declarative CastSpec into live projectiles, zones, dashes, or
// immediate effects. Content only declares; this module executes. Sigils
// reuse executeCast with their own bookkeeping.

import type { CombatCtx } from '../sim_context';
import type { AbilityKey, Vec2 } from '../types';
import type { Unit } from '../unit';
import { applyEffects, type EffectSpec, type Power } from './effects';
import { breakStealth, isStealthed, isStunned } from './status';

export type CastSpec =
  | {
      kind: 'skillshot';
      speed: number;
      radius: number;
      range: number;
      pierce?: boolean;
      onHit: readonly EffectSpec[];
      allyEffects?: readonly EffectSpec[];
    }
  | {
      kind: 'zone';
      radius: number;
      duration: number;
      tickEvery?: number;
      onEnter?: readonly EffectSpec[];
      onTick?: readonly EffectSpec[];
      allyOnTick?: readonly EffectSpec[];
      detonateDelay?: number;
      onDetonate?: readonly EffectSpec[];
    }
  | { kind: 'self_or_ally'; searchRadius: number; effects: readonly EffectSpec[] }
  | { kind: 'enemy_target'; searchRadius: number; effects: readonly EffectSpec[] }
  | { kind: 'cone'; range: number; halfAngle: number; onHit: readonly EffectSpec[] }
  | {
      kind: 'burst';
      radius: number;
      effects: readonly EffectSpec[];
      selfEffects?: readonly EffectSpec[];
    }
  | {
      kind: 'dash';
      range: number;
      landRadius?: number;
      onLand?: readonly EffectSpec[];
      selfEffects?: readonly EffectSpec[];
    };

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

function findEnemyTarget(
  ctx: CombatCtx,
  caster: Unit,
  aim: Vec2,
  searchRadius: number,
  castRange: number,
): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of ctx.units.values()) {
    if (u.team === caster.team || u.dead || ctx.dead.has(u.id)) continue;
    if (isStealthed(u, ctx.time)) continue;
    const toCaster =
      Math.hypot(u.pos.x - caster.pos.x, u.pos.z - caster.pos.z) - caster.radius - u.radius;
    if (toCaster > castRange) continue;
    const d = Math.hypot(u.pos.x - aim.x, u.pos.z - aim.z) - u.radius;
    if (d > searchRadius) continue;
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

function enemiesWithin(ctx: CombatCtx, caster: Unit, center: Vec2, radius: number): Unit[] {
  const out: Unit[] = [];
  for (const u of ctx.units.values()) {
    if (u.team === caster.team || u.dead || ctx.dead.has(u.id)) continue;
    if (Math.hypot(u.pos.x - center.x, u.pos.z - center.z) <= radius + u.radius) out.push(u);
  }
  return out;
}

// Executes a resolved CastSpec. Returns false only when the spec needs a
// target that does not exist (nothing was paid yet in that case).
export function executeCast(
  ctx: CombatCtx,
  caster: Unit,
  spec: CastSpec,
  castRange: number,
  aim: Vec2,
  power: Power,
): boolean {
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
        pierce: spec.pierce ?? false,
        hitIds: new Set(),
        power,
        onHit: spec.onHit,
        allyEffects: spec.allyEffects ?? [],
      });
      return true;
    }
    case 'zone': {
      const at = clampToRange(caster.pos, aim, castRange);
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
        allyOnTick: spec.allyOnTick ?? [],
        detonateAt: spec.detonateDelay !== undefined ? ctx.time + spec.detonateDelay : null,
        onDetonate: spec.onDetonate ?? [],
        entered: new Set(),
      });
      return true;
    }
    case 'self_or_ally': {
      const at = clampToRange(caster.pos, aim, castRange);
      let target = caster;
      let bestD = spec.searchRadius;
      for (const u of ctx.units.values()) {
        if (u.team !== caster.team || u.kind !== 'champion' || u.id === caster.id) continue;
        if (u.dead || ctx.dead.has(u.id)) continue;
        const d = Math.hypot(u.pos.x - at.x, u.pos.z - at.z);
        if (d <= bestD) {
          bestD = d;
          target = u;
        }
      }
      applyEffects(ctx, caster.id, power, target, spec.effects);
      return true;
    }
    case 'enemy_target': {
      const at = clampToRange(caster.pos, aim, castRange);
      const target = findEnemyTarget(ctx, caster, at, spec.searchRadius, castRange);
      if (!target) return false;
      applyEffects(ctx, caster.id, power, target, spec.effects);
      return true;
    }
    case 'cone': {
      const dx = aim.x - caster.pos.x;
      const dz = aim.z - caster.pos.z;
      const aimAngle = Math.atan2(dz, dx);
      for (const u of enemiesWithin(ctx, caster, caster.pos, spec.range)) {
        const angle = Math.atan2(u.pos.z - caster.pos.z, u.pos.x - caster.pos.x);
        let diff = angle - aimAngle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) <= spec.halfAngle) applyEffects(ctx, caster.id, power, u, spec.onHit);
      }
      return true;
    }
    case 'burst': {
      for (const u of enemiesWithin(ctx, caster, caster.pos, spec.radius)) {
        applyEffects(ctx, caster.id, power, u, spec.effects);
      }
      if (spec.selfEffects) applyEffects(ctx, caster.id, power, caster, spec.selfEffects);
      return true;
    }
    case 'dash': {
      const at = clampToRange(caster.pos, aim, spec.range);
      const landed = ctx.nav.isWalkableAt(at.x, at.z) ? at : ctx.nav.nearestWalkable(at.x, at.z, 6);
      if (landed) {
        caster.pos = { x: landed.x, z: landed.z };
        caster.path = [];
      }
      if (spec.onLand && spec.landRadius) {
        for (const u of enemiesWithin(ctx, caster, caster.pos, spec.landRadius)) {
          applyEffects(ctx, caster.id, power, u, spec.onLand);
        }
      }
      if (spec.selfEffects) applyEffects(ctx, caster.id, power, caster, spec.selfEffects);
      return true;
    }
  }
}

export function castAbility(
  ctx: CombatCtx,
  caster: Unit,
  key: AbilityKey,
  def: AbilityDef,
  aim: Vec2,
): boolean {
  if (ctx.dead.has(caster.id) || caster.dead) return false;
  if (isStunned(caster, ctx.time)) return false;
  if ((caster.cooldowns[key] ?? 0) > ctx.time) return false;
  if (caster.mana < def.manaCost) return false;

  const power = { ad: caster.stats.ad, ap: caster.stats.ap };
  // Target-requiring specs resolve BEFORE anything is paid.
  if (def.spec.kind === 'enemy_target') {
    const at = clampToRange(caster.pos, aim, def.castRange);
    if (!findEnemyTarget(ctx, caster, at, def.spec.searchRadius, def.castRange)) return false;
  }

  caster.cooldowns[key] = ctx.time + def.cooldown;
  caster.mana -= def.manaCost;
  breakStealth(caster);
  ctx.events.push({ type: 'cast', unitId: caster.id, key });
  return executeCast(ctx, caster, def.spec, def.castRange, aim, power);
}
