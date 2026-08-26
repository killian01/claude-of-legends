// The one damage pipeline: mitigation by armor or magic resist, shield
// absorption, hp loss, and death detection. Nothing else subtracts hp.

import type { DamageVia } from '../passive_types';
import { passiveOf } from '../passives';
import type { CombatCtx } from '../sim_context';
import { isInvulnerable } from '../structure_rules';
import type { DamageType } from '../types';
import type { Unit } from '../unit';
import { absorbWithShields, armorBonus, cancelRecall, mrBonus } from './status';

// Buff-granted armor/mr counts; expired statuses are pruned at tick start so
// no time parameter is needed here.
export function mitigationMultiplier(target: Unit, dtype: DamageType): number {
  if (dtype === 'physical') {
    return 100 / (100 + Math.max(0, target.stats.armor + armorBonus(target, 0)));
  }
  if (dtype === 'magic') {
    return 100 / (100 + Math.max(0, target.stats.mr + mrBonus(target, 0)));
  }
  return 1;
}

export function dealDamage(
  ctx: CombatCtx,
  sourceId: number,
  target: Unit,
  amount: number,
  dtype: DamageType,
  via: DamageVia = 'other',
): void {
  if (ctx.dead.has(target.id) || target.dead) return;
  if ((target.kind === 'tower' || target.kind === 'sanctum') && isInvulnerable(ctx.units, target)) {
    return;
  }
  // Source passive damage modifier (Opportunist, Deadstill, Heat...).
  const source = ctx.units.get(sourceId);
  if (source) {
    const passive = passiveOf(source);
    if (passive?.modifyDamage) {
      amount = passive.modifyDamage(ctx, source, target, amount, dtype, via);
    }
  }
  const mitigated = amount * mitigationMultiplier(target, dtype);
  // Shield-absorbed hits still count as taking damage (Shieldskin timing).
  if (mitigated > 0) target.lastDamagedAt = ctx.time;
  const after = absorbWithShields(target, mitigated, ctx.time);
  if (after <= 0) return;
  cancelRecall(target);
  // Aggro memory for the laning rules: towers and minions turn on a
  // champion that damages a nearby allied champion.
  if (target.kind === 'champion') {
    const source = ctx.units.get(sourceId);
    if (source && source.kind === 'champion' && source.team !== target.team) {
      target.lastHitByChampion = sourceId;
      target.lastHitAt = ctx.time;
    }
  }
  target.hp -= after;
  ctx.events.push({ type: 'damage', sourceId, targetId: target.id, amount: after, dtype });
  if (target.hp <= 0) {
    target.hp = 0;
    ctx.dead.add(target.id);
    ctx.killers.set(target.id, sourceId);
    ctx.events.push({ type: 'death', unitId: target.id, killerId: sourceId });
  }
}
