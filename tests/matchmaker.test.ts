// Matchmaker gate: queue, the bot fill that takes the whole queue, private lobbies,
// champion select locking, timeout defaults, and disconnect handling.

import { describe, expect, it } from 'vitest';
import type { MatchPick } from '../server/match';
import {
  type BotSeat,
  DROP_GRACE_MS,
  LOBBY_IDLE_MS,
  LOBBY_PLAY_GUARD_MS,
  LOBBY_TTL_MS,
  Matchmaker,
  type MatchmakerOptions,
  type MatchSource,
  RETURN_GRACE_MS,
} from '../server/matchmaker';
import type { SelectClaim, ServerMsg } from '../src/net/protocol';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';

// The match a select hands over gets the next id from 1, as main.ts's
// onMatchReady returns it; ready overrides that (no id, a throw).
function harness(
  opts: MatchmakerOptions = {},
  ready?: (picks: MatchPick[]) => number | undefined,
): {
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
      return ready ? ready(picks) : matches.length;
    },
    undefined,
    opts,
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

  // ADR 0025: two people are rarely queued at the same moment here, so
  // the one who presses Start takes the other along instead of leaving
  // them behind a countdown they had to answer.
  it('Start takes everyone queued along, at once, on opposite sides', () => {
    const { mm, sent, matches, sources } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.startNow(1, 1000);
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
    expect(code).toHaveLength(6);

    mm.joinLobby(2, 'friend', code);
    const joined = last(sent.get(2), 'lobby');
    expect(joined?.t === 'lobby' && joined.players).toEqual([
      { n: 1, name: 'host', team: 0, host: true },
      { n: 2, name: 'friend', team: 1, you: true },
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
      { n: 1, name: 'host', team: 0, host: true, you: true },
      { n: 2, name: 'friend', team: 0 },
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
    // Both members are queued as one group of two, and the lobby waits for
    // them: a late friend joins it and waits for the next match.
    mm.joinLobby(3, 'late', code);
    expect(last(sent.get(3), 'error')).toBeUndefined();
    expect(last(sent.get(3), 'lobby')).toMatchObject({ phase: 'queue', host: false });
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
    // A notice, never an error: the lobby screen stays up.
    expect(last(sent.get(1), 'error')).toBeUndefined();
    const refusal = last(sent.get(1), 'lobby');
    expect(refusal?.t === 'lobby' && refusal.notice).toContain('up to five');
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

  // A player who leaves the select, locked or not (a closed socket, a
  // match entered from another tab), is told the match it was in and its
  // pick says so: nobody behind it any more, a bot takes it.
  it('marks the pick of a player who left the select, locked or not', () => {
    const { mm, matches } = harness();
    for (let i = 1; i <= 3; i++) mm.addToQueue(i, `p${i}`, 0);
    mm.startNow(1, 0);
    mm.pick(1, 'vesk', ['riftstep', 'mend']);
    expect(mm.removeEverywhere(1, 0)).toBe(true);
    expect(mm.removeEverywhere(2, 0)).toBe(true);
    mm.pick(3, 'fenn', ['riftstep', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]![0]).toMatchObject({ clientId: 1, championId: 'vesk', absent: true });
    expect(matches[0]![1]).toMatchObject({ clientId: 2, absent: true });
    expect(matches[0]![2]).not.toHaveProperty('absent');
    // Out of the select, it is in nothing left to leave.
    expect(mm.removeEverywhere(1, 0)).toBe(false);
  });

  // Who sits behind a seat is read as the select starts, while every
  // seat's socket is open, and rides the pick: a seat whose socket closed
  // during the select still says whose it is (server/guests.ts reads it).
  it('carries whose each seat is onto the picks, a seat that dropped included', () => {
    const open = new Map([
      [1, -3],
      [2, 12],
    ]);
    const { mm, matches } = harness({ resolveAccount: (clientId) => open.get(clientId) ?? null });
    mm.addToQueue(1, 'Wanderer 0003', 0);
    mm.addToQueue(2, 'alice', 0);
    mm.startNow(1, 0);
    // The account's socket closes before the select ends.
    open.delete(2);
    mm.removeEverywhere(2, 0);
    mm.pick(1, 'vesk', ['riftstep', 'mend']);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject([
      { clientId: 1, team: 0, accountId: -3 },
      { clientId: 2, team: 1, accountId: 12 },
    ]);
    // With nobody to ask, a pick says nothing of whose it is.
    const plain = harness();
    plain.mm.addToQueue(1, 'alice', 0);
    plain.mm.startNow(1, 0);
    plain.mm.pick(1, 'vesk', ['riftstep', 'mend']);
    expect(plain.matches[0]![0]).not.toHaveProperty('accountId');
  });

  it('does not carry a player who left the queue before Start', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.removeEverywhere(2, 0);
    mm.startNow(1, 0);
    expect(last(sent.get(1), 'select_start')).toBeDefined();
    expect(last(sent.get(2), 'select_start')).toBeUndefined();
  });

  it('lobby codes are unpredictable, unique, and 6 uppercase letters', () => {
    const { mm, sent } = harness();
    const codes = new Set<string>();
    for (let i = 1; i <= 40; i++) {
      mm.createLobby(i, `host${i}`, 0);
      const msg = last(sent.get(i), 'lobby');
      if (msg?.t === 'lobby') codes.add(msg.code);
    }
    expect(codes.size).toBe(40);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z]{6}$/);
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

    // Both lobbies expire once nothing happened in them for long enough;
    // the people in them are told.
    mm.tickClock(LOBBY_IDLE_MS);
    expect(last(sent.get(1), 'error')).toBeUndefined();
    mm.tickClock(LOBBY_IDLE_MS + 1);
    const notice = last(sent.get(1), 'error');
    expect(notice?.t === 'error' && notice.message).toBe('Lobby expired.');
    // The expired code is joinable no more.
    mm.joinLobby(3, 'carol', 'BBBBB');
    const refusal = last(sent.get(3), 'error');
    expect(refusal?.t === 'error' && refusal.message).toBe('Lobby not found or full.');
  });
});

