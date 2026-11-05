// A 5v5 closing for good, however it got there: its linger after the end
// ran out, its rejoin grace ran out with nobody connected, or its tick kept
// failing. Every player and every spectator still on it is told the match
// is over and set free to queue again, the match is gone, and the seats it
// was holding for dropped players go with it.

import type { RejoinRegistry } from './rejoin';

export interface ClosingEntry {
  match: {
    players: ReadonlyMap<number, unknown>;
    spectators: ReadonlyMap<number, unknown>;
  };
}

export interface CloseDeps<E extends ClosingEntry> {
  matches: Map<number, E>;
  rejoins: Pick<RejoinRegistry, 'pruneMatch'>;
  clients: ReadonlyMap<number, { matchId: number | null }>;
  send(clientId: number, msg: { t: 'match_end' }): void;
}

export function closeMatch<E extends ClosingEntry>(deps: CloseDeps<E>, matchId: number): void {
  const entry = deps.matches.get(matchId);
  if (!entry) return;
  for (const cid of [...entry.match.players.keys(), ...entry.match.spectators.keys()]) {
    const c = deps.clients.get(cid);
    if (c && c.matchId === matchId) c.matchId = null;
    deps.send(cid, { t: 'match_end' });
  }
  deps.matches.delete(matchId);
  deps.rejoins.pruneMatch(matchId);
}
