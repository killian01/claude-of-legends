// Ability casting: validates mana, cooldown, and range, then turns the
// ability's declarative CastSpec into live projectiles, zones, dashes, or
// immediate effects. Content only declares; this module executes. Sigils
// reuse executeCast with their own bookkeeping.

import { passiveOf } from '../passives';
import type { CombatCtx } from '../sim_context';
import { effectiveRank, RANK_BASE_SCALE, RANK_CD_SCALE } from '../stats';
import type { AbilityKey, Vec2 } from '../types';
import { hostile, type Unit } from '../unit';
import { raiseWall } from '../walls';
import { applyEffects, type EffectSpec, type Power } from './effects';
import {
  addStatus,
  breakStealth,
  isRooted,
  isStealthed,
  isStunned,
  isUntargetable,
} from './status';

export type CastSpec =
  | {
      kind: 'skillshot';
      speed: number;
      radius: number;
      range: number;
      pierce?: boolean;
      onHit: readonly EffectSpec[];
      allyEffects?: readonly EffectSpec[];
      // On a non-piercing hit, the bolt jumps once to the nearest other
      // valid enemy within `radius` of the victim and applies `onHit` there
      // (a deliberately weaker list in data).
      chain?: { radius: number; onHit: readonly EffectSpec[] };
      // When the bolt despawns at max range, the traveled line persists as
      // an impassable fissure (walls.ts) for `duration` seconds.
      leaveWall?: { duration: number };
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
      // Grants the caster's team sight of the zone's area, brush and
      // stealth included (vision.ts).
      reveal?: boolean;
      // Enemies crossing the rim from inside are punished (at most once per
      // `perUnitEvery` seconds each); dashes and blinks pass free.
      boundary?: { effects: readonly EffectSpec[]; perUnitEvery: number };
      // A field left behind when the zone detonates (Sylra's rank-3 R).
      leaveZone?: {
        radius: number;
        duration: number;
        tickEvery?: number;
        onTick?: readonly EffectSpec[];
      };
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
      // With a speed the dash is a real flight (dashes.ts): committed,
      // interceptable, wall-stopped. Without one it stays an instant blink.
      speed?: number;
      landRadius?: number;
      onLand?: readonly EffectSpec[];
      selfEffects?: readonly EffectSpec[];
      // Enemies crossed mid-flight are struck once each (traveling only).
      passThrough?: readonly EffectSpec[];
      // The flight itself cannot be targeted or damaged (Fenn's R strike).
      untargetableDuringTravel?: boolean;
    }
  // A temporary rampart perpendicular to the cast direction (walls.ts).
  | { kind: 'wall'; length: number; duration: number };

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
  // Full spec replacements unlocked at rank thresholds (kits-v2 per-rank
  // overrides): the highest entry at or below the live rank wins.
  atRank?: readonly { rank: number; spec: CastSpec }[];
  // ADR 0005: pressing the same key again inside `window` seconds resolves
  // the follow-up. v2's only recast blinks the caster back to where it
  // pressed the first cast. Budgeted like any cast; no mana, no cooldown.
  recast?: { window: number; returnBlink: true };
}

