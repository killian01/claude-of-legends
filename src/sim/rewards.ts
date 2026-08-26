// Economy: passive income, kill bounties, and xp sharing by proximity.

import type { CombatCtx } from './sim_context';
import { gainXp } from './stats';
import { DT } from './types';
import type { Unit } from './unit';

export const PASSIVE_GOLD_START_AT = 10;
export const PASSIVE_GOLD_PER_S = 2;
export const XP_SHARE_RADIUS = 14;

export function grantPassiveGold(ctx: CombatCtx): void {
  if (ctx.time < PASSIVE_GOLD_START_AT) return;
  for (const u of ctx.units.values()) {
    if (u.kind === 'champion' && !u.dead) u.gold += PASSIVE_GOLD_PER_S * DT;
  }
}

// Called once when a unit dies: gold to the killing champion, xp shared among
// enemy champions near the death.
export function grantKillRewards(ctx: CombatCtx, victim: Unit, killerId: number): void {
  if (victim.goldBounty > 0) {
    const killer = ctx.units.get(killerId);
    if (killer && killer.kind === 'champion' && killer.team !== victim.team) {
      killer.gold += victim.goldBounty;
    }
  }
  if (victim.xpBounty > 0) {
    const nearby: Unit[] = [];
    for (const u of ctx.units.values()) {
      if (u.kind !== 'champion' || u.dead || u.team === victim.team) continue;
      const d = Math.hypot(u.pos.x - victim.pos.x, u.pos.z - victim.pos.z);
      if (d <= XP_SHARE_RADIUS) nearby.push(u);
    }
    if (nearby.length > 0) {
      const share = victim.xpBounty / nearby.length;
      for (const u of nearby) gainXp(u, share);
    }
  }
}