// Lane preferences at champion select (ADR 0026): claimed live before Lock
// in, first come, first served inside the team, told to the own team only,
// kept through the timeout and a disconnect, and settled so every seat
// enters the match with one concrete lane.
describe('lane claims at select', () => {
  const SIGILS: [string, string] = ['riftstep', 'mend'];

  // A lobby of four: 1 and 3 on team 0 (seats 0 and 2), 2 and 4 on team 1
  // (seats 1 and 3), in that seat order.
  function lobbyOfFour(opts: MatchmakerOptions = {}) {
    const h = harness(opts);
    h.mm.createLobby(1, 'p1');
    const lobby = last(h.sent.get(1), 'lobby');
    const code = lobby?.t === 'lobby' ? lobby.code : '';
    for (let id = 2; id <= 4; id++) h.mm.joinLobby(id, `p${id}`, code);
    h.mm.startLobby(1, 0);
    return h;
  }

  const claimsOf = (msgs: ServerMsg[] | undefined): SelectClaim[] | undefined => {
    const m = last(msgs, 'select_update');
    return m?.t === 'select_update' ? m.claims : undefined;
  };
  const count = (msgs: ServerMsg[] | undefined): number =>
    msgs?.filter((m) => m.t === 'select_update').length ?? 0;
  const lanesOf = (picks: MatchPick[] | undefined, clientId: number) =>
    picks?.find((p) => p.clientId === clientId)?.lanes;

  it('tells each seat its own index among the players, names being no identity', () => {
    const { sent } = lobbyOfFour();
    for (let id = 1; id <= 4; id++) {
      const m = last(sent.get(id), 'select_start');
      expect(m?.t).toBe('select_start');
      if (m?.t !== 'select_start') continue;
      expect(m.self).toBe(id - 1);
      expect(m.players[m.self]).toEqual({ name: `p${id}`, team: m.team });
    }
  });

  it('first come, first served: a teammate on a full lane is refused and told alone', () => {
    const { mm, sent, matches } = lobbyOfFour();
    mm.setLane(1, 'mid');
    expect(claimsOf(sent.get(3))).toEqual([
      { seat: 0, lane: 'mid', locked: false },
      { seat: 2, lane: null, locked: false },
    ]);
    const before1 = count(sent.get(1));
    mm.setLane(3, 'mid');
    // Refused: the claimer alone hears back, with its own seat unclaimed.
    expect(count(sent.get(1))).toBe(before1);
    expect(claimsOf(sent.get(3))).toEqual([
      { seat: 0, lane: 'mid', locked: false },
      { seat: 2, lane: null, locked: false },
    ]);
    // The other side has its own mid.
    mm.setLane(2, 'mid');
    expect(claimsOf(sent.get(4))?.find((c) => c.seat === 1)?.lane).toBe('mid');
    mm.pick(1, 'fenn', SIGILS);
    mm.pick(2, 'elowen', SIGILS);
    mm.pick(3, 'sylra', SIGILS);
    mm.pick(4, 'dain', SIGILS);
    expect(lanesOf(matches[0], 1)).toEqual(['mid']);
    expect(lanesOf(matches[0], 2)).toEqual(['mid']);
    // A mage whose home lane is taken settles where there is most room.
    expect(lanesOf(matches[0], 3)).toEqual(['top']);
  });

  it("never shows a team the other side's claims", () => {
    const { mm, sent } = lobbyOfFour();
    const enemyBefore = count(sent.get(2)) + count(sent.get(4));
    mm.setLane(1, 'jungle');
    mm.setLane(3, 'bot');
    // A claim goes to its own team only, not even as a bare update.
    expect(count(sent.get(2)) + count(sent.get(4))).toBe(enemyBefore);
    mm.pick(1, 'korrath', SIGILS);
    mm.setLane(2, 'top');
    mm.pick(2, 'vesk', SIGILS);
    for (const [id, seats] of [
      [1, [0, 2]],
      [3, [0, 2]],
      [2, [1, 3]],
      [4, [1, 3]],
    ] as const) {
      for (const m of sent.get(id) ?? []) {
        if (m.t !== 'select_update') continue;
        expect(m.claims.map((c) => c.seat)).toEqual(seats);
      }
    }
    expect(claimsOf(sent.get(4))).toEqual([
      { seat: 1, lane: 'top', locked: true },
      { seat: 3, lane: null, locked: false },
    ]);
  });

  it('carries a claim on the lock, and a full lane there keeps the earlier claim', () => {
    const { mm, matches } = lobbyOfFour();
    mm.setLane(1, 'bot');
    mm.pick(3, 'korrath', SIGILS, 0, undefined, 'jungle');
    // The forest holds one: fenn keeps bot lane.
    mm.pick(1, 'fenn', SIGILS, 0, undefined, 'jungle');
    mm.pick(2, 'vesk', SIGILS, 0, undefined, 'river');
    mm.pick(4, 'maera', SIGILS);
    expect(lanesOf(matches[0], 1)).toEqual(['bot']);
    expect(lanesOf(matches[0], 3)).toEqual(['jungle']);
    // No ask at all is the home lane.
    expect(lanesOf(matches[0], 2)).toEqual(['bot']);
    expect(lanesOf(matches[0], 4)).toEqual(['bot']);
  });

  it('keeps a claim through a disconnect and the timeout', () => {
    const { mm, matches } = lobbyOfFour();
    mm.setLane(1, 'jungle');
    mm.setLane(2, 'top');
    mm.removeEverywhere(2);
    expect(matches).toHaveLength(0);
    mm.tickClock(10 * 60 * 1000);
    expect(matches).toHaveLength(1);
    expect(lanesOf(matches[0], 1)).toEqual(['jungle']);
    expect(lanesOf(matches[0], 2)).toEqual(['top']);
    // The seats that never claimed nor locked settle on their default.
    expect(lanesOf(matches[0], 3)).toEqual(['mid']);
  });

  it("settles every seat of a full select on one concrete lane, within the team's room", () => {
    const { mm, matches } = harness();
    for (let i = 1; i <= 10; i++) mm.addToQueue(i, `p${i}`, 0);
    for (let i = 1; i <= 10; i++) mm.pick(i, 'sylra', SIGILS);
    expect(matches).toHaveLength(1);
    for (const team of [0, 1] as const) {
      const lanes = matches[0]!.filter((p) => p.team === team).map((p) => p.lanes);
      expect(lanes.every((l) => l?.length === 1)).toBe(true);
      const tally = (lane: string) => lanes.filter((l) => l?.[0] === lane).length;
      // Nobody is sent to the forest unasked: two top, one mid, two bot.
      expect([tally('top'), tally('mid'), tally('bot'), tally('jungle')]).toEqual([2, 1, 2, 0]);
    }
  });

  it('ignores anything but the four lanes, and a claim outside a select', () => {
    const { mm, sent } = lobbyOfFour();
    const before = count(sent.get(1));
    mm.setLane(1, 'river');
    mm.setLane(1, null);
    expect(count(sent.get(1))).toBe(before);
    const lone = harness();
    lone.mm.setLane(9, 'mid');
    expect(lone.sent.size).toBe(0);
  });

  it('a coach seat claims its playbook lane, the bot seated ahead of any choice', () => {
    const seat: BotSeat = {
      name: 'Nightfall',
      championId: 'sylra',
      sigils: ['zephyr', 'sear'],
      skin: 0,
      playbook: { ...NEW_BOT_PLAYBOOK, lanes: ['bot', 'mid'] },
      botId: 'bot_0123456789abcdef',
      version: 1,
    };
    const { mm, sent, matches } = lobbyOfFour({
      resolveBot: (clientId, botId) => (clientId === 1 && botId === 'bot_1' ? seat : null),
    });
    mm.setLane(3, 'bot');
    mm.pick(3, 'vesk', SIGILS);
    // Room for two in bot lane: the bot joins without moving anyone.
    mm.pick(1, 'korrath', SIGILS, 0, 'bot_1');
    expect(claimsOf(sent.get(3))).toEqual([
      { seat: 0, lane: 'bot', locked: true },
      { seat: 2, lane: 'bot', locked: true },
    ]);
    // Its lane is the playbook's, so a claim from the coach is refused.
    mm.setLane(1, 'top');
    expect(claimsOf(sent.get(1))?.[0]).toEqual({ seat: 0, lane: 'bot', locked: true });
    mm.pick(2, 'fenn', SIGILS);
    mm.pick(4, 'dain', SIGILS);
    expect(matches[0]![0]).toMatchObject({ clientId: 1, lanes: ['bot'], championId: 'sylra' });
    expect(lanesOf(matches[0], 3)).toEqual(['bot']);
  });

  it("a coach seat's fixed lane releases the latest person in its way, who hears it", () => {
    const seat: BotSeat = {
      name: 'Nightfall',
      championId: 'korrath',
      sigils: ['zephyr', 'sear'],
      skin: 0,
      playbook: { ...NEW_BOT_PLAYBOOK, lanes: ['mid'] },
      botId: 'bot_0123456789abcdef',
      version: 1,
    };
    const { mm, sent, matches } = lobbyOfFour({
      resolveBot: (clientId, botId) => (clientId === 1 && botId === 'bot_1' ? seat : null),
    });
    mm.setLane(3, 'mid');
    mm.pick(1, 'korrath', SIGILS, 0, 'bot_1');
    expect(claimsOf(sent.get(3))).toEqual([
      { seat: 0, lane: 'mid', locked: true },
      { seat: 2, lane: null, locked: false },
    ]);
    mm.setLane(3, 'mid');
    expect(claimsOf(sent.get(3))?.[1]?.lane).toBeNull();
    mm.pick(3, 'sylra', SIGILS);
    mm.pick(2, 'fenn', SIGILS);
    mm.pick(4, 'dain', SIGILS);
    expect(lanesOf(matches[0], 1)).toEqual(['mid']);
    expect(lanesOf(matches[0], 3)).toEqual(['top']);
  });
});

