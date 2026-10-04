// Team-wide buffs that SURVIVE death, kept outside Unit on purpose: respawn
// wipes u.statuses, which is exactly backwards for an objective reward
// (systems review). Two buffs: the Warden's Boon, a percent damage bonus
// with a duration and a stack cap, and the Wrath (CONTEXT.md), what an
// Ascendant's death hands over: a duration only, refreshed and never
// stacked; what it does lives in the damage pipeline (combat/damage.ts).

import { WRATH_DURATION_S } from './content/rings';
import { perTeam, TWO_TEAMS, validTeam } from './teams';
import type { TeamId } from './types';

export const BOON_DAMAGE_PER_STACK = 0.08;
// 180 s, up from 120: longer than the Warden's respawn clock, so a team
// that keeps winning the pit can actually reach the second stack (at 120 s
// against a 240 s respawn the cap was unreachable through play).
export const BOON_DURATION_S = 180;
export const BOON_MAX_STACKS = 2;

export interface TeamBuff {
  until: number;
  stacks: number;
}

// One entry per team, in team order (ADR 0030).
export interface TeamBuffsState {
  boons: TeamBuff[];
  wraths: number[];
}

export class TeamBuffs {
  private readonly boons: TeamBuff[];
  // When each team's Wrath ends; zero or past means none.
  private readonly wraths: number[];

  constructor(teamCount = TWO_TEAMS) {
    this.boons = perTeam(teamCount, () => ({ until: 0, stacks: 0 }));
    this.wraths = perTeam(teamCount, () => 0);
  }

  // The buffs as plain data, for a world checkpoint (src/sim/snapshot.ts).
  snapshot(): TeamBuffsState {
    return {
      boons: this.boons.map((b) => ({ ...b })),
      wraths: [...this.wraths],
    };
  }

  restore(state: TeamBuffsState): void {
    for (const [team, b] of this.boons.entries()) {
      const saved = state.boons[team];
      if (saved) Object.assign(b, saved);
    }
    for (const team of this.wraths.keys()) this.wraths[team] = state.wraths[team] ?? 0;
  }

  // A team the match does not hold takes nothing and holds nothing. The
  // battle royale hands its own length (royale/risings.ts).
  grantWrath(team: TeamId, time: number, duration = WRATH_DURATION_S): void {
    if (validTeam(team, this.wraths.length)) this.wraths[team] = time + duration;
  }

  // The Wrath held until `until` exactly (a passing on the planet carries
  // what was left), and taken away (its holder fell).
  setWrath(team: TeamId, until: number): void {
    if (validTeam(team, this.wraths.length)) this.wraths[team] = until;
  }

  clearWrath(team: TeamId): void {
    if (validTeam(team, this.wraths.length)) this.wraths[team] = 0;
  }

  // When the team's Wrath ends, null when it holds none.
  wrathUntil(team: TeamId, time: number): number | null {
    const until = this.wraths[team] ?? 0;
    return until > time ? until : null;
  }

  grantBoon(team: TeamId, time: number): void {
    const b = this.boons[team];
    if (!b) return;
    b.stacks = b.until > time ? Math.min(BOON_MAX_STACKS, b.stacks + 1) : 1;
    b.until = time + BOON_DURATION_S;
  }

  boon(team: TeamId, time: number): TeamBuff | null {
    const b = this.boons[team];
    return b && b.until > time ? b : null;
  }

  // The damage multiplier a unit of `team` deals with right now.
  damageMultiplier(team: TeamId, time: number): number {
    const b = this.boon(team, time);
    return b ? 1 + BOON_DAMAGE_PER_STACK * b.stacks : 1;
  }
}
