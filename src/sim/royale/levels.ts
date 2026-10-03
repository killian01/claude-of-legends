// Levels in the battle royale (ADR 0031): every champion lands at
// START_LEVEL with Q, W and E learned, and its spells rank themselves: a
// skill point goes to the ultimate whenever its level gate allows, else to
// the basic with the fewest ranks, ties in the house bots' order (Q, W,
// E), so the three basics climb in turn. Experience comes from takedowns
// and camps only, all of it to the last hit, on the sim's own curve and
// bounties (stats.ts, rewards.ts), scaled so a champion who keeps fighting
// reaches its ultimate around the third or fourth minute and about level
// eleven by the end.

import { DEFAULT_SKILLS } from '../playbook/kit';
import { championXp } from '../rewards';
import {
  BASIC_MAX_RANK,
  effectiveRank,
  gainXp,
  levelTo,
  ULT_MAX_RANK,
  ULT_RANK_LEVELS,
} from '../stats';
import type { Unit } from '../unit';
import { START_LEVEL } from './types';

// The scale on the sim's bounties: a takedown and a camp body pay this
// many times what they pay in the 5v5.
export const TAKEDOWN_XP_SCALE = 2;
export const CAMP_XP_SCALE = 2;

// Spends every skill point the champion holds, as the rule above says.
export function spendSkillPoints(u: Unit): void {
  if (u.kind !== 'champion') return;
  while (u.skillPoints > 0) {
    // The sim's own gate (Sim.levelAbility): the ultimate's first rank is
    // free from level 6, a point raises it at 11 and 16.
    const r = effectiveRank(u, 'R');
    const gate = ULT_RANK_LEVELS[r];
    if (r < ULT_MAX_RANK && gate !== undefined && u.level >= gate) {
      u.abilityRanks.R = r + 1;
      u.skillPoints -= 1;
      continue;
    }
    let pick: 'Q' | 'W' | 'E' | null = null;
    for (const key of DEFAULT_SKILLS) {
      const rank = u.abilityRanks[key] ?? 0;
      if (rank >= BASIC_MAX_RANK) continue;
      if (pick === null || rank < (u.abilityRanks[pick] ?? 0)) pick = key;
    }
    if (pick === null) return;
    u.abilityRanks[pick] = (u.abilityRanks[pick] ?? 0) + 1;
    u.skillPoints -= 1;
  }
}

// A champion as it lands: walked up the curve to START_LEVEL (each level's
// point and stats as a match grants them), the points spent.
export function landingLevels(u: Unit): void {
  levelTo(u, START_LEVEL);
  spendSkillPoints(u);
}

// Experience to a champion, its points spent at once.
export function grantXp(u: Unit, amount: number): void {
  if (u.kind !== 'champion' || amount <= 0) return;
  gainXp(u, amount);
  spendSkillPoints(u);
}

// What a takedown pays its last hit: the victim's bounty, weighed by the
// victim's level over the killer's (a fed champion learns little from the
// weak, a low one much from the strong), within these bounds.
export const TAKEDOWN_XP_MIN_RATIO = 0.35;
export const TAKEDOWN_XP_MAX_RATIO = 1.5;

export function takedownXp(victimLevel: number, killerLevel = victimLevel): number {
  const ratio = victimLevel / Math.max(1, killerLevel);
  const weigh = Math.min(TAKEDOWN_XP_MAX_RATIO, Math.max(TAKEDOWN_XP_MIN_RATIO, ratio));
  return championXp(victimLevel) * TAKEDOWN_XP_SCALE * weigh;
}

// What a camp body or a big creature pays its last hit.
export function creatureXp(xpBounty: number): number {
  return xpBounty * CAMP_XP_SCALE;
}
