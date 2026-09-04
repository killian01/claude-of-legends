// What the match log says of every account on one way (CONTEXT.md: Way):
// rated games, wins and losses, the form (the latest results, newest
// first) and the champions played. One linear pass at request time, like
// the profile; the ladder page and the account's place read from it.

import type { MatchRecord } from './records';
import { seatWay, type Way } from './ways';

export type Result = 'W' | 'L';

// The form's length on the account's own place; a row shows fewer.
export const FORM_CAP = 10;

export interface WayStats {
  games: number;
  wins: number;
  losses: number;
  form: Result[];
  lastAt: number;
  // Champion id to rated games on it.
  champions: Map<string, number>;
}

// A seat counts when its rating moved: that is what "rated on this way"
// means for a hand seat, a live bot seat and an Arena seat alike.
export function wayStatsOf(records: readonly MatchRecord[], way: Way): Map<number, WayStats> {
  const sorted = [...records].sort((a, b) => a.at - b.at);
  const out = new Map<number, WayStats>();
  for (const rec of sorted) {
    for (const seat of rec.players) {
      if (seat.accountId === null || seat.ratingDelta === undefined) continue;
      if (seatWay(rec, seat) !== way) continue;
      let s = out.get(seat.accountId);
      if (!s) {
        s = { games: 0, wins: 0, losses: 0, form: [], lastAt: 0, champions: new Map() };
        out.set(seat.accountId, s);
      }
      const won = seat.team === rec.winner;
      s.games++;
      if (won) s.wins++;
      else s.losses++;
      s.form.unshift(won ? 'W' : 'L');
      if (s.form.length > FORM_CAP) s.form.length = FORM_CAP;
      s.lastAt = rec.at;
      s.champions.set(seat.championId, (s.champions.get(seat.championId) ?? 0) + 1);
    }
  }
  return out;
}

// The champion most played on the way; ties go to the one played first.
export function favoriteOf(s: WayStats | undefined): { championId: string; games: number } | null {
  if (!s) return null;
  let best: { championId: string; games: number } | null = null;
  for (const [championId, games] of s.champions) {
    if (!best || games > best.games) best = { championId, games };
  }
  return best;
}
