// Ability casting: validates mana, cooldown, and range, then turns the
// ability's declarative CastSpec into live projectiles, zones, dashes, or
// immediate effects. Content only declares; this module executes. Sigils
// reuse executeCast with their own bookkeeping.

import { passiveOf } from '../passives';
import type { CombatCtx } from '../sim_context';
import { effectiveRank, RANK_BASE_SCALE, RANK_CD_SCALE } from '../stats';
import type { AbilityKey, Vec2 } from '../types';
import { hostile, type Unit } from '../unit';
import { applyEffects, type EffectSpec, type Power } from './effects';
import { breakStealth, isRooted, isStealthed, isStunned, isUntargetable } from './status';

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
  | {
      kind: 'enemy_target';
      searchRadius: number;
      effects: readonly EffectSpec[];
      selfEffects?: readonly EffectSpec[];
    }
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
  // Cast time in seconds: costs are paid at press, the spell resolves after
  // the windup, and a stun during it cancels the cast. The counterplay
  // window big ultimates deserve; instant when absent.
  windup?: number;
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
    if (!hostile(caster, u) || u.dead || ctx.dead.has(u.id)) continue;
    if (isStealthed(u, ctx.time) || isUntargetable(u, ctx.time)) continue;
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
    if (!hostile(caster, u) || u.dead || ctx.dead.has(u.id)) continue;
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
  vfx: string | null = null,
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
        vfx,
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
        // A zone always survives long enough to detonate.
        until: ctx.time + Math.max(spec.duration, (spec.detonateDelay ?? 0) + 0.05),
        tickEvery,
        nextTickAt: ctx.time + tickEvery,
        power,
        onEnter: spec.onEnter ?? [],
        onTick: spec.onTick ?? [],
        allyOnTick: spec.allyOnTick ?? [],
        detonateAt: spec.detonateDelay !== undefined ? ctx.time + spec.detonateDelay : null,
        onDetonate: spec.onDetonate ?? [],
        entered: new Set(),
        vfx,
      });
      return true;
    }
    case 'self_or_ally': {
      const at = clampToRange(caster.pos, aim, castRange);
      // The caster COMPETES at its own distance to the aim (review F.2: a
      // dying player pressing Mend next to a full-hp ally used to heal the
      // ally instead). An ally only steals the cast by being strictly
      // closer to the aim point.
      let target = caster;
      let bestD = Math.min(spec.searchRadius, Math.hypot(caster.pos.x - at.x, caster.pos.z - at.z));
      for (const u of ctx.units.values()) {
        if (u.team !== caster.team || u.kind !== 'champion' || u.id === caster.id) continue;
        if (u.dead || ctx.dead.has(u.id)) continue;
        const d = Math.hypot(u.pos.x - at.x, u.pos.z - at.z);
        if (d < bestD) {
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
      if (spec.selfEffects) applyEffects(ctx, caster.id, power, caster, spec.selfEffects);
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
  // A rooted champion cannot dash out of the root (review F.2).
  if (def.spec.kind === 'dash' && isRooted(caster, ctx.time)) return false;
  // Rank 0 means locked (R before champion level 6).
  const rank = effectiveRank(caster, key);
  if (rank <= 0) return false;
  if ((caster.cooldowns[key] ?? 0) > ctx.time) return false;
  if (caster.mana < def.manaCost) return false;

  const power = {
    ad: caster.stats.ad,
    ap: caster.stats.ap,
    scale: 1 + RANK_BASE_SCALE * (rank - 1),
  };
  // Target-requiring specs resolve BEFORE anything is paid.
  if (def.spec.kind === 'enemy_target') {
    const at = clampToRange(caster.pos, aim, def.castRange);
    if (!findEnemyTarget(ctx, caster, at, def.spec.searchRadius, def.castRange)) return false;
  }

  caster.cooldowns[key] = ctx.time + def.cooldown * (1 - RANK_CD_SCALE * (rank - 1));
  caster.mana -= def.manaCost;
  breakStealth(caster);
  passiveOf(caster)?.onCast?.(ctx, caster, key);
  ctx.events.push({ type: 'cast', unitId: caster.id, key });
  if (def.windup && def.windup > 0) {
    // Deferred resolution: the sim's windup step fires it (or a stun
    // cancels it). Costs stay paid either way.
    caster.pendingSpell = { key, aim: { x: aim.x, z: aim.z }, resolveAt: ctx.time + def.windup };
    caster.path = [];
    return true;
  }
  return executeCast(
    ctx,
    caster,
    def.spec,
    def.castRange,
    aim,
    power,
    `${caster.championId}_${key}`,
  );
}

// Resolves champions' pending windup casts: fire when the clock is up,
// cancel when the caster is stunned or dead. Called from the fixed tick
// order right before auto-attacks.
export function stepWindups(
  ctx: CombatCtx,
  abilitiesOf: (championId: string) => Record<AbilityKey, AbilityDef> | null,
): void {
  for (const u of ctx.units.values()) {
    if (!u.pendingSpell) continue;
    if (u.dead || ctx.dead.has(u.id) || isStunned(u, ctx.time)) {
      u.pendingSpell = null;
      continue;
    }
    if (ctx.time < u.pendingSpell.resolveAt) continue;
    const pending = u.pendingSpell;
    u.pendingSpell = null;
    if (u.championId === null) continue;
    const def = abilitiesOf(u.championId)?.[pending.key];
    if (!def) continue;
    const rank = effectiveRank(u, pending.key);
    const power = {
      ad: u.stats.ad,
      ap: u.stats.ap,
      scale: 1 + RANK_BASE_SCALE * (Math.max(1, rank) - 1),
    };
    executeCast(
      ctx,
      u,
      def.spec,
      def.castRange,
      pending.aim,
      power,
      `${u.championId}_${pending.key}`,
    );
  }
}
