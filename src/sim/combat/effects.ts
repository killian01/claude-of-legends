// The shared effect primitives every ability is composed from, and the one
// dispatcher that applies them. Content declares EffectSpec lists; nothing in
// content contains engine logic. Power (the caster's ad/ap) is snapshotted at
// cast time so a projectile in flight stays deterministic even if the caster
// dies before impact.

import { hypot } from '../exact';
import type { DamageVia } from '../passive_types';
import { passiveOf } from '../passives';
import type { CombatCtx } from '../sim_context';
import type { AbilityKey, DamageType, Vec2 } from '../types';
import type { Unit } from '../unit';
import { dealDamage } from './damage';
import { addMarkStack, addStatus, clearMarks, healFactor, isRooted, slowPct } from './status';

// The eight compass directions as unit vectors, every 45 degrees: the
// constants are exact, where the engine's cosine of a multiple of PI/4
// is not (src/sim/exact.ts).
const D = Math.SQRT1_2;
const TERRAIN_RING: readonly (readonly [number, number])[] = [
  [1, 0],
  [D, D],
  [0, 1],
  [-D, D],
  [-1, 0],
  [-D, -D],
  [0, -1],
  [D, -D],
];

export interface Power {
  ad: number;
  ap: number;
  // Rank multiplier applied to BASE amounts (damage, heal, shield, dot).
  scale?: number;
}

// Facts about HOW an effect list arrived, supplied by the resolving system
// (projectile impact, dash landing, zone detonation). Predicates and
// directional displacement read them; a missing fact fails its predicate.
export interface EffectCtx {
  // Distance the delivery traveled before resolving (projectile, dash).
  distance?: number;
  // Center of the resolved shape (zone, dash landing) for withinCenter and
  // toCenter knockbacks.
  center?: Vec2;
  // The delivery's travel line, for 'aside' knockbacks (a wave sweeping
  // targets sideways off its path).
  lineFrom?: Vec2;
  lineDir?: Vec2;
}

// Deterministic predicates a conditional effect branches on, all resolved
// from sim state and the EffectCtx at the moment the effect list applies.
export type EffectPredicate =
  | { kind: 'distanceAtLeast'; distance: number }
  | { kind: 'targetHpBelow'; frac: number }
  // The target died to an earlier effect in this same list (effects apply
  // in order, so a damage entry before this predicate makes it a killing
  // blow check for the delivering ability, any victim kind).
  | { kind: 'targetDying' }
  // No other champion of the target's team within `radius` of the target.
  | { kind: 'targetIsolated'; radius: number }
  | { kind: 'targetSlowed' }
  // Unwalkable ground (map terrain or an ability wall) within `distance`.
  | { kind: 'targetNearTerrain'; distance: number }
  | { kind: 'targetIsChampion' }
  // The target carries a damage-over-time from this effect's source.
  | { kind: 'targetHasSourceDot' }
  // The target stands within `radius` of the resolved shape's center.
  | { kind: 'withinCenter'; radius: number };

