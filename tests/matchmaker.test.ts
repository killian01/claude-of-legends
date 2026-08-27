// Matchmaker gate: queue, the opt-in bot-fill countdown, private lobbies,
// champion select locking, timeout defaults, and disconnect handling.

import { describe, expect, it } from 'vitest';
import type { MatchPick } from '../server/match';
import {
  BOT_START_COUNTDOWN_MS,
  LOBBY_TTL_MS,
  Matchmaker,
  type MatchSource,
} from '../server/matchmaker';
import type { ServerMsg } from '../src/net/protocol';

function harness(): {
  mm: Matchmaker;
  sent: Map<number, ServerMsg[]>;
  matches: MatchPick[][];
  sources: MatchSource[];
} {
  const sent = new Map<number, ServerMsg[]>();
  const matches: MatchPick[][] = [];
  const sources: MatchSource[] = [];
  const mm = new Matchmaker(
    (clientId, msg) => {
      const list = sent.get(clientId) ?? [];
      list.push(msg);
      sent.set(clientId, list);
    },
    (picks, source) => {
      matches.push(picks);
      sources.push(source);
    },
  );
  return { mm, sent, matches, sources };
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
    const { mm, sent, matches, sources } = harness();
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
    // Queue matches are flagged as such: they alone can ever be rated.
    expect(sources).toEqual(['queue']);
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
    const { mm, sent, matches, sources } = harness();
    mm.createLobby(1, 'host');
    const lobbyMsg = last(sent.get(1), 'lobby');
    expect(lobbyMsg?.t).toBe('lobby');
    const code = lobbyMsg?.t === 'lobby' ? lobbyMsg.code : '';
    expect(code).toHaveLength(5);

    mm.joinLobby(2, 'friend', code);
    const joined = last(sent.get(2), 'lobby');
    expect(joined?.t === 'lobby' && joined.players).toEqual([
      { name: 'host', team: 0 },
      { name: 'friend', team: 1 },
    ]);

    mm.joinLobby(3, 'lost', 'ZZZZZ');
    expect(last(sent.get(3), 'error')).toBeDefined();

    mm.startLobby(2, 0);
    expect(sent.get(1)?.some((m) => m.t === 'select_start')).toBe(false);
    mm.startLobby(1, 0);
    mm.pick(1, 'maera', ['mend', 'zephyr']);
    mm.pick(2, 'torv', ['riftstep', 'sear']);
    expect(matches).toHaveLength(1);
    // A private lobby match is never rated; the source says so.
    expect(sources).toEqual(['lobby']);
  });

  it('lobby sides are pickable and survive into the match', () => {
    const { mm, sent, matches } = harness();
    mm.createLobby(1, 'host');
    const lobbyMsg = last(sent.get(1), 'lobby');
    const code = lobbyMsg?.t === 'lobby' ? lobbyMsg.code : '';
    mm.joinLobby(2, 'friend', code);
    // The joiner lands on the emptier side by default.
    let view = last(sent.get(2), 'lobby');
    expect(view?.t === 'lobby' && view.team).toBe(1);
    // Then moves next to the host: a duo against the bot fill.
    mm.setLobbyTeam(2, 0);
    view = last(sent.get(2), 'lobby');
    expect(view?.t === 'lobby' && view.team).toBe(0);
    const hostView = last(sent.get(1), 'lobby');
    expect(hostView?.t === 'lobby' && hostView.players).toEqual([
      { name: 'host', team: 0 },
      { name: 'friend', team: 0 },
    ]);
    // Junk team values are ignored.
    mm.setLobbyTeam(2, 5);
    mm.setLobbyTeam(2, 'red');
    mm.startLobby(1, 0);
    expect(last(sent.get(1), 'select_start')).toMatchObject({ team: 0 });
    expect(last(sent.get(2), 'select_start')).toMatchObject({ team: 0 });
    mm.pick(1, 'korrath', ['riftstep', 'sear']);
    mm.pick(2, 'fenn', ['zephyr', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject([
      { clientId: 1, team: 0 },
      { clientId: 2, team: 0 },
    ]);
  });

  it('a full side takes nobody else', () => {
    const { mm, sent } = harness();
    mm.createLobby(1, 'host');
    const lobbyMsg = last(sent.get(1), 'lobby');
    const code = lobbyMsg?.t === 'lobby' ? lobbyMsg.code : '';
    for (let i = 2; i <= 10; i++) mm.joinLobby(i, `p${i}`, code);
    // Balanced joins fill both sides to five.
    const full = last(sent.get(1), 'lobby');
    const players = full?.t === 'lobby' ? full.players : [];
    expect(players.filter((p) => p.team === 0)).toHaveLength(5);
    // Client 2 sits on team 1; team 0 is full, the switch is refused
    // silently (no broadcast, same team on the last view).
    mm.setLobbyTeam(2, 0);
    const after = last(sent.get(2), 'lobby');
    expect(after?.t === 'lobby' && after.team).toBe(1);
  });

  it('a lobby queues as a party and lands whole on one side', () => {
    const { mm, sent, matches, sources } = harness();
    mm.createLobby(1, 'host');
    const lobbyMsg = last(sent.get(1), 'lobby');
    const code = lobbyMsg?.t === 'lobby' ? lobbyMsg.code : '';
    mm.joinLobby(2, 'friend', code);
    mm.queuePartyFromLobby(1, 0);
    // The lobby is gone; both members are queued as one group of two.
    mm.joinLobby(3, 'late', code);
    expect(last(sent.get(3), 'error')).toBeDefined();
    const status = last(sent.get(2), 'queue_status');
    expect(status?.t === 'queue_status' && status.count).toBe(2);
    // Any member can opt the party into the bot fill.
    mm.startNow(2, 0);
    expect(last(sent.get(1), 'select_start')).toBeDefined();
    const t1 = last(sent.get(1), 'select_start');
    const t2 = last(sent.get(2), 'select_start');
    expect(t1?.t === 'select_start' && t2?.t === 'select_start' && t1.team === t2.team).toBe(true);
    mm.pick(1, 'korrath', ['riftstep', 'sear']);
    mm.pick(2, 'fenn', ['zephyr', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]!.team).toBe(matches[0]![1]!.team);
    expect(sources).toEqual(['queue']);
  });

  it('a party and solos pack into a full match with the party whole', () => {
    const { mm, sent, matches } = harness();
    // A party of four...
    mm.createLobby(1, 'host');
    const code0 = (() => {
      const m = last(sent.get(1), 'lobby');
      return m?.t === 'lobby' ? m.code : '';
    })();
    for (let i = 2; i <= 4; i++) mm.joinLobby(i, `p${i}`, code0);
    mm.queuePartyFromLobby(1, 0);
    // ...plus six solos: ten seats, the match forms.
    for (let i = 5; i <= 10; i++) mm.addToQueue(i, `s${i}`, 0);
    for (let i = 1; i <= 10; i++) {
      const sel = last(sent.get(i), 'select_start');
      expect(sel?.t).toBe('select_start');
    }
    // The party's four share one side.
    const partyTeams = [1, 2, 3, 4].map((i) => {
      const m = last(sent.get(i), 'select_start');
      return m?.t === 'select_start' ? m.team : -1;
    });
    expect(new Set(partyTeams).size).toBe(1);
    for (let i = 1; i <= 10; i++) mm.pick(i, 'sylra', ['riftstep', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.filter((p) => p.team === 0)).toHaveLength(5);
  });

  it('refuses to queue a party larger than a team', () => {
    const { mm, sent } = harness();
    mm.createLobby(1, 'host');
    const code = (() => {
      const m = last(sent.get(1), 'lobby');
      return m?.t === 'lobby' ? m.code : '';
    })();
    for (let i = 2; i <= 6; i++) mm.joinLobby(i, `p${i}`, code);
    mm.queuePartyFromLobby(1, 0);
    const refusal = last(sent.get(1), 'error');
    expect(refusal?.t === 'error' && refusal.message).toContain('up to five');
    // The lobby survives the refusal.
    mm.joinLobby(7, 'p7', code);
    expect(last(sent.get(7), 'lobby')?.t).toBe('lobby');
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
