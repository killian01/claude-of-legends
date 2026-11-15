// The private lobby's doors on the socket (ADR 0036): each lobby message
// goes through the connection's budgets (server/code_guess.ts) and the
// server's capacity before it reaches the Matchmaker, and every refusal
// inside a lobby that stays standing is a notice, never an error.

import { describe, expect, it } from 'vitest';
import {
  CodeGuard,
  CREATE_LIMIT_MESSAGE,
  CREATES_ALLOWED,
  LIMITED_MESSAGE,
  WRONG_CODES_ALLOWED,
} from '../server/code_guess';
import {
  CAPACITY_MESSAGE,
  isLobbyDoor,
  type LobbyDoorClient,
  lobbyDoor,
  lobbyOfUnits,
  NOT_FOUND_MESSAGE,
  seatTags,
} from '../server/lobby_doors';
import type { MatchPick } from '../server/match';
import { Matchmaker, type MatchmakerOptions } from '../server/matchmaker';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';

function world(opts: MatchmakerOptions = {}) {
  const sent = new Map<number, ServerMsg[]>();
  const send = (clientId: number, msg: ServerMsg): void => {
    const list = sent.get(clientId) ?? [];
    list.push(msg);
    sent.set(clientId, list);
  };
  const accounts = new Map<number, number>();
  let n = 0;
  const codes = ['QWERTY', 'ASDFGH', 'ZXCVBN', 'POIUYT', 'LKJHGF', 'MNBVCX', 'TREWQA'];
  const matches: MatchPick[][] = [];
  const mm = new Matchmaker(
    send,
    (picks) => {
      matches.push(picks);
      return matches.length;
    },
    () => codes[n++ % codes.length]!,
    { resolveAccount: (cid) => accounts.get(cid) ?? null, ...opts },
  );
  const guard = new CodeGuard();
  const forgeLeft: number[] = [];
  const deps = {
    lobbies: mm,
    guard,
    leaveOthers: (cid: number) => forgeLeft.push(cid),
    send,
  };
  const client = (id: number, accountId: number, key = 'home'): LobbyDoorClient => {
    accounts.set(id, accountId);
    return { id, name: `p${id}`, budgetKey: key, accountId };
  };
  const door = (msg: ClientMsg, c: LobbyDoorClient, now = 0, atCapacity = false): void => {
    if (!isLobbyDoor(msg)) throw new Error(`not a lobby door: ${msg.t}`);
    lobbyDoor(msg, c, atCapacity, deps, now);
  };
  return { mm, guard, sent, matches, forgeLeft, client, door };
}

const last = (msgs: ServerMsg[] | undefined, t: string): ServerMsg | undefined =>
  msgs?.filter((m) => m.t === t).at(-1);