// The live spec for a rank: the highest atRank override at or below `rank`,
// else the base spec.
export function specForRank(def: AbilityDef, rank: number): CastSpec {
  let spec = def.spec;
  if (def.atRank) {
    for (const o of def.atRank) {
      if (rank >= o.rank) spec = o.spec;
    }
  }
  return spec;
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
        chain: spec.chain ?? null,
        leaveWall: spec.leaveWall ?? null,
        splashOnHit: null,
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
        reveal: spec.reveal ?? false,
        boundary: spec.boundary ?? null,
        boundaryNextAt: new Map(),
        insideIds: new Set(),
        leaveZone: spec.leaveZone ?? null,
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
      if (spec.speed !== undefined && spec.speed > 0) {
        // A real flight (dashes.ts): the unit is committed on its line and
        // the landing payload resolves wherever the flight actually ends.
        const dx = at.x - caster.pos.x;
        const dz = at.z - caster.pos.z;
        const dist = Math.hypot(dx, dz);
        const dir = dist > 0 ? { x: dx / dist, z: dz / dist } : { x: 1, z: 0 };
        caster.path = [];
        caster.activeDash = {
          from: { x: caster.pos.x, z: caster.pos.z },
          dir,
          speed: spec.speed,
          remaining: dist,
          traveled: 0,
          landRadius: spec.landRadius ?? 0,
          onLand: spec.onLand ?? [],
          selfEffects: spec.selfEffects ?? [],
          passThrough: spec.passThrough ?? [],
          hitIds: new Set(),
          power,
          vfx,
        };
        if (spec.untargetableDuringTravel) {
          addStatus(caster, {
            kind: 'untargetable',
            until: ctx.time + dist / spec.speed + 0.05,
          });
        }
        return true;
      }
      const landed = ctx.nav.isWalkableAt(at.x, at.z) ? at : ctx.nav.nearestWalkable(at.x, at.z, 6);
      if (landed) {
        caster.pos = { x: landed.x, z: landed.z };
        caster.path = [];
      }
      const fx = {
        center: { x: caster.pos.x, z: caster.pos.z },
        distance: Math.hypot(caster.pos.x - aim.x, caster.pos.z - aim.z),
      };
      if (spec.onLand && spec.landRadius) {
        for (const u of enemiesWithin(ctx, caster, caster.pos, spec.landRadius)) {
          applyEffects(ctx, caster.id, power, u, spec.onLand, 'ability', fx);
        }
      }
      if (spec.selfEffects) applyEffects(ctx, caster.id, power, caster, spec.selfEffects);
      return true;
    }
    case 'wall': {
      const at = clampToRange(caster.pos, aim, castRange);
      const dir = { x: at.x - caster.pos.x, z: at.z - caster.pos.z };
      raiseWall(ctx, caster.id, caster.team, at, dir, spec.length, spec.duration);
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

  // ADR 0005: an armed recast window resolves on the same key, skipping
  // mana, cooldown, and rank gates (all paid by the first press). The
  // decision budget still charges the press at the Sim layer.
  const armed = caster.recastArmed;
  if (armed && armed.key === key && armed.until > ctx.time) {
    if (isRooted(caster, ctx.time)) return false;
    caster.recastArmed = null;
    const landed = ctx.nav.isWalkableAt(armed.origin.x, armed.origin.z)
      ? armed.origin
      : ctx.nav.nearestWalkable(armed.origin.x, armed.origin.z, 6);
    if (landed) {
      caster.pos = { x: landed.x, z: landed.z };
      caster.path = [];
      caster.activeDash = null;
    }
    breakStealth(caster);
    ctx.events.push({ type: 'cast', unitId: caster.id, key });
    return true;
  }

  const rank = effectiveRank(caster, key);
  const spec = specForRank(def, rank);
  // A rooted champion cannot dash out of the root (review F.2).
  if (spec.kind === 'dash' && isRooted(caster, ctx.time)) return false;
  // Rank 0 means locked (R before champion level 6).
  if (rank <= 0) return false;
  if ((caster.cooldowns[key] ?? 0) > ctx.time) return false;
  if (caster.mana < def.manaCost) return false;

  const power = {
    ad: caster.stats.ad,
    ap: caster.stats.ap,
    scale: 1 + RANK_BASE_SCALE * (rank - 1),
  };
  // Target-requiring specs resolve BEFORE anything is paid.
  if (spec.kind === 'enemy_target') {
    const at = clampToRange(caster.pos, aim, def.castRange);
    if (!findEnemyTarget(ctx, caster, at, spec.searchRadius, def.castRange)) return false;
  }

  caster.cooldowns[key] = ctx.time + def.cooldown * (1 - RANK_CD_SCALE * (rank - 1));
  caster.mana -= def.manaCost;
  breakStealth(caster);
  passiveOf(caster)?.onCast?.(ctx, caster, key);
  ctx.events.push({ type: 'cast', unitId: caster.id, key });
  if (def.recast) {
    caster.recastArmed = {
      key,
      until: ctx.time + def.recast.window,
      origin: { x: caster.pos.x, z: caster.pos.z },
    };
  }
  if (def.windup && def.windup > 0) {
    // Deferred resolution: the sim's windup step fires it (or a stun
    // cancels it). Costs stay paid either way.
    caster.pendingSpell = { key, aim: { x: aim.x, z: aim.z }, resolveAt: ctx.time + def.windup };
    caster.path = [];
    return true;
  }
  return executeCast(ctx, caster, spec, def.castRange, aim, power, `${caster.championId}_${key}`);
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
      // A canceled windup also disarms its recast window: the follow-up
      // belongs to a strike that never happened.
      if (u.recastArmed && u.recastArmed.key === u.pendingSpell.key) u.recastArmed = null;
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
      specForRank(def, Math.max(1, rank)),
      def.castRange,
      pending.aim,
      power,
      `${u.championId}_${pending.key}`,
    );
  }
}
