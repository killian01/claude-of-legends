// Matchmaker gate: queue, the opt-in bot-fill countdown, private lobbies,
// champion select locking, timeout defaults, and disconnect handling.

import { describe, expect, it } from 'vitest';
import type { MatchPick } from '../server/match';
import { BOT_START_COUNTDOWN_MS, LOBBY_TTL_MS, Matchmaker } from '../server/matchmaker';
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
  it('a solo player who opts into bots starts instantly', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.startNow(1, 0);
    expect(last(sent.get(1), 'select_start')).toBeDefined();
  });

  it('starts instantly once everyone queued has opted in', () => {
    const { mm, sent, matches } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 1000);
    // Bob has not opted in: nobody starts yet, a countdown is announced.
    expect(last(sent.get(1), 'select_start')).toBeUndefined();
    const status = last(sent.get(2), 'queue_status');
    expect(status?.t === 'queue_status' && status.startsIn !== null).toBe(true);
    mm.startNow(2, 2000);
    expect(last(sent.get(1), 'select_start')).toMatchObject({ team: 0 });
    expect(last(sent.get(2), 'select_start')).toMatchObject({ team: 1 });

    mm.pick(1, 'fenn', ['riftstep', 'sear']);
    mm.pick(2, 'korrath', ['zephyr', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject([
      { clientId: 1, championId: 'fenn', team: 0 },
      { clientId: 2, championId: 'korrath', team: 1 },
    ]);
  });

  it('the countdown takes only volunteers and leaves the rest queued', () => {
    const { mm, sent, matches } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 0);
    expect(matches).toHaveLength(0);
    mm.tickClock(BOT_START_COUNTDOWN_MS + 1);
    // Alice goes to select alone; Bob is still queued for a human match.
    expect(last(sent.get(1), 'select_start')).toBeDefined();
    expect(last(sent.get(2), 'select_start')).toBeUndefined();
    const bobStatus = last(sent.get(2), 'queue_status');
    expect(bobStatus?.t === 'queue_status' && bobStatus.count).toBe(1);
    mm.pick(1, 'vesk', ['riftstep', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveLength(1);
  });

  it('falls back to defaults on invalid picks and on select timeout', () => {
    const { mm, matches } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 0);
    mm.startNow(2, 0);
    mm.pick(1, 'not_a_champion', ['riftstep', 'riftstep']);
    expect(matches).toHaveLength(0);
    // Bob never picks; the select deadline expires.
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
    mm.startNow(2, 0);
    mm.pick(1, 'vesk', ['riftstep', 'mend']);
    mm.removeEverywhere(2, 0);
    expect(matches).toHaveLength(1);
    expect(matches[0]![1]).toMatchObject({ clientId: 2, championId: 'sylra' });
  });

  it('cancels the countdown when the only volunteer leaves', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 0);
    mm.removeEverywhere(1, 0);
    const bobStatus = last(sent.get(2), 'queue_status');
    expect(bobStatus?.t === 'queue_status' && bobStatus.startsIn).toBeNull();
    mm.tickClock(BOT_START_COUNTDOWN_MS + 1);
    expect(last(sent.get(2), 'select_start')).toBeUndefined();
  });

  it('lobby codes are unpredictable, unique, and 5 uppercase letters', () => {
    const { mm, sent } = harness();
    const codes = new Set<string>();
    for (let i = 1; i <= 40; i++) {
      mm.createLobby(i, `host${i}`, 0);
      const msg = last(sent.get(i), 'lobby');
      if (msg?.t === 'lobby') codes.add(msg.code);
    }
    expect(codes.size).toBe(40);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z]{5}$/);
  });

  it('retries code collisions and expires stale lobbies', () => {
    const sent = new Map<number, ServerMsg[]>();
    // A generator that collides once before yielding a fresh code.
    const codeSeq = ['AAAAA', 'AAAAA', 'BBBBB'];
    const mm = new Matchmaker(
      (clientId, msg) => {
        const list = sent.get(clientId) ?? [];
        list.push(msg);
        sent.set(clientId, list);
      },
      () => undefined,
      () => codeSeq.shift() ?? 'CCCCC',
    );
    mm.createLobby(1, 'alice', 0);
    mm.createLobby(2, 'bob', 0);
    const bobLobby = last(sent.get(2), 'lobby');
    expect(bobLobby?.t === 'lobby' && bobLobby.code).toBe('BBBBB');

    // Both lobbies expire once the TTL passes; players are told.
    mm.tickClock(LOBBY_TTL_MS + 1);
    const notice = last(sent.get(1), 'error');
    expect(notice?.t === 'error' && notice.message).toBe('Lobby expired.');
    // The expired code is joinable no more.
    mm.joinLobby(3, 'carol', 'BBBBB');
    const refusal = last(sent.get(3), 'error');
    expect(refusal?.t === 'error' && refusal.message).toBe('Lobby not found or full.');
  });
});