describe('the lobby doors', () => {
  it('are the six lobby messages and nothing else', () => {
    for (const t of [
      'create_lobby',
      'join_lobby',
      'lobby_team',
      'start_lobby',
      'queue_party',
      'lobby_remove',
    ]) {
      expect(isLobbyDoor({ t } as ClientMsg)).toBe(true);
    }
    expect(isLobbyDoor({ t: 'queue' })).toBe(false);
    expect(isLobbyDoor({ t: 'hello' })).toBe(false);
  });

  it('open a lobby, leaving the other queue, and remember its code as issued', () => {
    const { guard, sent, forgeLeft, client, door } = world();
    door({ t: 'create_lobby' }, client(1, 101), 5);
    const lobby = last(sent.get(1), 'lobby');
    expect(lobby).toMatchObject({ t: 'lobby', code: 'QWERTY', host: true });
    expect(forgeLeft).toEqual([1]);
    expect(guard.tombstoned('QWERTY', 5)).toBe(true);
  });

  it('refuse a new lobby at a full server, and open nothing', () => {
    const { mm, sent, client, door } = world();
    door({ t: 'create_lobby' }, client(1, 101), 0, true);
    expect(last(sent.get(1), 'error')).toEqual({ t: 'error', message: CAPACITY_MESSAGE });
    expect(mm.lobbyCount).toBe(0);
  });

  it('refuse a connection that opened too many lobbies', () => {
    const { mm, sent, client, door } = world();
    // One socket opening again and again: each create leaves the last one.
    const c = client(1, 101);
    for (let i = 0; i < CREATES_ALLOWED; i++) door({ t: 'create_lobby' }, c, i);
    door({ t: 'create_lobby' }, c, 100);
    expect(last(sent.get(1), 'error')).toEqual({ t: 'error', message: CREATE_LIMIT_MESSAGE });
    expect(mm.lobbyCount).toBe(1);
    // Another connection has its own budget.
    door({ t: 'create_lobby' }, client(2, 102, 'away'), 100);
    expect(last(sent.get(2), 'lobby')).toBeDefined();
  });

  it('refuse a sixth lobby held open at once from one connection', () => {
    const { mm, sent, client, door } = world();
    for (let id = 1; id <= 5; id++) door({ t: 'create_lobby' }, client(id, 100 + id), 0);
    expect(mm.lobbyCount).toBe(5);
    door({ t: 'create_lobby' }, client(6, 106), 0);
    expect(last(sent.get(6), 'error')).toEqual({ t: 'error', message: CREATE_LIMIT_MESSAGE });
    expect(mm.lobbyCount).toBe(5);
  });

  it('join a lobby by its code in any case', () => {
    const { sent, forgeLeft, client, door } = world();
    door({ t: 'create_lobby' }, client(1, 101), 0);
    door({ t: 'join_lobby', code: 'qwerty' }, client(2, 102), 0);
    const lobby = last(sent.get(2), 'lobby') as Extract<ServerMsg, { t: 'lobby' }>;
    expect(lobby.code).toBe('QWERTY');
    expect(lobby.players.map((p) => p.name)).toEqual(['p1', 'p2']);
    expect(forgeLeft).toEqual([1, 2]);
  });

  it('answer a join that is not a code as an unknown one, charged once as malformed', () => {
    const { guard, sent, client, door } = world();
    const c = client(2, 102);
    door({ t: 'join_lobby', code: 42 } as unknown as ClientMsg, c, 0);
    door({ t: 'join_lobby', code: 'AB' }, c, 0);
    expect(sent.get(2)).toEqual([
      { t: 'error', message: NOT_FOUND_MESSAGE },
      { t: 'error', message: NOT_FOUND_MESSAGE },
    ]);
    expect(guard.misses('home', 0)).toBe(2);
  });

  it('charge an unknown code once, however many times it is asked', () => {
    const { guard, sent, client, door } = world();
    const c = client(2, 102);
    door({ t: 'join_lobby', code: 'NOPENO' }, c, 0);
    door({ t: 'join_lobby', code: 'nopeno' }, c, 1);
    expect(last(sent.get(2), 'error')).toEqual({ t: 'error', message: NOT_FOUND_MESSAGE });
    expect(guard.misses('home', 1)).toBe(1);
  });

  it('never charge a code this process issued, once its lobby is gone', () => {
    const { mm, guard, client, door } = world();
    door({ t: 'create_lobby' }, client(1, 101), 0);
    mm.removeEverywhere(1, 0, 'leave');
    expect(mm.lobbyCount).toBe(0);
    door({ t: 'join_lobby', code: 'QWERTY' }, client(2, 102), 1);
    expect(guard.misses('home', 1)).toBe(0);
  });

  it('stop a connection over its budget, except a member going back to their own lobby', () => {
    const { sent, client, door } = world();
    door({ t: 'create_lobby' }, client(1, 101, 'host'), 0);
    door({ t: 'join_lobby', code: 'QWERTY' }, client(2, 102), 0);
    const guesser = client(3, 103);
    for (let i = 0; i < WRONG_CODES_ALLOWED; i++) {
      door({ t: 'join_lobby', code: `WRONG${String.fromCharCode(65 + i)}` }, guesser, 1);
    }
    door({ t: 'join_lobby', code: 'QWERTY' }, guesser, 2);
    expect(last(sent.get(3), 'error')).toEqual({ t: 'error', message: LIMITED_MESSAGE });
    expect(last(sent.get(3), 'lobby')).toBeUndefined();
    // The member who was in the lobby, on the same connection, comes back.
    const back = client(4, 102);
    door({ t: 'join_lobby', code: 'QWERTY' }, back, 2);
    expect(last(sent.get(4), 'lobby')).toBeDefined();
    expect(last(sent.get(4), 'error')).toBeUndefined();
  });

  it('switch a side', () => {
    const { sent, client, door } = world();
    door({ t: 'create_lobby' }, client(1, 101), 0);
    door({ t: 'lobby_team', team: 1 }, client(1, 101), 0);
    const lobby = last(sent.get(1), 'lobby') as Extract<ServerMsg, { t: 'lobby' }>;
    expect(lobby.team).toBe(1);
  });

  it("start the host's lobby, or tell its members the server is full", () => {
    const { sent, client, door } = world();
    const host = client(1, 101);
    door({ t: 'create_lobby' }, host, 0);
    door({ t: 'join_lobby', code: 'QWERTY' }, client(2, 102), 0);
    door({ t: 'start_lobby' }, host, 1, true);
    expect(last(sent.get(1), 'select_start')).toBeUndefined();
    expect(last(sent.get(2), 'lobby')).toMatchObject({ notice: CAPACITY_MESSAGE });
    expect(last(sent.get(1), 'error')).toBeUndefined();
    door({ t: 'start_lobby' }, host, 2);
    expect(last(sent.get(1), 'select_start')).toBeDefined();
    expect(last(sent.get(2), 'select_start')).toBeDefined();
  });

  it("queue the host's party, or tell its members why not", () => {
    const locked = new Map([[102, 42_000]]);
    const { sent, client, door } = world({ queueLockedMs: (a) => locked.get(a) ?? 0 });
    const host = client(1, 101);
    door({ t: 'create_lobby' }, host, 0);
    door({ t: 'join_lobby', code: 'QWERTY' }, client(2, 102), 0);
    door({ t: 'queue_party' }, host, 1, true);
    expect(last(sent.get(1), 'lobby')).toMatchObject({ notice: CAPACITY_MESSAGE });
    door({ t: 'queue_party' }, host, 1);
    expect(last(sent.get(1), 'lobby')).toMatchObject({
      notice: 'p2 left a rated match. The party can queue in 42s.',
    });
    expect(last(sent.get(2), 'lobby')).toMatchObject({
      notice: 'You left a rated match. The party can queue in 42s.',
    });
    expect(last(sent.get(1), 'queue_status')).toBeUndefined();
    locked.clear();
    door({ t: 'queue_party' }, host, 2);
    expect(last(sent.get(1), 'queue_status')).toBeDefined();
    expect(last(sent.get(2), 'queue_status')).toBeDefined();
  });

  it('let the host remove a member, who is told', () => {
    const { sent, client, door } = world();
    const host = client(1, 101);
    door({ t: 'create_lobby' }, host, 0);
    door({ t: 'join_lobby', code: 'QWERTY' }, client(2, 102), 0);
    const rows = (last(sent.get(1), 'lobby') as Extract<ServerMsg, { t: 'lobby' }>).players;
    const n = rows.find((r) => r.name === 'p2')!.n;
    door({ t: 'lobby_remove', member: n }, host, 1);
    expect(last(sent.get(2), 'error')).toEqual({
      t: 'error',
      message: 'You were removed from the lobby.',
    });
    door({ t: 'join_lobby', code: 'QWERTY' }, client(3, 102), 2);
    expect(last(sent.get(3), 'error')).toEqual({ t: 'error', message: NOT_FOUND_MESSAGE });
  });
});

