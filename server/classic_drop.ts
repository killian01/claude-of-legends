// A socket leaving its 5v5 without walking out: its tab closed, or another
// tab of the account took the connection over. The seat goes to its bot
// and is held against the account, so the next hello (a reload, the phone
// after the laptop) hands it back; a spectator just stops watching.
//
// The socket forgets the match here, so this runs once per socket: the
// takeover calls it on the spot, before the new tab's hello can ask for
// the seat, and the old socket's close handler, which runs only once the
// old tab answers the close (or a dead one times out), then finds nothing.

import type { HeldSeat, RejoinRegistry } from './rejoin';

export interface DroppingSocket {
  id: number;
  accountId: number;
  matchId: number | null;
}

type Seat = Omit<HeldSeat, 'matchId'>;

export interface DroppableEntry {
  match: {
    readonly players: ReadonlyMap<number, unknown>;
    removeSpectator(clientId: number): void;
    handleDisconnect(clientId: number): Seat | null;
  };
  abandonedAt: number | null;
}

export interface DropHooks<E> {
  // The seat's report, written while the socket still sits in the match.
  report(entry: E): void;
  // The team is told who left; the seat is already held.
  left(entry: E, seat: Seat): void;
  // Whether a client still has a socket; the dropping one counts as gone.
  connected(clientId: number): boolean;
  // No one connected plays the match any more.
  abandoned(matchId: number): void;
}

export function dropFromClassic<E extends DroppableEntry>(
  socket: DroppingSocket,
  matches: ReadonlyMap<number, E>,
  rejoins: RejoinRegistry,
  now: number,
  hooks: DropHooks<E>,
): void {
  const matchId = socket.matchId;
  if (matchId === null) return;
  socket.matchId = null;
  const entry = matches.get(matchId);
  if (!entry) return;
  entry.match.removeSpectator(socket.id);
  hooks.report(entry);
  const left = entry.match.handleDisconnect(socket.id);
  if (left) {
    rejoins.reserve(socket.accountId, { matchId, ...left });
    hooks.left(entry, left);
  }
  const anyConnected = [...entry.match.players.keys()].some(
    (cid) => cid !== socket.id && hooks.connected(cid),
  );
  if (!anyConnected && entry.abandonedAt === null) {
    entry.abandonedAt = now;
    hooks.abandoned(matchId);
  }
}
