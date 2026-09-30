// Matchmaker gate: queue, the bot fill that takes the whole queue, private lobbies,
// champion select locking, timeout defaults, and disconnect handling.

import { describe, expect, it } from 'vitest';
import type { MatchPick } from '../server/match';
import {
  type BotSeat,
  LOBBY_TTL_MS,
  Matchmaker,
  type MatchmakerOptions,
  type MatchSource,
} from '../server/matchmaker';
import type { SelectClaim, ServerMsg } from '../src/net/protocol';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';

function harness(opts: MatchmakerOptions = {}): {
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

  it('does not carry a player who left the queue before Start', () => {
    const { mm, sent } = harness();
    mm.addToQueue(1, 'alice', 0);
    mm.addToQueue(2, 'bob', 0);
    mm.removeEverywhere(2, 0);
    mm.startNow(1, 0);
    expect(last(sent.get(1), 'select_start')).toBeDefined();
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
