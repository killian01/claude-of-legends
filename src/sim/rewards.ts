// Economy: passive income, kill bounties, and xp sharing by proximity.

import type { CombatCtx } from './sim_context';
import { gainXp } from './stats';
import { DT } from './types';
import type { Unit } from './unit';

export const PASSIVE_GOLD_START_AT = 10;
// 2.5/s, up from 2: items complete sooner, power spikes arrive earlier
// (pacing review).
export const PASSIVE_GOLD_PER_S = 2.5;
export const XP_SHARE_RADIUS = 14;

export function grantPassiveGold(ctx: CombatCtx): void {
  if (ctx.time < PASSIVE_GOLD_START_AT) return;
  for (const u of ctx.units.values()) {
    if (u.kind === 'champion' && !u.dead) u.gold += PASSIVE_GOLD_PER_S * DT;
  }
}

// Champion bounties snowball like the genre: a higher-level victim pays
// more, and a victim on a kill streak pays SHUTDOWN gold on top, so winning
// a fight against the fed enemy is a comeback lever and being fed matters.
export const CHAMPION_BOUNTY_BASE = 300;
export const CHAMPION_BOUNTY_PER_LEVEL = 25;
export const SHUTDOWN_PER_KILL = 60;
export const SHUTDOWN_STREAK_CAP = 5;

// Assisters split a pot on top of the killer's full bounty (snowball
// review, round 2: gold was strictly last-hit, so a won team fight paid one
// bot and the team's lead never materialized as items).
export const ASSIST_GOLD_FRAC = 0.5;

export function championBounty(victim: Unit): number {
  return (
    CHAMPION_BOUNTY_BASE +
    CHAMPION_BOUNTY_PER_LEVEL * (victim.level - 1) +
    SHUTDOWN_PER_KILL * Math.min(victim.killStreak, SHUTDOWN_STREAK_CAP)
  );
}

// Called once when a unit dies: gold to the killing champion, xp shared among
// enemy champions near the death.
export function grantKillRewards(ctx: CombatCtx, victim: Unit, killerId: number): void {
  const killer = ctx.units.get(killerId);
  const bounty = victim.kind === 'champion' ? championBounty(victim) : victim.goldBounty;
  if (bounty > 0) {
    if (killer && killer.kind === 'champion' && (victim.neutral || killer.team !== victim.team)) {
      killer.gold += bounty;
      ctx.events.push({ type: 'gold', unitId: killer.id, amount: bounty });
    }
  }
  // Champion kill xp scales with the victim's level, so taking down the fed
  // enemy accelerates your own spike (snowball review). A neutral victim
  // (the Warden) shares its xp among the KILLER's team nearby.
  const xpBounty = victim.kind === 'champion' ? 120 + 20 * victim.level : victim.xpBounty;
  if (xpBounty > 0) {
    const xpTeam = victim.neutral ? killer?.team : undefined;
    if (!victim.neutral || xpTeam !== undefined) {
      const nearby: Unit[] = [];
      for (const u of ctx.units.values()) {
        if (u.kind !== 'champion' || u.dead) continue;
        if (victim.neutral ? u.team !== xpTeam : u.team === victim.team) continue;
        const d = Math.hypot(u.pos.x - victim.pos.x, u.pos.z - victim.pos.z);
        if (d <= XP_SHARE_RADIUS) nearby.push(u);
      }
      if (nearby.length > 0) {
        const share = xpBounty / nearby.length;
        for (const u of nearby) gainXp(u, share);
      }
    }
  }
}