export function evaluatePredicate(
  ctx: CombatCtx,
  sourceId: number,
  target: Unit,
  p: EffectPredicate,
  fx: EffectCtx,
): boolean {
  switch (p.kind) {
    case 'distanceAtLeast':
      return (fx.distance ?? 0) >= p.distance;
    case 'targetHpBelow':
      return target.maxHp > 0 && target.hp / target.maxHp < p.frac;
    case 'targetDying':
      return target.dead || target.hp <= 0 || ctx.dead.has(target.id);
    case 'targetIsolated': {
      for (const u of ctx.units.values()) {
        if (u.id === target.id || u.dead || ctx.dead.has(u.id)) continue;
        if (u.kind !== 'champion' || u.neutral || u.team !== target.team) continue;
        if (hypot(u.pos.x - target.pos.x, u.pos.z - target.pos.z) <= p.radius) return false;
      }
      return true;
    }
    case 'targetSlowed':
      return slowPct(target, ctx.time) > 0 || isRooted(target, ctx.time);
    case 'targetNearTerrain': {
      // Eight-direction sample ring: cheap, deterministic, and honest about
      // both map terrain and ability walls (walls block NavGrid cells).
      for (const [ux, uz] of TERRAIN_RING) {
        const x = target.pos.x + ux * p.distance;
        const z = target.pos.z + uz * p.distance;
        if (!ctx.nav.isWalkableAt(x, z)) return true;
      }
      return false;
    }
    case 'targetIsChampion':
      return target.kind === 'champion';
    case 'targetHasSourceDot':
      return target.statuses.some(
        (s) => s.kind === 'dot' && s.sourceId === sourceId && s.until > ctx.time,
      );
    case 'withinCenter': {
      if (!fx.center) return false;
      const d = hypot(target.pos.x - fx.center.x, target.pos.z - fx.center.z);
      return d <= p.radius + target.radius;
    }
  }
}

export type EffectSpec =
  // maxHpPct adds a fraction of the TARGET's max health, so a hit can keep
  // mattering against a health stack (tower shots, ADR 0003 dive punish).
  | {
      kind: 'damage';
      base: number;
      adRatio?: number;
      apRatio?: number;
      maxHpPct?: number;
      dtype: DamageType;
    }
  // maxHpPct heals a fraction of the TARGET's max health, so a flat heal
  // (Mend) can keep mattering at level 18 without a rank to scale on.
  | { kind: 'heal'; base: number; apRatio?: number; maxHpPct?: number }
  | { kind: 'slow'; pct: number; duration: number }
  | { kind: 'root'; duration: number }
  | { kind: 'stun'; duration: number }
  | { kind: 'taunt'; duration: number }
  | { kind: 'stealth'; duration: number }
  | { kind: 'blind'; duration: number; factor: number }
  // direction: 'away' from the source (default), 'aside' off the delivery's
  // travel line (kits-v2 knock-aside), or 'toCenter' of the resolved shape.
  | { kind: 'knockback'; distance: number; direction?: 'away' | 'aside' | 'toCenter' }
  | { kind: 'pull'; distance: number }
  | { kind: 'knockup'; duration: number }
  | { kind: 'untargetable'; duration: number }
  // burst: the shield detonates around its holder when broken by damage
  // (onBreak) or when it expires with value left (onExpire); see
  // combat/shield_burst.ts.
  | {
      kind: 'shield';
      base: number;
      apRatio?: number;
      duration: number;
      burst?: {
        radius: number;
        onBreak?: readonly EffectSpec[];
        onExpire?: readonly EffectSpec[];
      };
    }
  | { kind: 'dot'; duration: number; perSecond: number; dtype: DamageType }
  | { kind: 'grievous'; duration: number; factor: number }
  | { kind: 'buff'; duration: number; msPct?: number; asPct?: number; armor?: number; mr?: number }
  | {
      kind: 'mark';
      duration: number;
      stacksToTrigger: number;
      onTrigger: readonly EffectSpec[];
    }
  // Branches on a deterministic predicate at resolution time. (The true
  // branch is named `effects`, not `then`: a `then` property makes any
  // object thenable and trips await semantics plus the lint for it.)
  | {
      kind: 'conditional';
      when: EffectPredicate;
      effects: readonly EffectSpec[];
      otherwise?: readonly EffectSpec[];
    }
  // Refunds part of the SOURCE's remaining cooldown on `key` (kits-v2
  // cooldown events: aim and target selection become resources).
  | { kind: 'cooldownRefund'; key: AbilityKey; pctOfRemaining: number }
  // Arms the target's next auto attack within `duration` with rider
  // effects, optionally splashing around the struck victim.
  | {
      kind: 'empower';
      duration: number;
      bonus: readonly EffectSpec[];
      splashRadius?: number;
      splash?: readonly EffectSpec[];
    };

