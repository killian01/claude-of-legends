// The one damage pipeline: mitigation by armor or magic resist, shield
// absorption, hp loss, and death detection. Nothing else subtracts hp.

import type { CombatCtx } from '../sim_context';
import type { DamageType } from '../types';
import type { Unit } from '../unit';
import { absorbWithShields } from './status';

export function mitigationMultiplier(target: Unit, dtype: DamageType): number {
  if (dtype === 'physical') return 100 / (100 + Math.max(0, target.stats.armor));
  if (dtype === 'magic') return 100 / (100 + Math.max(0, target.stats.mr));
  return 1;
}

export function dealDamage(
  ctx: CombatCtx,
  sourceId: number,
  target: Unit,
  amount: number,
  dtype: DamageType,
): void {
  if (ctx.dead.has(target.id)) return;
  const mitigated = amount * mitigationMultiplier(target, dtype);
  const after = absorbWithShields(target, mitigated, ctx.time);
  if (after <= 0) return;
  target.hp -= after;
  ctx.events.push({ type: 'damage', sourceId, targetId: target.id, amount: after, dtype });
  if (target.hp <= 0) {
    target.hp = 0;
    ctx.dead.add(target.id);
    ctx.events.push({ type: 'death', unitId: target.id, killerId: sourceId });
  }
}
