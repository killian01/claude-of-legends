// Matchmaker gate: queue, start-now, private lobbies, champion select
// locking, timeout defaults, and disconnect handling.

import { describe, expect, it } from 'vitest';
import type { MatchPick } from '../server/match';
import { Matchmaker } from '../server/matchmaker';
import type { ServerMsg } from '../src/net/protocol';

function harness(): {
  mm: Matchmaker;
  sent: Map<number, ServerMsg[]>;
  matches: MatchPick[][];
} {
  const sent = new Map<number, ServerMsg[]>();
  const matches: MatchPick[][] = [];
  const mm = new Matchmaker(
    (clientId, msg) => {
      const list = sent.get(clientId) ?? [];
      list.push(msg);
      sent.set(clientId, list);
    },
    (picks) => matches.push(picks),
  );
  return { mm, sent, matches };
}

const last = (msgs: ServerMsg[] | undefined, t: string): ServerMsg | undefined =>
  msgs?.filter((m) => m.t === t).at(-1);

describe('matchmaker', () => {
  it('start-now launches select for everyone queued, teams alternating', () => {
    const { mm, sent, matches } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    expect(last(sent.get(1), 'queue_status')).toMatchObject({ count: 2 });
    mm.startNow(1, 1000);
    const s1 = last(sent.get(1), 'select_start');
    const s2 = last(sent.get(2), 'select_start');
    expect(s1).toMatchObject({ team: 0 });
    expect(s2).toMatchObject({ team: 1 });
    expect(matches).toHaveLength(0);

    mm.pick(1, 'fenn', ['riftstep', 'sear']);
    mm.pick(2, 'korrath', ['zephyr', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject([
      { clientId: 1, championId: 'fenn', team: 0 },
      { clientId: 2, championId: 'korrath', team: 1 },
    ]);
  });

  it('falls back to defaults on invalid picks and on timeout', () => {
    const { mm, matches } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 0);
    mm.pick(1, 'not_a_champion', ['riftstep', 'riftstep']);
    expect(matches).toHaveLength(0);
    // Bob never picks; the deadline expires.
    mm.tickClock(10 * 60 * 1000);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toMatchObject({ championId: 'sylra', sigils: ['riftstep', 'mend'] });
    expect(matches[0]![1]).toMatchObject({ championId: 'sylra' });
  });

  it('runs private lobbies by code', () => {
    const { mm, sent, matches } = harness();
    mm.createLobby(1, 'host');
    const lobbyMsg = last(sent.get(1), 'lobby');
    expect(lobbyMsg?.t).toBe('lobby');
    const code = lobbyMsg?.t === 'lobby' ? lobbyMsg.code : '';
    expect(code).toHaveLength(5);

    mm.joinLobby(2, 'friend', code);
    const joined = last(sent.get(2), 'lobby');
    expect(joined?.t === 'lobby' && joined.players).toEqual(['host', 'friend']);

    mm.joinLobby(3, 'lost', 'ZZZZZ');
    expect(last(sent.get(3), 'error')).toBeDefined();

    mm.startLobby(2, 0);
    expect(sent.get(1)?.some((m) => m.t === 'select_start')).toBe(false);
    mm.startLobby(1, 0);
    mm.pick(1, 'maera', ['mend', 'zephyr']);
    mm.pick(2, 'torv', ['riftstep', 'sear']);
    expect(matches).toHaveLength(1);
  });

  it('auto-locks a player who disconnects during select', () => {
    const { mm, matches } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 0);
    mm.pick(1, 'vesk', ['riftstep', 'mend']);
    mm.removeEverywhere(2);
    expect(matches).toHaveLength(1);
    expect(matches[0]![1]).toMatchObject({ clientId: 2, championId: 'sylra' });
  });
});