// Displaces a unit along dir by up to `distance`, clamped to walkable ground.
function displace(ctx: CombatCtx, target: Unit, dx: number, dz: number, distance: number): void {
  const len = hypot(dx, dz);
  if (len === 0 || target.moveSpeed <= 0) return;
  const dest = {
    x: target.pos.x + (dx / len) * distance,
    z: target.pos.z + (dz / len) * distance,
  };
  const landed = ctx.nav.isWalkableAt(dest.x, dest.z)
    ? dest
    : ctx.nav.nearestWalkable(dest.x, dest.z, 6);
  if (landed) target.pos = { x: landed.x, z: landed.z };
  target.path = [];
}

export function applyEffects(
  ctx: CombatCtx,
  sourceId: number,
  power: Power,
  target: Unit,
  specs: readonly EffectSpec[],
  via: DamageVia = 'ability',
  fx: EffectCtx = {},
): void {
  const scale = power.scale ?? 1;
  // Structures are immune to crowd control and displacement (review F.2:
  // towers could be stunned and even taunted).
  const structure = target.kind === 'tower' || target.kind === 'sanctum';
  // And they are immune to spells outright: a tower or a Sanctum falls to
  // attacks and to minions, never to an ability. One rule, one place, so
  // every delivery (skillshot, zone, dash, burst, chain, shield burst)
  // obeys it; auto-attack payloads come through with via 'attack'.
  if (structure && via === 'ability') return;
  for (const spec of specs) {
    if (
      structure &&
      (spec.kind === 'slow' ||
        spec.kind === 'root' ||
        spec.kind === 'stun' ||
        spec.kind === 'taunt' ||
        spec.kind === 'knockback' ||
        spec.kind === 'pull' ||
        spec.kind === 'knockup' ||
        spec.kind === 'blind')
    ) {
      continue;
    }
    switch (spec.kind) {
      case 'damage': {
        const amount =
          spec.base * scale +
          (spec.adRatio ?? 0) * power.ad +
          (spec.apRatio ?? 0) * power.ap +
          (spec.maxHpPct ?? 0) * target.maxHp;
        dealDamage(ctx, sourceId, target, amount, spec.dtype, via);
        break;
      }
      case 'heal': {
        if (target.dead || ctx.dead.has(target.id)) break;
        const amount =
          (spec.base * scale +
            (spec.apRatio ?? 0) * power.ap +
            (spec.maxHpPct ?? 0) * target.maxHp) *
          healFactor(target, ctx.time);
        target.hp = Math.min(target.maxHp, target.hp + amount);
        const source = ctx.units.get(sourceId);
        if (source && amount > 0) passiveOf(source)?.onHealGiven?.(ctx, source, target, amount);
        break;
      }
      case 'slow':
        addStatus(target, { kind: 'slow', until: ctx.time + spec.duration, pct: spec.pct });
        break;
      case 'root':
        addStatus(target, { kind: 'root', until: ctx.time + spec.duration });
        break;
      case 'stun':
        addStatus(target, { kind: 'stun', until: ctx.time + spec.duration });
        break;
      case 'taunt':
        addStatus(target, { kind: 'taunt', until: ctx.time + spec.duration, sourceId });
        break;
      case 'stealth':
        addStatus(target, { kind: 'stealth', until: ctx.time + spec.duration });
        break;
      case 'blind':
        addStatus(target, {
          kind: 'blind',
          until: ctx.time + spec.duration,
          factor: spec.factor,
        });
        break;
      case 'knockback': {
        const direction = spec.direction ?? 'away';
        if (direction === 'aside' && fx.lineFrom && fx.lineDir) {
          // Off the delivery's travel line: perpendicular, away from the
          // side of the line the target already stands on.
          const side =
            fx.lineDir.x * (target.pos.z - fx.lineFrom.z) -
            fx.lineDir.z * (target.pos.x - fx.lineFrom.x);
          const px = side >= 0 ? -fx.lineDir.z : fx.lineDir.z;
          const pz = side >= 0 ? fx.lineDir.x : -fx.lineDir.x;
          displace(ctx, target, px, pz, spec.distance);
        } else if (direction === 'toCenter' && fx.center) {
          displace(
            ctx,
            target,
            fx.center.x - target.pos.x,
            fx.center.z - target.pos.z,
            spec.distance,
          );
        } else {
          const source = ctx.units.get(sourceId);
          const from = source ? source.pos : target.pos;
          displace(ctx, target, target.pos.x - from.x, target.pos.z - from.z, spec.distance);
        }
        break;
      }
      case 'pull': {
        const source = ctx.units.get(sourceId);
        if (!source) break;
        const dx = source.pos.x - target.pos.x;
        const dz = source.pos.z - target.pos.z;
        const gap = hypot(dx, dz);
        const travel = Math.min(spec.distance, Math.max(0, gap - 1));
        if (travel > 0) displace(ctx, target, dx, dz, travel);
        break;
      }
      case 'knockup':
        // Airborne: acts as a stun in the rules, renders as a lift.
        addStatus(target, { kind: 'airborne', until: ctx.time + spec.duration });
        target.path = [];
        break;
      case 'untargetable':
        addStatus(target, { kind: 'untargetable', until: ctx.time + spec.duration });
        break;
      case 'shield': {
        // Grievous wounds cut shields like heals (review F.2).
        const value =
          (spec.base * scale + (spec.apRatio ?? 0) * power.ap) * healFactor(target, ctx.time);
        addStatus(target, {
          kind: 'shield',
          until: ctx.time + spec.duration,
          remaining: value,
          burst: spec.burst
            ? {
                radius: spec.burst.radius,
                onBreak: spec.burst.onBreak ?? [],
                onExpire: spec.burst.onExpire ?? [],
                sourceId,
                power: { ad: power.ad, ap: power.ap, scale },
              }
            : undefined,
        });
        break;
      }
      case 'dot':
        addStatus(target, {
          kind: 'dot',
          until: ctx.time + spec.duration,
          perSecond: spec.perSecond * scale,
          sourceId,
          dtype: spec.dtype,
        });
        break;
      case 'grievous':
        addStatus(target, {
          kind: 'grievous',
          until: ctx.time + spec.duration,
          factor: spec.factor,
        });
        break;
      case 'buff':
        addStatus(target, {
          kind: 'buff',
          until: ctx.time + spec.duration,
          msPct: spec.msPct ?? 0,
          asPct: spec.asPct ?? 0,
          armor: spec.armor ?? 0,
          mr: spec.mr ?? 0,
        });
        break;
      case 'mark': {
        const stacks = addMarkStack(target, spec.duration, ctx.time, sourceId);
        if (stacks >= spec.stacksToTrigger) {
          clearMarks(target, sourceId);
          applyEffects(ctx, sourceId, power, target, spec.onTrigger, via, fx);
        }
        break;
      }
      case 'conditional': {
        const hit = evaluatePredicate(ctx, sourceId, target, spec.when, fx);
        const branch = hit ? spec.effects : (spec.otherwise ?? []);
        if (branch.length > 0) applyEffects(ctx, sourceId, power, target, branch, via, fx);
        break;
      }
      case 'cooldownRefund': {
        const source = ctx.units.get(sourceId);
        if (source?.kind !== 'champion') break;
        const remaining = (source.cooldowns[spec.key] ?? 0) - ctx.time;
        if (remaining > 0) {
          source.cooldowns[spec.key] = ctx.time + remaining * (1 - spec.pctOfRemaining);
        }
        break;
      }
      case 'empower':
        addStatus(target, {
          kind: 'empower',
          until: ctx.time + spec.duration,
          bonus: spec.bonus,
          splashRadius: spec.splashRadius ?? 0,
          splash: spec.splash ?? [],
          scale,
        });
        break;
    }
  }
}