describe("a lobby's seats in its match", () => {
  const pick = (clientId: number, lobby?: string): MatchPick => ({
    clientId,
    name: `p${clientId}`,
    team: 0,
    championId: 'sylra',
    sigils: ['riftstep', 'mend'],
    ...(lobby ? { lobby } : {}),
  });

  it('are known by unit, for the seats that came from a lobby', () => {
    const units = [11, 12, 13];
    const map = lobbyOfUnits([pick(1, 'QWERTY'), pick(2), pick(3, 'ASDFGH')], (i) => units[i]);
    expect([...map]).toEqual([
      [11, 'QWERTY'],
      [13, 'ASDFGH'],
    ]);
  });

  it('skip a pick the match has no unit for', () => {
    expect(lobbyOfUnits([pick(1, 'QWERTY')], () => undefined).size).toBe(0);
  });

  it('carry the lobby and whether the match scores on match_start', () => {
    const entry = { lobbyOfUnit: new Map([[11, 'QWERTY']]), points: null };
    expect(seatTags(entry, 11)).toEqual({ lobby: 'QWERTY' });
    expect(seatTags(entry, 12)).toEqual({});
    const queued = { lobbyOfUnit: new Map([[11, 'QWERTY']]), points: {} };
    expect(seatTags(queued, 11)).toEqual({ lobby: 'QWERTY', scores: true });
    // A drop-in: never a lobby's seat.
    expect(seatTags(queued, null)).toEqual({ scores: true });
  });
});
