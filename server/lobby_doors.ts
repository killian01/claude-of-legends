// The private lobby's doors on the socket (ADR 0036): what main.ts does
// with each lobby message before the Matchmaker sees it. A code is asked
// through the connection's budget of wrong codes, a lobby is opened through
// its budget of lobbies (server/code_guess.ts), and a start or a party at a
// full server is refused with a notice on the lobby, which stays standing.
// The caller keeps a socket seated in a live match out of here.
//
// Also what a lobby's seats carry on match_start: the code of the lobby
// each seat came from, and whether the match scores on the ladder.

import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { CREATE_LIMIT_MESSAGE, LIMITED_MESSAGE, lobbyCode } from './code_guess';
import type { MatchPick } from './match';

export const CAPACITY_MESSAGE = 'The server is at capacity, try again in a bit.';
export const NOT_FOUND_MESSAGE = 'Lobby not found or full.';

export type LobbyDoorMsg = Extract<
  ClientMsg,
  {
    t:
      | 'create_lobby'
      | 'join_lobby'
      | 'lobby_team'
      | 'start_lobby'
      | 'queue_party'
      | 'lobby_remove';
  }
>;

const DOORS: ReadonlySet<string> = new Set<LobbyDoorMsg['t']>([
  'create_lobby',
  'join_lobby',
  'lobby_team',
  'start_lobby',
  'queue_party',
  'lobby_remove',
]);

export function isLobbyDoor(msg: ClientMsg): msg is LobbyDoorMsg {
  return DOORS.has(msg.t);
}

// The socket asking: its account (negative for a Guest), its name, and its
// connection's budget key (code_guess.ts budgetKey), never written anywhere.
export interface LobbyDoorClient {
  id: number;
  accountId: number;
  name: string;
  budgetKey: string;
}

export interface LobbyDoorDeps {
  // The classic Matchmaker, which holds the lobbies.
  lobbies: {
    createLobby(clientId: number, name: string, now: number, key: string | null): string | null;
    joinLobby(clientId: number, name: string, code: string, now: number): string;
    setLobbyTeam(clientId: number, team: unknown, now: number): void;
    startLobby(clientId: number, now: number): void;
    queuePartyFromLobby(clientId: number, now: number): void;
    refuseStart(clientId: number, message: string, now: number): void;
    removeMember(clientId: number, n: unknown, now: number): void;
    remembers(code: string, accountId: number | null): boolean;
    openLobbiesFrom(key: string, exceptClientId: number | null): number;
  };
  guard: {
    mayCreate(key: string, now: number, openFromKey: number): boolean;
    issued(code: string, now: number): void;
    limited(key: string, now: number, member: boolean): boolean;
    miss(key: string, code: string | null, now: number): void;
  };
  // Leaves the places outside the lobbies (the Forge queue) on the way in.
  leaveOthers(clientId: number, now: number): void;
  send(clientId: number, msg: ServerMsg): void;
}

export function lobbyDoor(
  msg: LobbyDoorMsg,
  client: LobbyDoorClient,
  atCapacity: boolean,
  deps: LobbyDoorDeps,
  now: number,
): void {
  const { lobbies, guard } = deps;
  const id = client.id;
  const key = client.budgetKey;
  switch (msg.t) {
    case 'create_lobby': {
      if (atCapacity) {
        deps.send(id, { t: 'error', message: CAPACITY_MESSAGE });
        return;
      }
      if (!guard.mayCreate(key, now, lobbies.openLobbiesFrom(key, id))) {
        deps.send(id, { t: 'error', message: CREATE_LIMIT_MESSAGE });
        return;
      }
      deps.leaveOthers(id, now);
      const code = lobbies.createLobby(id, client.name, now, key);
      if (code !== null) guard.issued(code, now);
      return;
    }
    case 'join_lobby': {
      const code = lobbyCode((msg as { code?: unknown }).code);
      if (code === null) {
        guard.miss(key, null, now);
        deps.send(id, { t: 'error', message: NOT_FOUND_MESSAGE });
        return;
      }
      if (guard.limited(key, now, lobbies.remembers(code, client.accountId))) {
        deps.send(id, { t: 'error', message: LIMITED_MESSAGE });
        return;
      }
      deps.leaveOthers(id, now);
      if (lobbies.joinLobby(id, client.name, code, now) === 'unknown') guard.miss(key, code, now);
      return;
    }
    case 'lobby_team':
      lobbies.setLobbyTeam(id, msg.team, now);
      return;
    case 'start_lobby':
      if (atCapacity) lobbies.refuseStart(id, CAPACITY_MESSAGE, now);
      else lobbies.startLobby(id, now);
      return;
    case 'queue_party':
      // Every present member's queue lockout is read inside, through the
      // Matchmaker's queueLockedMs.
      if (atCapacity) lobbies.refuseStart(id, CAPACITY_MESSAGE, now);
      else lobbies.queuePartyFromLobby(id, now);
      return;
    case 'lobby_remove':
      lobbies.removeMember(id, msg.member, now);
      return;
  }
}

// The lobby each seat of a new match came from, by unit (a pick carries
// its lobby's code, server/match.ts MatchPick): unitOf(i) is the unit of
// the i-th pick.
export function lobbyOfUnits(
  picks: readonly Pick<MatchPick, 'lobby'>[],
  unitOf: (index: number) => number | undefined,
): Map<number, string> {
  const out = new Map<number, string>();
  picks.forEach((p, i) => {
    if (p.lobby === undefined) return;
    const unit = unitOf(i);
    if (unit !== undefined) out.set(unit, p.lobby);
  });
  return out;
}

// What a seat's match_start says beyond the seat: the lobby it came from
// (unitId null for a seat that came from none, a drop-in), and scores when
// the match banks points on the ladder.
export function seatTags(
  entry: { lobbyOfUnit: ReadonlyMap<number, string>; points: unknown },
  unitId: number | null,
): { lobby?: string; scores?: true } {
  const lobby = unitId === null ? undefined : entry.lobbyOfUnit.get(unitId);
  return {
    ...(lobby !== undefined ? { lobby } : {}),
    ...(entry.points !== null ? { scores: true as const } : {}),
  };
}
