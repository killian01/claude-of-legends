// Teams (ADR 0030): a match holds any number of them, two for the 5v5, one
// per champion in a free-for-all. An enemy is a unit of a different team
// (unit.ts hostile), and per-team records are sized by the team count. The
// systems only the 5v5 has (lanes, waves, towers, Sanctums, the fountain)
// still name the other side, and run only in a match of two teams.

import type { TeamId } from './types';

// The 5v5's team count, every match's default.
export const TWO_TEAMS = 2;

// A side of the two-team match: what the records only the 5v5 keeps in
// pairs (the matchmaker's, the Arena's) are indexed by.
export type Side = 0 | 1;

// A team that is one of those two sides.
export function isSide(team: TeamId): team is Side {
  return team === 0 || team === 1;
}

// The other side of a two-team match. Meaningless with more teams: the
// systems that ask it run only when there are exactly two.
export function otherTeam(team: TeamId): TeamId {
  return 1 - team;
}

// One fresh record per team, built in team order.
export function perTeam<T>(teamCount: number, make: (team: TeamId) => T): T[] {
  const out: T[] = [];
  for (let t = 0; t < teamCount; t++) out.push(make(t));
  return out;
}

// A team a match of `teamCount` teams holds: an integer in range.
export function validTeam(team: TeamId, teamCount: number): boolean {
  return Number.isInteger(team) && team >= 0 && team < teamCount;
}
