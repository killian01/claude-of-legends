// The shared effect primitives every ability is composed from, and the one
// dispatcher that applies them. Content declares EffectSpec lists; nothing in
// content contains engine logic. Power (the caster's ad/ap) is snapshotted at
// cast time so a projectile in flight stays deterministic even if the caster
// dies before impact.

import { favorBonus } from '../favors';
import {
  away,
  carry,
  copy,
  cross,
  delta,
  dist,
  norm,
  offset,
  tangent,
  turnLeft,
  turnRight,
  unit,
} from '../geo';
import { landingOn } from '../ground';
import type { DamageVia } from '../passive_types';
import { passiveOf } from '../passives';
import type { CombatCtx } from '../sim_context';
import type { AbilityKey, DamageType, Vec2 } from '../types';
import type { Unit } from '../unit';
import { dealDamage } from './damage';
import { addMarkStack, addStatus, clearMarks, healFactor, isRooted, slowPct } from './status';

// The eight compass directions as unit vectors, every 45 degrees: the
// constants are exact, where the engine's cosine of a multiple of PI/4
// is not (src/sim/exact.ts). East and north components: on the sphere
// they are read in the tangent frame at the target (geo.ts, tangent).
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
// On the sphere the points carry y like every ground point (ADR 0029), and
// lineDir may be the heading at lineFrom or further along the same great
// circle: the knock-aside reads it back at lineFrom.
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
      // In a free-for-all nobody has an ally, so every target would always
      // be a stray: there, isolated means no other champion near at all,
      // the source aside (a playtest, 2026-10-03: Fenn's Twin Fangs always
      // took their isolation bonus and he won most matches).
      for (const u of ctx.units.values()) {
        if (u.id === target.id || u.dead || ctx.dead.has(u.id)) continue;
        if (u.kind !== 'champion' || u.neutral) continue;
        if (ctx.freeForAll ? u.id === sourceId : u.team !== target.team) continue;
        if (dist(u.pos, target.pos) <= p.radius) return false;
      }
      return true;
    }
    case 'targetSlowed':
      return slowPct(target, ctx.time) > 0 || isRooted(target, ctx.time);
    case 'targetNearTerrain': {
      // Eight-direction sample ring: cheap, deterministic, and honest about
      // both map terrain and ability walls (both block the ground's cells).
      for (const [ux, uz] of TERRAIN_RING) {
        const at = offset(target.pos, tangent(target.pos, ux, uz), p.distance);
        if (!ctx.ground.isWalkableAt(at)) return true;
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
      return dist(target.pos, fx.center) <= p.radius + target.radius;
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
  // The target's basic attacks miss for `duration` (CONTEXT.md: Fumble).
  | { kind: 'fumble'; duration: number }
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
  // perSecond grows with the rank like any base amount, plus the source's
  // power by the ratios. refresh: one such dot per source on a target, a
  // new one renewing it (the larger rate, the later end) instead of
  // stacking beside it (Nisk's Bittertip: a poison every hit refreshes).
  | {
      kind: 'dot';
      duration: number;
      perSecond: number;
      adRatio?: number;
      apRatio?: number;
      dtype: DamageType;
      refresh?: boolean;
    }
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
  // effects, optionally splashing around the struck victim; `hits` arms
  // that many attacks inside the window instead of one.
  | {
      kind: 'empower';
      duration: number;
      bonus: readonly EffectSpec[];
      splashRadius?: number;
      splash?: readonly EffectSpec[];
      hits?: number;
    };

// Displaces a unit along v (a vector at its position, any length) by up to
// `distance`, clamped to walkable ground. On the sphere the push follows
// the great circle, so the unit lands on the sphere.
function displace(ctx: CombatCtx, target: Unit, v: Vec2, distance: number): void {
  const dir = unit(v);
  if (dir === null || target.moveSpeed <= 0) return;
  const landed = landingOn(ctx.ground, offset(target.pos, dir, distance), 6);
  if (landed) target.pos = copy(landed);
  target.path = [];
}

// The knock-aside's push: perpendicular to the delivery's line, toward the
// side of it the target already stands on. On the sphere the line is a
// great circle: its heading is read back at lineFrom (carry), its left
// side is the circle's normal, and the push is that normal at the target.
function asidePush(target: Unit, lineFrom: Vec2, lineDir: Vec2): Vec2 {
  const heading = carry(lineDir, lineFrom, lineFrom);
  const side = cross(heading, delta(lineFrom, target.pos), lineFrom);
  const push = side >= 0 ? turnLeft(heading, lineFrom) : turnRight(heading, lineFrom);
  return carry(push, lineFrom, target.pos);
}

// Resolve (CONTEXT.md: Favor): the target's tenacity shortens a stun, a
// root, a taunt or a slow it suffers, never a knockup; the source's heal
// and shield power grows what it heals and shields.
function held(target: Unit, duration: number): number {
  return duration * (1 - favorBonus(target.favors, 'resolve'));
}

function healPower(ctx: CombatCtx, sourceId: number): number {
  const source = ctx.units.get(sourceId);
  return source ? 1 + favorBonus(source.favors, 'resolve') : 1;
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
        spec.kind === 'blind' ||
        spec.kind === 'fumble')
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
          healFactor(target, ctx.time) *
          healPower(ctx, sourceId);
        target.hp = Math.min(target.maxHp, target.hp + amount);
        const source = ctx.units.get(sourceId);
        if (source && amount > 0) passiveOf(source)?.onHealGiven?.(ctx, source, target, amount);
        break;
      }
      case 'slow':
        addStatus(target, {
          kind: 'slow',
          until: ctx.time + held(target, spec.duration),
          pct: spec.pct,
        });
        break;
      case 'root':
        addStatus(target, { kind: 'root', until: ctx.time + held(target, spec.duration) });
        break;
      case 'stun':
        addStatus(target, { kind: 'stun', until: ctx.time + held(target, spec.duration) });
        break;
      case 'taunt':
        addStatus(target, {
          kind: 'taunt',
          until: ctx.time + held(target, spec.duration),
          sourceId,
        });
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
      case 'fumble':
        addStatus(target, { kind: 'fumble', until: ctx.time + held(target, spec.duration) });
        break;
      case 'knockback': {
        const direction = spec.direction ?? 'away';
        if (direction === 'aside' && fx.lineFrom && fx.lineDir) {
          // Off the delivery's travel line: perpendicular, away from the
          // side of the line the target already stands on.
          displace(ctx, target, asidePush(target, fx.lineFrom, fx.lineDir), spec.distance);
        } else if (direction === 'toCenter' && fx.center) {
          displace(ctx, target, delta(target.pos, fx.center), spec.distance);
        } else {
          const source = ctx.units.get(sourceId);
          const from = source ? source.pos : target.pos;
          displace(ctx, target, away(target.pos, from), spec.distance);
        }
        break;
      }
      case 'pull': {
        const source = ctx.units.get(sourceId);
        if (!source) break;
        const toward = delta(target.pos, source.pos);
        const travel = Math.min(spec.distance, Math.max(0, norm(toward) - 1));
        if (travel > 0) displace(ctx, target, toward, travel);
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
          (spec.base * scale + (spec.apRatio ?? 0) * power.ap) *
          healFactor(target, ctx.time) *
          healPower(ctx, sourceId);
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
      case 'dot': {
        const perSecond =
          spec.perSecond * scale + (spec.adRatio ?? 0) * power.ad + (spec.apRatio ?? 0) * power.ap;
        const until = ctx.time + spec.duration;
        if (spec.refresh) {
          const live = target.statuses.find(
            (s) =>
              s.kind === 'dot' &&
              s.sourceId === sourceId &&
              s.tag === 'refresh' &&
              s.until > ctx.time,
          );
          if (live && live.kind === 'dot') {
            live.until = Math.max(live.until, until);
            live.perSecond = Math.max(live.perSecond, perSecond);
            break;
          }
        }
        addStatus(target, {
          kind: 'dot',
          until,
          perSecond,
          sourceId,
          dtype: spec.dtype,
          ...(spec.refresh ? { tag: 'refresh' as const } : {}),
        });
        break;
      }
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
          hits: Math.max(1, spec.hits ?? 1),
        });
        break;
    }
  }
}
