// A reconnect's way back into its 5v5 (the socket's hello): the seat a
// dropped connection left to its bot comes back to the account, the bot
// stands aside, and the match is no longer abandoned. The caller sends the
// match_start this returns, with the match's own payloads, and tells the
// team.
//
// A held seat whose match is gone is spent and gives nothing back, so the
// caller goes on to the other modes' rejoins as if no seat were held.

import type { TeamId } from '../src/sim/types';
import type { HeldSeat, RejoinRegistry } from './rejoin';

export interface RejoinableEntry {
  match: { restorePlayer(clientId: number, seat: HeldSeat): void };
  abandonedAt: number | null;
}

export interface ClassicRejoin<E> {
  seat: HeldSeat;
  entry: E;
  start: { t: 'match_start'; selfUnitId: number; team: TeamId; coach?: true };
}

export function rejoinClassic<E extends RejoinableEntry>(
  rejoins: RejoinRegistry,
  matches: ReadonlyMap<number, E>,
  accountId: number,
  clientId: number,
): ClassicRejoin<E> | null {
  const seat = rejoins.claim(accountId);
  if (!seat) return null;
  const entry = matches.get(seat.matchId);
  if (!entry) return null;
  entry.match.restorePlayer(clientId, seat);
  entry.abandonedAt = null;
  return {
    seat,
    entry,
    start: {
      t: 'match_start',
      selfUnitId: seat.unitId,
      team: seat.team,
      ...(seat.coach ? { coach: true as const } : {}),
    },
  };
}