// A private lobby outlives its match (ADR 0036): its members are remembered
// by account, it waits while its select, match or party plays, and it
// reopens for the next round.
describe('a lobby that outlives its match', () => {
  const SIGILS: [string, string] = ['riftstep', 'mend'];
  type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;
  const view = (msgs: ServerMsg[] | undefined): LobbyMsg | undefined => {
    const m = last(msgs, 'lobby');
    return m?.t === 'lobby' ? m : undefined;
  };

  // Sockets are numbered as the server numbers them; accounts says whose
  // each one is, as main.ts's resolveAccount answers.
  function lobbyHarness(
    opts: MatchmakerOptions = {},
    ready?: (picks: MatchPick[]) => number | undefined,
  ) {
    const accounts = new Map<number, number>();
    const h = harness({ resolveAccount: (c) => accounts.get(c) ?? null, ...opts }, ready);
    const open = (clientId: number, account: number, name: string, now = 0): string => {
      accounts.set(clientId, account);
      return h.mm.createLobby(clientId, name, now) ?? '';
    };
    const join = (clientId: number, account: number, name: string, code: string, now = 0) => {
      accounts.set(clientId, account);
      return h.mm.joinLobby(clientId, name, code, now);
    };
    return { ...h, accounts, open, join };
  }

  // Opener 1 (account 101) and friend 2 (account 102) start and play
  // match 1.
  function played(opts: MatchmakerOptions = {}) {
    const h = lobbyHarness(opts);
    const code = h.open(1, 101, 'host');
    h.join(2, 102, 'friend', code);
    h.mm.startLobby(1, 0);
    h.mm.pick(1, 'fenn', SIGILS);
    h.mm.pick(2, 'vesk', SIGILS);
    return { ...h, code };
  }

  it('answers its code while it plays, and a newcomer waits for the next match', () => {
    const { mm, sent, matches, sources, code, join } = played();
    expect(matches).toHaveLength(1);
    expect(sources).toEqual(['lobby']);
    // Every seat it sent carries its code.
    expect(matches[0]!.map((p) => p.lobby)).toEqual([code, code]);
    expect(mm.lobbyInvite(code)).toEqual({ host: 'host', players: 2, phase: 'match' });
    expect(join(3, 103, 'late', code)).toBe('joined');
    expect(last(sent.get(3), 'error')).toBeUndefined();
    expect(view(sent.get(3))).toEqual({
      t: 'lobby',
      code,
      host: false,
      team: 0,
      phase: 'match',
      players: [
        { n: 1, name: 'host', team: 0, playing: true },
        { n: 2, name: 'friend', team: 1, playing: true },
        { n: 3, name: 'late', team: 0, you: true },
      ],
    });
    // Nobody hosts while it plays.
    mm.startLobby(3, 0);
    expect(last(sent.get(3), 'select_start')).toBeUndefined();
  });

  it('reopens when its match is over: members on new sockets land on their side, the opener hosts', () => {
    const { mm, sent, code, join } = played();
    join(3, 103, 'late', code);
    // The match's sockets close at its end.
    expect(mm.removeEverywhere(1, 900, 'drop')).toBe(false);
    expect(mm.removeEverywhere(2, 900, 'drop')).toBe(false);
    mm.matchOver(1, 1000);
    // The waiter sees the two coming back; the opener hosts through it.
    expect(view(sent.get(3))?.players).toEqual([
      { n: 1, name: 'host', team: 0, host: true, back: true },
      { n: 2, name: 'friend', team: 1, back: true },
      { n: 3, name: 'late', team: 0, you: true },
    ]);
    expect(view(sent.get(3))?.phase).toBeUndefined();
    join(12, 102, 'friend', code, 2000);
    join(11, 101, 'host', code, 2000);
    expect(view(sent.get(12))).toMatchObject({ team: 1, host: false });
    expect(view(sent.get(11))).toMatchObject({ team: 0, host: true });
    expect(view(sent.get(11))?.players.map((p) => p.n)).toEqual([1, 2, 3]);
    // Another match's end, or this one's again, changes nothing.
    const before = sent.get(11)!.length;
    mm.matchOver(1, 3000);
    mm.matchOver(99, 3000);
    expect(sent.get(11)!.length).toBe(before);
    mm.startLobby(11, 3000);
    for (const id of [11, 12, 3]) expect(last(sent.get(id), 'select_start')).toBeDefined();
  });

  it('waits for those coming back before a start, until their grace ends', () => {
    const { mm, sent, code, join } = played();
    mm.matchOver(1, 1000);
    join(11, 101, 'host', code, 1000);
    mm.startLobby(11, 1000);
    expect(last(sent.get(11), 'select_start')).toBeUndefined();
    expect(view(sent.get(11))?.notice).toBe('1 player is coming back from the match.');
    mm.tickClock(1000 + RETURN_GRACE_MS);
    expect(view(sent.get(11))?.players).toHaveLength(1);
    expect(view(sent.get(11))?.notice).toBeUndefined();
    mm.startLobby(11, 1000 + RETURN_GRACE_MS);
    expect(last(sent.get(11), 'select_start')).toBeDefined();
  });

  it('passes the host on when the host leaves, and gives it back on return', () => {
    const { mm, sent, open, join } = lobbyHarness();
    const code = open(1, 101, 'host');
    join(2, 102, 'b', code);
    join(3, 103, 'c', code);
    expect(mm.removeEverywhere(1, 0, 'leave')).toBe(true);
    expect(view(sent.get(2))?.host).toBe(true);
    join(11, 101, 'host', code);
    expect(view(sent.get(11))?.host).toBe(true);
    expect(view(sent.get(2))?.host).toBe(false);
    // A dropped socket (a reload) keeps the host through its grace.
    mm.removeEverywhere(11, 10, 'drop');
    expect(view(sent.get(2))?.host).toBe(false);
    mm.startLobby(2, 10);
    expect(last(sent.get(2), 'select_start')).toBeUndefined();
    mm.tickClock(10 + DROP_GRACE_MS);
    expect(view(sent.get(2))?.host).toBe(true);
  });

  it('a lobby select that loses everyone reopens the lobby and starts no match', () => {
    const { mm, matches, sent, open, join } = lobbyHarness();
    const code = open(1, 101, 'host');
    join(2, 102, 'friend', code);
    mm.startLobby(1, 0);
    mm.removeEverywhere(1, 5, 'drop');
    mm.removeEverywhere(2, 5, 'drop');
    expect(matches).toHaveLength(0);
    expect(mm.lobbyInvite(code)).toEqual({ host: 'host', players: 0 });
    join(11, 101, 'host', code, 10);
    expect(view(sent.get(11))).toMatchObject({ host: true, team: 0 });
  });

  it('a match that could not start sends its lobby back, and a throw is no match', () => {
    for (const ready of [
      () => undefined,
      () => {
        throw new Error('setup failed');
      },
    ]) {
      const { mm, sent, open, join } = lobbyHarness({}, ready);
      const code = open(1, 101, 'host');
      join(2, 102, 'friend', code);
      mm.startLobby(1, 0);
      mm.pick(1, 'fenn', SIGILS);
      expect(() => mm.pick(2, 'vesk', SIGILS)).not.toThrow();
      for (const id of [1, 2]) {
        expect(view(sent.get(id))).toMatchObject({
          notice: 'The match could not start. Try again.',
          host: id === 1,
        });
        expect(view(sent.get(id))).not.toHaveProperty('phase');
      }
      expect(mm.lobbyInvite(code)).toEqual({ host: 'host', players: 2 });
    }
  });

  it("a member's second socket takes over; the old socket's close leaves them in", () => {
    const { mm, sent, open, join } = lobbyHarness();
    const code = open(1, 101, 'host');
    join(2, 102, 'friend', code);
    join(22, 102, 'friend', code);
    expect(view(sent.get(22))?.players).toEqual([
      { n: 1, name: 'host', team: 0, host: true },
      { n: 2, name: 'friend', team: 1, you: true },
    ]);
    expect(mm.removeEverywhere(2, 0, 'drop')).toBe(false);
    expect(mm.lobbyInvite(code)?.players).toBe(2);
    // The same socket joining again is told again, nothing else.
    join(22, 102, 'friend', code);
    expect(view(sent.get(22))?.players).toHaveLength(2);
  });

  it('a playing lobby lives on; an empty one expires; one never played goes when left', () => {
    const left = lobbyHarness();
    const a = left.open(1, 101, 'a');
    left.mm.removeEverywhere(1, 0, 'leave');
    expect(left.mm.lobbyInvite(a)).toBeNull();

    // A reload of a fresh lobby keeps it through the drop grace.
    const dropped = lobbyHarness();
    const b = dropped.open(1, 101, 'b');
    dropped.mm.removeEverywhere(1, 0, 'drop');
    dropped.mm.tickClock(DROP_GRACE_MS - 1);
    expect(dropped.mm.lobbyInvite(b)).not.toBeNull();
    dropped.mm.tickClock(DROP_GRACE_MS);
    expect(dropped.mm.lobbyInvite(b)).toBeNull();

    const { mm, code } = played();
    mm.tickClock(LOBBY_IDLE_MS + LOBBY_TTL_MS);
    expect(mm.lobbyInvite(code)?.phase).toBe('match');
    // A match end never reported: the play guard reopens it.
    const t = LOBBY_PLAY_GUARD_MS + 1;
    mm.tickClock(t);
    expect(mm.lobbyInvite(code)).toEqual({ host: 'host', players: 0 });
    mm.tickClock(t + LOBBY_TTL_MS);
    expect(mm.lobbyInvite(code)).not.toBeNull();
    mm.tickClock(t + LOBBY_TTL_MS + 1);
    expect(mm.lobbyInvite(code)).toBeNull();
  });

  it('the cap: the lobby empty the longest gives way past its grace, else a refusal', () => {
    const { mm, sent, open } = lobbyHarness({ maxLobbies: 2 });
    // Two lobbies whose selects lost everyone: open, played, empty.
    const a = open(1, 101, 'a', 0);
    mm.startLobby(1, 0);
    mm.removeEverywhere(1, 0, 'drop');
    const b = open(2, 102, 'b', 1000);
    mm.startLobby(2, 1000);
    mm.removeEverywhere(2, 1000, 'drop');
    expect(mm.lobbyCount).toBe(2);
    expect(open(3, 103, 'c', 100_000)).toBe('');
    const refusal = last(sent.get(3), 'error');
    expect(refusal?.t === 'error' && refusal.message).toBe(
      'Too many private lobbies are open right now. Try again in a bit.',
    );
    expect(open(4, 104, 'd', 180_500)).not.toBe('');
    expect(mm.lobbyInvite(a)).toBeNull();
    expect(mm.lobbyInvite(b)).not.toBeNull();
    expect(mm.lobbyCount).toBe(2);
  });

  it('waiters cannot take seats or sides held by members in play', () => {
    const { mm, sent, open, join } = lobbyHarness();
    const code = open(1, 101, 'p1');
    for (let i = 2; i <= 5; i++) join(i, 100 + i, `p${i}`, code);
    mm.startLobby(1, 0);
    // Three of the five in play sit on side 0, two on side 1.
    for (let i = 6; i <= 10; i++) expect(join(i, 100 + i, `p${i}`, code)).toBe('joined');
    expect(view(sent.get(6))?.team).toBe(1);
    expect(join(11, 111, 'p11', code)).toBe('refused');
    const refusal = last(sent.get(11), 'error');
    expect(refusal?.t === 'error' && refusal.message).toBe('Lobby not found or full.');
    mm.setLobbyTeam(6, 0);
    expect(view(sent.get(6))?.team).toBe(1);
  });

  it('a party keeps its lobby: it queues, plays and comes back to it', () => {
    const { mm, sent, matches, sources, open, join } = lobbyHarness();
    const code = open(1, 101, 'host');
    join(2, 102, 'friend', code);
    mm.queuePartyFromLobby(1, 0);
    expect(mm.lobbyInvite(code)?.phase).toBe('queue');
    mm.startNow(2, 0);
    expect(mm.lobbyInvite(code)?.phase).toBe('select');
    mm.pick(1, 'fenn', SIGILS);
    mm.pick(2, 'vesk', SIGILS);
    expect(sources).toEqual(['queue']);
    expect(matches[0]!.map((p) => p.lobby)).toEqual([code, code]);
    expect(mm.lobbyInvite(code)?.phase).toBe('match');
    mm.matchOver(1, 5000);
    join(11, 101, 'host', code, 5000);
    expect(view(sent.get(11))).toMatchObject({ host: true, team: 0 });
    expect(view(sent.get(11))).not.toHaveProperty('phase');
  });

  it('a party whose queue empties reopens its lobby', () => {
    const { mm, sent, open, join } = lobbyHarness();
    const code = open(1, 101, 'host');
    join(2, 102, 'friend', code);
    join(3, 103, 'third', code);
    mm.removeEverywhere(3, 0, 'leave');
    mm.queuePartyFromLobby(1, 0);
    join(4, 104, 'waiter', code);
    expect(view(sent.get(4))?.players.filter((p) => p.playing)).toHaveLength(2);
    expect(mm.removeEverywhere(2, 0, 'leave')).toBe(true);
    expect(view(sent.get(4))?.players.filter((p) => p.playing)).toHaveLength(1);
    expect(mm.lobbyInvite(code)?.phase).toBe('queue');
    mm.removeEverywhere(1, 0, 'leave');
    expect(mm.queuedCount).toBe(0);
    expect(mm.lobbyInvite(code)?.phase).toBeUndefined();
    // The one waiting hosts now.
    expect(view(sent.get(4))?.host).toBe(true);
  });

  it('a party waits for a member still locked out of the queue', () => {
    const { mm, sent, open, join } = lobbyHarness({
      queueLockedMs: (accountId) => (accountId === 102 ? 30_500 : 0),
    });
    const code = open(1, 101, 'host');
    join(2, 102, 'friend', code);
    mm.queuePartyFromLobby(1, 0);
    expect(view(sent.get(1))?.notice).toBe(
      'friend left a rated match. The party can queue in 31s.',
    );
    expect(view(sent.get(2))?.notice).toBe('You left a rated match. The party can queue in 31s.');
    expect(mm.queuedCount).toBe(0);
    expect(last(sent.get(1), 'error')).toBeUndefined();
  });

  it('the host removes a member, who is told and refused from then on', () => {
    const { mm, sent, open, join } = lobbyHarness();
    const code = open(1, 101, 'host');
    join(2, 102, 'friend', code);
    join(3, 103, 'third', code);
    // Nobody else removes anyone, and the host never themselves.
    mm.removeMember(3, 2);
    mm.removeMember(1, 1);
    expect(mm.lobbyInvite(code)?.players).toBe(3);
    mm.removeMember(1, 2);
    const told = last(sent.get(2), 'error');
    expect(told?.t === 'error' && told.message).toBe('You were removed from the lobby.');
    expect(view(sent.get(1))?.players.map((p) => p.n)).toEqual([1, 3]);
    expect(join(22, 102, 'friend', code)).toBe('refused');
    expect(mm.remembers(code, 102)).toBe(false);
    expect(mm.remembers(code, 103)).toBe(true);
  });

  it('follows a Guest renamed or retired into an account', () => {
    const { mm, sent, open, join } = lobbyHarness();
    const code = open(1, -5, 'Wanderer 0005');
    join(2, 102, 'friend', code);
    mm.renameLive(-5, 'Ash');
    expect(view(sent.get(2))?.players[0]?.name).toBe('Ash');
    expect(mm.lobbyInvite(code)?.host).toBe('Ash');
    mm.renameMember(-5, 77);
    mm.removeEverywhere(1, 0, 'leave');
    expect(view(sent.get(2))?.host).toBe(true);
    join(11, 77, 'Ash', code);
    expect(view(sent.get(11))).toMatchObject({ host: true, team: 0 });
    expect(view(sent.get(11))?.players).toHaveLength(2);
  });

  it('says what a join came to, and counts the lobbies a connection holds open', () => {
    const { mm, open, join } = lobbyHarness();
    expect(join(9, 109, 'lost', 'ZZZZZZ')).toBe('unknown');
    const a = open(1, 101, 'a');
    mm.createLobby(2, 'b', 0, 'k');
    mm.createLobby(3, 'c', 0, 'k');
    expect(mm.openLobbiesFrom('k')).toBe(2);
    expect(mm.openLobbiesFrom('k', 2)).toBe(1);
    mm.removeEverywhere(3, 0, 'drop');
    expect(mm.openLobbiesFrom('k')).toBe(1);
    expect(join(4, 104, 'd', a.toLowerCase())).toBe('joined');
  });

  it('a held seat goes back into the match, and a walk-out gives it up', () => {
    const { mm, sent, code, join } = played();
    join(3, 103, 'late', code);
    // The friend's match socket drops; a new lobby socket finds the seat held.
    mm.removeEverywhere(2, 0, 'drop');
    join(22, 102, 'friend', code);
    expect(view(sent.get(22))).toMatchObject({ phase: 'match', seat: true });
    // Its hello takes the seat back: the socket is in the match now.
    mm.enteredMatch(22, 102, 1);
    expect(view(sent.get(3))?.players.map((p) => p.playing ?? false)).toEqual([true, true, false]);
    // The opener walks out for good.
    mm.leftMatch(101, 1);
    expect(view(sent.get(3))?.players.map((p) => p.n)).toEqual([2, 3]);
    mm.matchOver(1, 1000);
    // The friend who played is waited for, and hosts through the wait as
    // the veteran; the opener who walked out is not shown.
    expect(view(sent.get(3))?.players).toEqual([
      { n: 2, name: 'friend', team: 1, host: true, back: true },
      { n: 3, name: 'late', team: 0, you: true },
    ]);
  });
});
