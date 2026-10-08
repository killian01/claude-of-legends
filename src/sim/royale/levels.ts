// Levels in the battle royale (ADR 0031): every champion lands at
// START_LEVEL with Q, W and E learned, and its spells rank themselves: a
// skill point goes to the ultimate whenever its level gate allows, else to
// the basic with the fewest ranks, ties in the house bots' order (Q, W,
// E), so the three basics climb in turn. Experience comes from takedowns
// and camps only, to the last hit, on the sim's own curve and bounties
// (stats.ts, rewards.ts), scaled so a champion who keeps fighting reaches
// its ultimate around the third or fourth minute and about level eleven by
// the end. In Respawn each assist on a takedown is paid a share of it too
// (assists.ts): a seat that helps and never lands the last hit still
// climbs instead of staying near its landing level all match, and the
// field's levels sit closer together.

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
import { type RoyaleVariant, START_LEVEL } from './types';

// The scale on the sim's bounties: a takedown and a camp body pay this
// many times what they pay in the 5v5. Respawn's takedowns come many times
// as often as One life's (nobody leaves for good), so each pays less, and
// less again since its assists are paid too: 0.75 alone, 0.45 beside
// them. The royale report over seeds 1 to 24: a Respawn takedown has 3.8
// assists; the final level median moves from 9 to 10, the tenth percentile
// from 5 to 8, the ninetieth stays 13, and of the four pairings with
// ASSIST_XP_SHARE measured, this one alone kept the stand-in's median life
// within a tenth of what it was.
export const TAKEDOWN_XP_SCALE: Readonly<Record<RoyaleVariant, number>> = {
  one_life: 2,
  respawn: 0.45,
};
export const CAMP_XP_SCALE = 2;
// An assist's share of what the takedown would have paid the assisting
// seat itself (takedownXp weighed by its own level): Respawn's, every seat
// alike, so about seven assists learn a takedown's worth; One life pays the
// last hit alone.
export const ASSIST_XP_SHARE: Readonly<Record<RoyaleVariant, number>> = {
  one_life: 0,
  respawn: 0.15,
};

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

// A Respawn drop-in's level (grace.ts arrive): a seat taken minutes in
// could be level 3 with nearly every champion above it, its first foe a
// level 6 with 2572 health against its 1487 (a playthrough). The seat
// comes down ARRIVAL_LEVEL_BEHIND under the middle of the field, the
// lower median of every other seat's level (the fallen too), and never
// below its own.
export const ARRIVAL_LEVEL_BEHIND = 1;

// The sorted values' lower middle (index floor((n - 1) / 2)); START_LEVEL
// for none.
export function lowerMedian(values: readonly number[]): number {
  if (values.length === 0) return START_LEVEL;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export function arrivalLevel(own: number, field: readonly number[]): number {
  return Math.max(own, lowerMedian(field) - ARRIVAL_LEVEL_BEHIND);
}

// Experience to a champion, its points spent at once; a fallen one (an
// assist paid while down) stays at no health. Returns the levels it rose
// (the mode offers the Grafts of the levels passed, grafts.ts).
export function grantXp(u: Unit, amount: number): number {
  if (u.kind !== 'champion' || amount <= 0) return 0;
  const from = u.level;
  gainXp(u, amount);
  spendSkillPoints(u);
  if (u.dead) u.hp = 0;
  return u.level - from;
}

// What a takedown pays its last hit: the victim's bounty, weighed by the
// victim's level over the killer's (a fed champion learns little from the
// weak, a low one much from the strong), within these bounds.
export const TAKEDOWN_XP_MIN_RATIO = 0.35;
export const TAKEDOWN_XP_MAX_RATIO = 1.5;

export function takedownXp(
  variant: RoyaleVariant,
  victimLevel: number,
  killerLevel = victimLevel,
): number {
  const ratio = victimLevel / Math.max(1, killerLevel);
  const weigh = Math.min(TAKEDOWN_XP_MAX_RATIO, Math.max(TAKEDOWN_XP_MIN_RATIO, ratio));
  return championXp(victimLevel) * TAKEDOWN_XP_SCALE[variant] * weigh;
}

// What an assist on a takedown pays the assisting seat: its share of what
// the takedown would have paid it.
export function assistXp(variant: RoyaleVariant, victimLevel: number, helperLevel: number): number {
  return takedownXp(variant, victimLevel, helperLevel) * ASSIST_XP_SHARE[variant];
}

// What a camp body or a big creature pays its last hit.
export function creatureXp(xpBounty: number): number {
  return xpBounty * CAMP_XP_SCALE;
}
