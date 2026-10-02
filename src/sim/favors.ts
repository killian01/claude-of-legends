// The favors (CONTEXT.md: Favor): what a team holds for the rest of the
// match from the creatures it has slain, per aspect, in stacks. Kept
// beside the Warden's Boon (team_buffs.ts) rather than inside it: the Boon
// is temporary and one, a favor is permanent and six. The team record here
// is the truth; every champion of the team carries a mirror of it
// (Unit.favors) because the stat recalculation, the effective speed and
// the effect seam are functions of the unit alone, and the sim refreshes
// the mirrors whenever a favor is granted (sim.ts grantFavor).

import {
  ASPECT_IDS,
  ASPECTS,
  type AspectId,
  FAVOR_MAX_STACKS,
  OUT_OF_COMBAT_S,
} from './content/rings';
import { perTeam, TWO_TEAMS } from './teams';
import type { TeamId } from './types';

export type FavorStacks = Readonly<Record<AspectId, number>>;

export const NO_FAVORS: FavorStacks = Object.freeze({
  might: 0,
  tide: 0,
  tempo: 0,
  bulwark: 0,
  swiftness: 0,
  resolve: 0,
});

// What a team's stacks of one aspect are worth right now, as a fraction:
// stacks times the aspect's number per stack.
export function favorBonus(stacks: FavorStacks, aspect: AspectId): number {
  return stacks[aspect] * ASPECTS[aspect].perStack;
}

export function hasAnyFavor(stacks: FavorStacks): boolean {
  return ASPECT_IDS.some((id) => stacks[id] > 0);
}

// Out of combat (Swiftness): neither hit nor hitting for five seconds.
export function outOfCombat(
  u: { lastDamagedAt: number; lastDealtDamageAt: number },
  time: number,
): boolean {
  return time - u.lastDamagedAt > OUT_OF_COMBAT_S && time - u.lastDealtDamageAt > OUT_OF_COMBAT_S;
}

// One record per team, in team order (ADR 0030).
export class Favors {
  private readonly held: Record<AspectId, number>[];

  constructor(teamCount = TWO_TEAMS) {
    this.held = perTeam(teamCount, () => ({ ...NO_FAVORS }));
  }

  // The stacks as plain data, for a world checkpoint (src/sim/snapshot.ts).
  snapshot(): FavorStacks[] {
    return this.held.map((h) => ({ ...h }));
  }

  restore(held: readonly FavorStacks[]): void {
    for (const [team, h] of this.held.entries()) Object.assign(h, held[team] ?? NO_FAVORS);
  }

  // One more stack of the aspect for the team, up to the cap; returns the
  // stacks held after. A team the match does not hold takes nothing.
  grant(team: TeamId, aspect: AspectId): number {
    const h = this.held[team];
    if (!h) return 0;
    h[aspect] = Math.min(FAVOR_MAX_STACKS, h[aspect] + 1);
    return h[aspect];
  }

  // A frozen copy of the team's stacks: what a unit mirrors.
  stacks(team: TeamId): FavorStacks {
    const h = this.held[team];
    return h ? Object.freeze({ ...h }) : NO_FAVORS;
  }
}
