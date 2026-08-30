// Team-wide buffs that SURVIVE death, kept outside Unit on purpose: respawn
// wipes u.statuses, which is exactly backwards for an objective reward
// (systems review). v1 holds one buff, the Warden's Boon: a percent damage
// bonus with a duration and a stack cap.

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

export class TeamBuffs {
  private readonly boons: [TeamBuff, TeamBuff] = [
    { until: 0, stacks: 0 },
    { until: 0, stacks: 0 },
  ];

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
