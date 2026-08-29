// The ladder: accounts ranked by rating, pure over the registry's
// records. A handful of rated games is required before a rating means
// anything; below that the account simply does not place yet.

import type { Account } from './accounts';

export const LADDER_CAP = 50;
export const MIN_RATED_GAMES = 3;

export interface LadderRow {
  rank: number;
  id: number;
  name: string;
  rating: number;
  ratedGames: number;
}

export function buildLadder(accounts: readonly Account[], cap = LADDER_CAP): LadderRow[] {
  return accounts
    .filter((a) => a.ratedGames >= MIN_RATED_GAMES)
    .sort((a, b) => b.rating - a.rating || a.createdAt - b.createdAt)
    .slice(0, cap)
    .map((a, i) => ({
      rank: i + 1,
      id: a.id,
      name: a.name,
      rating: a.rating,
      ratedGames: a.ratedGames,
    }));
}
