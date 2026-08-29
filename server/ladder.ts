// The ladder: accounts ranked by rating, pure over the registry's
// records. A handful of rated games is required before a rating means
// anything; below that the account simply does not place yet.
//
// The tie-break is load-bearing on a young server. K scales with how many
// humans played (server/rating.ts), so early matches move a rating by
// about three points and for a while every placed account sits in a
// narrow band around the base rating. Breaking that tie on account age
// would rank the whole board by signup order; breaking it on rated games
// ranks it by how much evidence there is, which is the honest answer to
// "these two look equal".

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
    .sort((a, b) => b.rating - a.rating || b.ratedGames - a.ratedGames || a.createdAt - b.createdAt)
    .slice(0, cap)
    .map((a, i) => ({
      rank: i + 1,
      id: a.id,
      name: a.name,
      rating: a.rating,
      ratedGames: a.ratedGames,
    }));
}
