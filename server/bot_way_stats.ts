// What a bot's own Record says of it on one bot way (ADR 0016): the rated
// games, the wins and losses, the form newest first, and when it last
// played. The hand and Forge ladders read the match log per account
// (server/way_stats.ts); the two bot ladders read this instead, because
// their subject is the bot and the bot's Record already holds one entry
// per match with the rating movement that says it counted.
//
// Pure over the rows the Record hands out, like everything else that
// counts rated play.

import type { RecordRow } from '../src/net/record';
import { FORM_CAP, type Result, type WayStats } from './way_stats';
import type { Way } from './ways';

// The Record's word for a way: a live seat is recorded as 'live', the
// ladder calls that way 'bot'.
export function kindOfWay(way: Way): 'arena' | 'live' | null {
  if (way === 'arena') return 'arena';
  if (way === 'bot') return 'live';
  return null;
}

export function botWayStats(rows: readonly RecordRow[], way: Way, championId: string): WayStats {
  const kind = kindOfWay(way);
  const out: WayStats = {
    games: 0,
    wins: 0,
    losses: 0,
    form: [],
    lastAt: 0,
    champions: new Map(),
  };
  if (kind === null) return out;
  // Oldest first, so the form can be built by unshifting the newest.
  const sorted = [...rows]
    .filter((r) => r.kind === kind && r.ratingDelta !== undefined)
    .sort((a, b) => a.at - b.at);
  for (const r of sorted) {
    out.games++;
    if (r.winner !== null) {
      const won = r.winner === r.team;
      if (won) out.wins++;
      else out.losses++;
      out.form.unshift(won ? ('W' as Result) : ('L' as Result));
    }
    out.lastAt = Math.max(out.lastAt, r.at);
  }
  out.form = out.form.slice(0, FORM_CAP);
  // A bot plays one champion, so its favorite is never in doubt.
  if (out.games > 0) out.champions.set(championId, out.games);
  return out;
}
