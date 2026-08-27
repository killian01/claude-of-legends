// The shared effect primitives every ability is composed from, and the one
// dispatcher that applies them. Content declares EffectSpec lists; nothing in
// content contains engine logic. Power (the caster's ad/ap) is snapshotted at
// cast time so a projectile in flight stays deterministic even if the caster
// dies before impact.

import type { DamageVia } from '../passive_types';
import { passiveOf } from '../passives';
import type { CombatCtx } from '../sim_context';
import type { DamageType } from '../types';
import type { Unit } from '../unit';
import { dealDamage } from './damage';
import { addMarkStack, addStatus, clearMarks, healFactor } from './status';

export interface Power {
  ad: number;
  ap: number;
  // Rank multiplier applied to BASE amounts (damage, heal, shield, dot).
  scale?: number;
}

export type EffectSpec =
  | { kind: 'damage'; base: number; adRatio?: number; apRatio?: number; dtype: DamageType }
  // maxHpPct heals a fraction of the TARGET's max health, so a flat heal
  // (Mend) can keep mattering at level 18 without a rank to scale on.
  | { kind: 'heal'; base: number; apRatio?: number; maxHpPct?: number }
  | { kind: 'slow'; pct: number; duration: number }
  | { kind: 'root'; duration: number }
  | { kind: 'stun'; duration: number }
  | { kind: 'taunt'; duration: number }
  | { kind: 'stealth'; duration: number }
  | { kind: 'blind'; duration: number; factor: number }
  | { kind: 'knockback'; distance: number }
  | { kind: 'pull'; distance: number }
  | { kind: 'knockup'; duration: number }
  | { kind: 'untargetable'; duration: number }
  | { kind: 'shield'; base: number; apRatio?: number; duration: number }
  | { kind: 'dot'; duration: number; perSecond: number; dtype: DamageType }
  | { kind: 'grievous'; duration: number; factor: number }
  | { kind: 'buff'; duration: number; msPct?: number; asPct?: number; armor?: number; mr?: number }
  | {
      kind: 'mark';
      duration: number;
      stacksToTrigger: number;
      onTrigger: readonly EffectSpec[];
    };

// Displaces a unit along dir by up to `distance`, clamped to walkable ground.
function displace(ctx: CombatCtx, target: Unit, dx: number, dz: number, distance: number): void {
  const len = Math.hypot(dx, dz);
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
): void {
  const scale = power.scale ?? 1;
  // Structures are immune to crowd control and displacement (review F.2:
  // towers could be stunned and even taunted).
  const structure = target.kind === 'tower' || target.kind === 'sanctum';
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
          spec.base * scale + (spec.adRatio ?? 0) * power.ad + (spec.apRatio ?? 0) * power.ap;
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
        const source = ctx.units.get(sourceId);
        const from = source ? source.pos : target.pos;
        displace(ctx, target, target.pos.x - from.x, target.pos.z - from.z, spec.distance);
        break;
      }
      case 'pull': {
        const source = ctx.units.get(sourceId);
        if (!source) break;
        const dx = source.pos.x - target.pos.x;
        const dz = source.pos.z - target.pos.z;
        const gap = Math.hypot(dx, dz);
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
          applyEffects(ctx, sourceId, power, target, spec.onTrigger);
        }
        break;
      }
    }
  }
}
