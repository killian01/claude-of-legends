// The one damage pipeline: mitigation by armor or magic resist (less the
// attacker's penetration), shield absorption, hp loss, and death detection
// with champion kill credit. Nothing else subtracts hp.

// How long a champion's damage keeps kill credit over an executing minion.
export const KILL_CREDIT_WINDOW_S = 10;

import type { DamageVia } from '../passive_types';
import { passiveOf } from '../passives';
import type { CombatCtx } from '../sim_context';
import { isInvulnerable } from '../structure_rules';
import type { DamageType } from '../types';
import type { Unit } from '../unit';
import { absorbWithShields, armorBonus, cancelRecall, mrBonus } from './status';

// Buff-granted armor/mr counts; expired statuses are pruned at tick start so
// no time parameter is needed here. Percent penetration shreds the resist
// first, then flat pen subtracts; a resist never drops below zero.
export function mitigationMultiplier(
  target: Unit,
  dtype: DamageType,
  penFlat = 0,
  penPct = 0,
): number {
  if (dtype === 'physical') {
    const armor = target.stats.armor + armorBonus(target, 0);
    return 100 / (100 + Math.max(0, armor * (1 - penPct) - penFlat));
  }
  if (dtype === 'magic') {
    const mr = target.stats.mr + mrBonus(target, 0);
    return 100 / (100 + Math.max(0, mr * (1 - penPct) - penFlat));
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
  const penFlat =
    source === undefined ? 0 : dtype === 'physical' ? source.stats.armorPen : source.stats.mrPen;
  const penPct =
    source === undefined
      ? 0
      : dtype === 'physical'
        ? source.stats.armorPenPct
        : source.stats.mrPenPct;
  const mitigated = amount * mitigationMultiplier(target, dtype, penFlat, penPct);
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
      // Assist bookkeeping: newest hit time per enemy champion, insertion
      // order preserved for determinism.
      const seen = target.recentDamagers.find((r) => r.id === sourceId);
      if (seen) seen.at = ctx.time;
      else target.recentDamagers.push({ id: sourceId, at: ctx.time });
    }
  }
  target.hp -= after;
  ctx.events.push({ type: 'damage', sourceId, targetId: target.id, amount: after, dtype });
  if (target.hp <= 0) {
    target.hp = 0;
    ctx.dead.add(target.id);
    // A minion or tower executing a champion does not steal the kill: the
    // last enemy CHAMPION to damage the victim inside the credit window
    // takes it, like the genre.
    let creditId = sourceId;
    const executor = ctx.units.get(sourceId);
    if (
      target.kind === 'champion' &&
      (!executor || executor.kind !== 'champion' || executor.team === target.team)
    ) {
      const contributor = ctx.units.get(target.lastHitByChampion);
      if (
        contributor &&
        contributor.kind === 'champion' &&
        contributor.team !== target.team &&
        ctx.time - target.lastHitAt <= KILL_CREDIT_WINDOW_S
      ) {
        creditId = contributor.id;
      }
    }
    ctx.killers.set(target.id, creditId);
    ctx.events.push({ type: 'death', unitId: target.id, killerId: creditId });
  }
}
