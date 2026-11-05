// A 5v5 closing for good frees everyone still on it, spectators included.

import { describe, expect, it } from 'vitest';
import { Match } from '../server/match';
import { closeMatch } from '../server/match_close';
import { RejoinRegistry } from '../server/rejoin';

function watched() {
  const match = new Match(7, [
    { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  match.tick();
  match.addSpectator(5, 1);
  const clients = new Map<number, { matchId: number | null }>([
    [2, { matchId: 3 }],
    [5, { matchId: 3 }],
  ]);
  const rejoins = new RejoinRegistry();
  // Alice dropped: her seat is held against her account.
  rejoins.reserve(41, { matchId: 3, ...match.handleDisconnect(1)! });
  rejoins.reserve(50, { matchId: 4, name: 'carol', team: 0, unitId: 9 });
  const matches = new Map([[3, { match }]]);
  const sent: [number, string][] = [];
  const deps = {
    matches,
    rejoins,
    clients,
    send: (cid: number, msg: { t: string }) => sent.push([cid, msg.t]),
  };
  return { deps, clients, rejoins, matches, sent };
}

describe('closing a 5v5', () => {
  it('tells its players and spectators, and sets them free to queue', () => {
    const { deps, clients, sent } = watched();
    closeMatch(deps, 3);
    expect(sent).toEqual([
      [2, 'match_end'],
      [5, 'match_end'],
    ]);
    expect(clients.get(2)?.matchId).toBeNull();
    expect(clients.get(5)?.matchId).toBeNull();
  });

  it('a spectator is freed when the last player left and the grace ran out', () => {
    const { deps, clients, matches, sent } = watched();
    matches.get(3)!.match.handleDisconnect(2);
    clients.delete(2);
    closeMatch(deps, 3);
    expect(sent).toEqual([[5, 'match_end']]);
    expect(clients.get(5)?.matchId).toBeNull();
  });

  it('is gone, with the seats it held, and no other match is touched', () => {
    const { deps, rejoins, matches } = watched();
    closeMatch(deps, 3);
    expect(matches.has(3)).toBe(false);
    expect(rejoins.held(41)).toBeUndefined();
    expect(rejoins.held(50)?.matchId).toBe(4);
  });

  it('leaves a socket that has since moved to another match where it is', () => {
    const { deps, clients } = watched();
    clients.get(5)!.matchId = 4;
    closeMatch(deps, 3);
    expect(clients.get(5)?.matchId).toBe(4);
  });

  it('does nothing for a match already closed', () => {
    const { deps, sent } = watched();
    closeMatch(deps, 3);
    closeMatch(deps, 3);
    expect(sent).toHaveLength(2);
  });
});
