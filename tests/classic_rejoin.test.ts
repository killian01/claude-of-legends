// A reconnect's hello takes its 5v5 seat back from the bot holding it.

import { describe, expect, it } from 'vitest';
import { rejoinClassic } from '../server/classic_rejoin';
import { Match } from '../server/match';
import { closeMatch } from '../server/match_close';
import { RejoinRegistry } from '../server/rejoin';

function dropped(): {
  rejoins: RejoinRegistry;
  matches: Map<number, { match: Match; abandonedAt: number | null }>;
  unitId: number;
} {
  const match = new Match(7, [
    { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
  match.tick();
  const left = match.handleDisconnect(1)!;
  const rejoins = new RejoinRegistry();
  rejoins.reserve(41, { matchId: 3, ...left });
  const matches = new Map([[3, { match, abandonedAt: 1000 as number | null }]]);
  return { rejoins, matches, unitId: left.unitId };
}

describe('the classic rejoin', () => {
  it('hands the seat back to a new socket and sends the bot aside', () => {
    const { rejoins, matches, unitId } = dropped();
    const entry = matches.get(3)!;
    expect(entry.match.sim.policies.has(unitId)).toBe(true);

    const back = rejoinClassic(rejoins, matches, 41, 9);
    expect(back?.entry).toBe(entry);
    expect(back?.start).toEqual({ t: 'match_start', selfUnitId: unitId, team: 0 });
    expect(entry.match.players.get(9)?.unitId).toBe(unitId);
    expect(entry.match.sim.policies.has(unitId)).toBe(false);
    expect(entry.match.replayEvents.some((e) => e.u === unitId && e.e === 'bot_off')).toBe(true);
    // Someone is back: the reaper must not close the match under them.
    expect(entry.abandonedAt).toBeNull();
  });

  it('hands a seat back once, and nothing to another account', () => {
    const { rejoins, matches } = dropped();
    expect(rejoinClassic(rejoins, matches, 42, 8)).toBeNull();
    expect(rejoinClassic(rejoins, matches, 41, 9)).not.toBeNull();
    expect(rejoinClassic(rejoins, matches, 41, 10)).toBeNull();
    expect(matches.get(3)!.match.players.has(10)).toBe(false);
  });

  it('gives nothing back for a seat whose match is gone', () => {
    const { rejoins, matches } = dropped();
    matches.delete(3);
    expect(rejoinClassic(rejoins, matches, 41, 9)).toBeNull();
    expect(rejoins.heldSeats).toBe(0);
  });

  it('brings a coach back to the bot it was coaching, the bot still playing', () => {
    const { rejoins, matches, unitId } = dropped();
    rejoins.claim(41);
    const entry = matches.get(3)!;
    rejoins.reserve(41, { matchId: 3, name: 'alice', team: 0, unitId, coach: true });
    const back = rejoinClassic(rejoins, matches, 41, 9);
    expect(back?.start).toEqual({ t: 'match_start', selfUnitId: unitId, team: 0, coach: true });
    expect(entry.match.players.get(9)?.coach).toBe(true);
    expect(entry.match.sim.policies.has(unitId)).toBe(true);
  });

  // A match that ended lingers so its end screen can show: a reload in that
  // window takes the seat back, and the close at the end of the linger then
  // tells the new socket and sets it free to queue again.
  it('takes a seat back in an ended match, and the close lets the new socket go', () => {
    const { rejoins, matches, unitId } = dropped();
    const entry = matches.get(3)!;
    entry.match.sim.winner = 1;

    const back = rejoinClassic(rejoins, matches, 41, 9);
    expect(back?.start).toEqual({ t: 'match_start', selfUnitId: unitId, team: 0 });
    expect(entry.match.players.get(9)?.unitId).toBe(unitId);
    expect(entry.abandonedAt).toBeNull();

    const clients = new Map([[9, { matchId: 3 as number | null }]]);
    const sent: number[] = [];
    closeMatch({ matches, rejoins, clients, send: (cid) => sent.push(cid) }, 3);
    expect(sent).toContain(9);
    expect(clients.get(9)?.matchId).toBeNull();
    expect(matches.has(3)).toBe(false);
  });

  it('gives nothing back once the linger closed the match, even for a seat held in it', () => {
    const { rejoins, matches } = dropped();
    matches.get(3)!.match.sim.winner = 1;
    closeMatch({ matches, rejoins, clients: new Map(), send: () => {} }, 3);
    expect(rejoins.held(41)).toBeUndefined();
    expect(rejoinClassic(rejoins, matches, 41, 9)).toBeNull();
  });
});
