// The ladder: players ranked by rating, pure over the registry's records.
// A handful of rated games is required before a rating means anything;
// below that the player simply does not place yet.

import { handleOf, type PlayerRecord } from './players';

export const LADDER_CAP = 50;
export const MIN_RATED_GAMES = 3;

export interface LadderRow {
  rank: number;
  id: number;
  handle: string;
  rating: number;
  ratedGames: number;
}

export function buildLadder(players: readonly PlayerRecord[], cap = LADDER_CAP): LadderRow[] {
  return players
    .filter((p) => p.ratedGames >= MIN_RATED_GAMES)
    .sort((a, b) => b.rating - a.rating || a.createdAt - b.createdAt)
    .slice(0, cap)
    .map((p, i) => ({
      rank: i + 1,
      id: p.id,
      handle: handleOf(p),
      rating: p.rating,
      ratedGames: p.ratedGames,
    }));
}
