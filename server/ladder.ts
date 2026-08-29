// The ladder: accounts ranked by rating, pure over the registry's records.
// A handful of rated games is required before a rating means anything;
// below that the account simply does not place yet.

import { type Account, handleOf } from './accounts';

export const LADDER_CAP = 50;
export const MIN_RATED_GAMES = 3;

export interface LadderRow {
  rank: number;
  id: number;
  handle: string;
  rating: number;
  ratedGames: number;
}

export function buildLadder(accounts: readonly Account[], cap = LADDER_CAP): LadderRow[] {
  return accounts
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
