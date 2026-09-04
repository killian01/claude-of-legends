// The way an owned seat was played (CONTEXT.md: Way), read off a match
// record: by hand, by the account's bot in a live match, by that bot in
// the Arena, or by hand in the Forge queue. One rating and one ladder per
// way, so every count over the match log starts by asking this.

import type { MatchPlayerRecord, MatchRecord } from './records';

export type Way = 'hand' | 'bot' | 'arena' | 'forge';

export function seatWay(rec: MatchRecord, seat: MatchPlayerRecord): Way {
  if (rec.queue === 'arena') return 'arena';
  if (seat.way === 'bot') return 'bot';
  if (rec.queue === 'forge') return 'forge';
  return 'hand';
}

// The account's own play: the ways a person sat at the keyboard for.
export function playedByHand(way: Way): boolean {
  return way === 'hand' || way === 'forge';
}
