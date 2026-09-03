// The fight's odds (plan-bots phase 16): how a fight stands before it is
// taken, from what the team sees. Each champion weighs by its health and
// its level (a full-health level 18 counts about twice a level 1); the
// bot's side, itself included, is summed against the enemy's within the
// radius, and the odds are the bot's share of the total: 0.5 is an even
// fight, 1 nobody to fight. Pure over the slot context, like every trigger.
// The odds trigger reads it, and the fight's commit walks in only above it.

import type { SlotContext } from './micro';

// The radius the odds are read in when a play states none: the fight's
// target radius is 25; a champion 20 away arrives in the time a fight takes
// to turn.
export const ODDS_RADIUS = 20;
// A level's weight: seventeen levels double a champion's count.
export const LEVEL_WEIGHT = 1 / 17;

// One champion's weight in a fight: its health fraction, scaled by level.
export function strengthOf(hpFrac: number, level: number | undefined): number {
  return Math.max(0, hpFrac) * (1 + (Math.max(1, level ?? 1) - 1) * LEVEL_WEIGHT);
}

export function fightOdds(ctx: SlotContext, within = ODDS_RADIUS): number {
  const { s, obs } = ctx;
  let own = strengthOf(s.hpFrac, s.level);
  let enemy = 0;
  for (const u of obs.units) {
    if (u.kind !== 'champion') continue;
    if (Math.hypot(u.x - s.x, u.z - s.z) > within) continue;
    if (u.friendly) own += strengthOf(u.hpFrac, u.level);
    else enemy += strengthOf(u.hpFrac, u.level);
  }
  const total = own + enemy;
  return total > 0 ? own / total : 0.5;
}
