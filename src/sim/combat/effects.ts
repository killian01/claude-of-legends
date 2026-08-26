// The shared effect primitives every ability is composed from, and the one
// dispatcher that applies them. Content declares EffectSpec lists; nothing in
// content contains engine logic. Power (the caster's ad/ap) is snapshotted at
// cast time so a projectile in flight stays deterministic even if the caster
// dies before impact.

import type { CombatCtx } from '../sim_context';
import type { DamageType } from '../types';
import type { Unit } from '../unit';
import { dealDamage } from './damage';
import { addMarkStack, addStatus, clearMarks } from './status';

export interface Power {
  ad: number;
  ap: number;
}

export type EffectSpec =
  | { kind: 'damage'; base: number; adRatio?: number; apRatio?: number; dtype: DamageType }
  | { kind: 'slow'; pct: number; duration: number }
  | { kind: 'root'; duration: number }
  | { kind: 'shield'; base: number; apRatio?: number; duration: number }
  | {
      kind: 'mark';
      duration: number;
      stacksToTrigger: number;
      onTrigger: readonly EffectSpec[];
    };

export function applyEffects(
  ctx: CombatCtx,
  sourceId: number,
  power: Power,
  target: Unit,
  specs: readonly EffectSpec[],
): void {
  for (const spec of specs) {
    switch (spec.kind) {
      case 'damage': {
        const amount = spec.base + (spec.adRatio ?? 0) * power.ad + (spec.apRatio ?? 0) * power.ap;
        dealDamage(ctx, sourceId, target, amount, spec.dtype);
        break;
      }
      case 'slow':
        addStatus(target, { kind: 'slow', until: ctx.time + spec.duration, pct: spec.pct });
        break;
      case 'root':
        addStatus(target, { kind: 'root', until: ctx.time + spec.duration });
        break;
      case 'shield': {
        const value = spec.base + (spec.apRatio ?? 0) * power.ap;
        addStatus(target, {
          kind: 'shield',
          until: ctx.time + spec.duration,
          remaining: value,
        });
        break;
      }
      case 'mark': {
        const stacks = addMarkStack(target, spec.duration, ctx.time);
        if (stacks >= spec.stacksToTrigger) {
          clearMarks(target);
          applyEffects(ctx, sourceId, power, target, spec.onTrigger);
        }
        break;
      }
    }
  }
}
