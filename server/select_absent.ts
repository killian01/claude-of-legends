// A 5v5 starting with seats whose players left during champion select
// (the matchmaker marks their picks absent): each such champion is handed
// to its bot before the first tick, so it plays instead of standing still
// at the fountain, and the player is not put into the match. A dropped
// connection holds the seat for its account to come back to, as one
// dropped mid-match does; a tab still open that went to another match
// chose to leave, and holds nothing.

import type { MatchPick } from './match';
import type { HeldSeat } from './rejoin';

export interface AbsentSeatMatch {
  handleDisconnect(clientId: number): Omit<HeldSeat, 'matchId'> | null;
}

// Returns the client ids left to their bots: nobody behind these seats
// gets match_start or the match's id.
export function leaveAbsentToBots(
  match: AbsentSeatMatch,
  matchId: number,
  picks: readonly MatchPick[],
  connected: (clientId: number) => boolean,
  rejoins: { reserve(accountId: number, seat: HeldSeat): void },
): Set<number> {
  const gone = new Set<number>();
  for (const p of picks) {
    if (!p.absent) continue;
    gone.add(p.clientId);
    const seat = match.handleDisconnect(p.clientId);
    if (seat && p.accountId !== undefined && !connected(p.clientId)) {
      rejoins.reserve(p.accountId, { matchId, ...seat });
    }
  }
  return gone;
}
