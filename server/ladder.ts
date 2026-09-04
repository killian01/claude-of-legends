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

// A row of a bot ladder: the bot's id and name, and the account that owns
// it, so a reader can go from the ladder to either.
export interface BotLadderRow {
  rank: number;
  id: string;
  accountId: number;
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

// The bot ladders (ADR 0013, amended by ADR 0016): the same ranking over
// the bots' store rows, one row per bot rather than per account. `nameOf`
// answers the row's public name, the bot's; a bot whose row outlived it,
// or whose owner is gone, has none and does not place.
export function buildBotLadder(
  rows: readonly { botId: string; accountId: number; rating: number; games: number }[],
  nameOf: (botId: string, accountId: number) => string | null,
  cap = LADDER_CAP,
): BotLadderRow[] {
  const named: {
    botId: string;
    accountId: number;
    rating: number;
    games: number;
    name: string;
  }[] = [];
  for (const r of rows) {
    if (r.games < MIN_RATED_GAMES) continue;
    const name = nameOf(r.botId, r.accountId);
    if (name !== null) named.push({ ...r, name });
  }
  return named
    .sort((a, b) => b.rating - a.rating || b.games - a.games || a.botId.localeCompare(b.botId))
    .slice(0, cap)
    .map((r, i) => ({
      rank: i + 1,
      id: r.botId,
      accountId: r.accountId,
      name: r.name,
      rating: r.rating,
      ratedGames: r.games,
    }));
}
