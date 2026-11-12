// A 5v5 seat whose player left during champion select: the champion is
// played by its bot from the first tick instead of standing still, and a
// dropped connection holds the seat for its account to come back to.

import { describe, expect, it } from 'vitest';
import type { MatchPick } from '../server/match';
import { Match } from '../server/match';
import { RejoinRegistry } from '../server/rejoin';
import { leaveAbsentToBots } from '../server/select_absent';

const PICKS: MatchPick[] = [
  {
    clientId: 1,
    name: 'alice',
    team: 0,
    accountId: 11,
    championId: 'sylra',
    sigils: ['riftstep', 'mend'],
  },
  {
    clientId: 2,
    name: 'bob',
    team: 1,
    accountId: 12,
    championId: 'fenn',
    sigils: ['zephyr', 'sear'],
    absent: true,
  },
  {
    clientId: 3,
    name: 'cara',
    team: 1,
    accountId: 13,
    championId: 'vesk',
    sigils: ['zephyr', 'sear'],
    absent: true,
  },
];

describe('leaveAbsentToBots', () => {
  it('hands an absent seat to its bot and holds it only for a dropped connection', () => {
    const match = new Match(7, PICKS);
    const units = PICKS.map((p) => match.players.get(p.clientId)!.unitId);
    const rejoins = new RejoinRegistry();
    // bob's socket closed during the select; cara's tab is open but went
    // to another match.
    const gone = leaveAbsentToBots(match, 42, PICKS, (clientId) => clientId !== 2, rejoins);
    expect([...gone].sort()).toEqual([2, 3]);
    expect([...match.players.keys()]).toEqual([1]);
    expect(match.sim.policies.has(units[0]!)).toBe(false);
    expect(match.sim.policies.has(units[1]!)).toBe(true);
    expect(match.sim.policies.has(units[2]!)).toBe(true);
    expect(rejoins.claim(12)).toMatchObject({ matchId: 42, unitId: units[1], team: 1 });
    expect(rejoins.claim(13)).toBeUndefined();
    expect(rejoins.claim(11)).toBeUndefined();
  });

  it('leaves a match whose players all stayed as it was', () => {
    const picks = PICKS.map(({ absent: _, ...p }) => p);
    const match = new Match(7, picks);
    const gone = leaveAbsentToBots(match, 1, picks, () => true, new RejoinRegistry());
    expect(gone.size).toBe(0);
    expect(match.players.size).toBe(3);
  });
});
