// Team Elo for a mostly-bot MOBA, pure and pinned by tests. The policy
// (meta-game review): a match is RATED only when each team holds at least
// one human seat; bot seats neither gain nor lose. Ratings meet as team
// averages, and K scales with how many humans actually played, so a 1v1
// with eight bots moves a rating far less than a full 5v5 of people.

import type { TeamId } from '../src/sim/types';

export const BASE_RATING = 1000;
export const K_MAX = 32;

export interface RatedSeat {
  accountId: number;
  team: TeamId;
  rating: number;
}

export function isRated(humansByTeam: readonly [number, number]): boolean {
  return humansByTeam[0] > 0 && humansByTeam[1] > 0;
}

// Walking out of a live rated match costs a flat chunk of rating and a
// short queue lockout. Only deliberate leaves are punished: a dropped
// connection keeps its seat reservation, and coming back through the
// rejoin grace costs nothing.
export const LEAVER_RATING_PENALTY = 15;
export const LEAVER_LOCKOUT_MS = 60_000;

export function leaverPenalty(humansByTeam: readonly [number, number]): number {
  return isRated(humansByTeam) ? LEAVER_RATING_PENALTY : 0;
}

function average(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return values.length > 0 ? sum / values.length : BASE_RATING;
}

// Every human on a team moves by the same amount: the team won or lost as
// a team. Returns accountId -> signed delta; empty when the match is not
// rateable (a team with no human).
export function ratingDeltas(seats: readonly RatedSeat[], winner: TeamId): Map<number, number> {
  const out = new Map<number, number>();
  const byTeam: [RatedSeat[], RatedSeat[]] = [[], []];
  for (const s of seats) byTeam[s.team].push(s);
  if (byTeam[0].length === 0 || byTeam[1].length === 0) return out;
  const avg: [number, number] = [
    average(byTeam[0].map((s) => s.rating)),
    average(byTeam[1].map((s) => s.rating)),
  ];
  const k = (K_MAX * seats.length) / 10;
  for (const team of [0, 1] as const) {
    const expected = 1 / (1 + 10 ** ((avg[team === 0 ? 1 : 0] - avg[team]) / 400));
    const score = team === winner ? 1 : 0;
    let delta = Math.round(k * (score - expected));
    // A decided match always moves the needle, if only by one point.
    if (delta === 0) delta = score === 1 ? 1 : -1;
    for (const s of byTeam[team]) out.set(s.accountId, delta);
  }
  return out;
}
