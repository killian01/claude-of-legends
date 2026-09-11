// Team-wide buffs that SURVIVE death, kept outside Unit on purpose: respawn
// wipes u.statuses, which is exactly backwards for an objective reward
// (systems review). Two buffs: the Warden's Boon, a percent damage bonus
// with a duration and a stack cap, and the Wrath (CONTEXT.md), what an
// Ascendant's death hands over: a duration only, refreshed and never
// stacked; what it does lives in the damage pipeline (combat/damage.ts).

import { WRATH_DURATION_S } from './content/rings';
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

export interface TeamBuffsState {
  boons: [TeamBuff, TeamBuff];
  wraths: [number, number];
}

export class TeamBuffs {
  private readonly boons: [TeamBuff, TeamBuff] = [
    { until: 0, stacks: 0 },
    { until: 0, stacks: 0 },
  ];
  // When each team's Wrath ends; zero or past means none.
  private readonly wraths: [number, number] = [0, 0];

  // The buffs as plain data, for a world checkpoint (src/sim/snapshot.ts).
  snapshot(): TeamBuffsState {
    return {
      boons: [{ ...this.boons[0] }, { ...this.boons[1] }],
      wraths: [this.wraths[0], this.wraths[1]],
    };
  }

  restore(state: TeamBuffsState): void {
    Object.assign(this.boons[0], state.boons[0]);
    Object.assign(this.boons[1], state.boons[1]);
    this.wraths[0] = state.wraths[0];
    this.wraths[1] = state.wraths[1];
  }

  grantWrath(team: TeamId, time: number): void {
    this.wraths[team] = time + WRATH_DURATION_S;
  }

  // When the team's Wrath ends, null when it holds none.
  wrathUntil(team: TeamId, time: number): number | null {
    const until = this.wraths[team];
    return until > time ? until : null;
  }

  grantBoon(team: TeamId, time: number): void {
    const b = this.boons[team];
    b.stacks = b.until > time ? Math.min(BOON_MAX_STACKS, b.stacks + 1) : 1;
    b.until = time + BOON_DURATION_S;
  }

  boon(team: TeamId, time: number): TeamBuff | null {
    const b = this.boons[team];
    return b.until > time ? b : null;
  }

  // The damage multiplier a unit of `team` deals with right now.
  damageMultiplier(team: TeamId, time: number): number {
    const b = this.boon(team, time);
    return b ? 1 + BOON_DAMAGE_PER_STACK * b.stacks : 1;
  }
}
