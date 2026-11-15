// A private lobby's record and its rules (ADR 0036): a lobby outlives its
// match. Its members are remembered by account, so a friend who comes back
// from the match on a new socket lands on their own side, and the opener
// hosts again. Pure: server/matchmaker.ts holds the records and sends the
// messages, wall-clock time comes in as arguments. A lobby lives in memory
// only; a restart forgets every lobby.

import type { LobbyPlayer, ServerMsg } from '../src/net/protocol';
import type { TeamId } from '../src/sim/types';

// open: the members wait in the lobby for its next match. queue: the lobby
// sent a party into the Ranked queue. select and match: its members are in
// its champion select or match.
export type LobbyPhase = 'open' | 'queue' | 'select' | 'match';

export interface LobbyMember {
  // The member's number in this lobby, from 1, never reused.
  n: number;
  // Whose member it is, read at join while the socket is open; null when
  // nobody could say, and then it never matches anyone.
  accountId: number | null;
  // The live lobby socket while present; null while away or in play.
  clientId: number | null;
  // The socket that went into the lobby's queue, select or match.
  playClientId: number | null;
  name: string;
  team: TeamId;
  // Holds a seat in the lobby's running queue, select or match.
  inPlay: boolean;
  // Played the lobby's last match: hosts before the others.
  veteran: boolean;
  // A grace: coming back from the match, or a dropped socket.
  awayUntil: number | null;
  // The grace is a way back from the lobby's match (a back row).
  returning: boolean;
  // Removed by the host: the code refuses this account.
  removed: boolean;
}

export interface Lobby {
  // Six letters.
  code: string;
  // Join order; [0] is the opener and is never forgotten.
  members: LobbyMember[];
  phase: LobbyPhase;
  // Bumps on every start, party and reopen; queue groups and select
  // entries carry it, so a stale one never moves the lobby.
  round: number;
  matchId: number | null;
  createdAt: number;
  // Join, side switch, start, party, reopen, rename.
  lastActivity: number;
  // When an open lobby last had nobody present.
  emptySince: number | null;
  // When it left 'open' for 'select' or 'match' (the play guard).
  startedAt: number | null;
  // The opener's connection key (per-connection caps), never written anywhere.
  createdBy: string | null;
  // The next member's number.
  nextN: number;
}

// Lobbies held at once (MatchmakerOptions.maxLobbies overrides it).
export const MAX_LOBBIES = 200;
// An open lobby with nobody in it expires this long after it emptied.
export const LOBBY_TTL_MS = 30 * 60_000;
// An open lobby with people in it and no activity expires after this long.
export const LOBBY_IDLE_MS = 2 * 3_600_000;
// A select or match whose end was never reported reopens after this long.
export const LOBBY_PLAY_GUARD_MS = 3 * 3_600_000;
// The cap only evicts an empty lobby that has stayed empty this long.
export const LOBBY_EVICT_GRACE_MS = 3 * 60_000;
// How long a member coming back from the match is waited for.
export const RETURN_GRACE_MS = 60_000;
// How long a dropped socket's member is waited for (a reload).
export const DROP_GRACE_MS = 60_000;
// Members remembered per lobby at most.
export const LOBBY_MEMORY = 20;
// Seats in a lobby, and on each side.
export const LOBBY_SEATS = 10;
export const LOBBY_SIDE = 5;

// Who a new lobby or member is: the socket, the account behind it, the name.
export interface Joiner {
  clientId: number | null;
  accountId: number | null;
  name: string;
}

// A new lobby with its opener on the first side.
export function openLobby(
  code: string,
  opener: Joiner,
  now: number,
  createdBy: string | null,
): Lobby {
  const lobby: Lobby = {
    code,
    members: [],
    phase: 'open',
    round: 0,
    matchId: null,
    createdAt: now,
    lastActivity: now,
    emptySince: opener.clientId === null ? now : null,
    startedAt: null,
    createdBy,
    nextN: 1,
  };
  addMember(lobby, { ...opener, team: 0 });
  return lobby;
}

// Appends a member on the given side and returns it.
export function addMember(lobby: Lobby, who: Joiner & { team: TeamId }): LobbyMember {
  const member: LobbyMember = {
    n: lobby.nextN++,
    accountId: who.accountId,
    clientId: who.clientId,
    playClientId: null,
    name: who.name,
    team: who.team,
    inPlay: false,
    veteran: false,
    awayUntil: null,
    returning: false,
    removed: false,
  };
  lobby.members.push(member);
  return member;
}

// In the lobby right now, on a lobby socket.
export function isPresent(m: LobbyMember): boolean {
  return m.clientId !== null;
}

// Holds one of the lobby's ten seats: present, or in its play.
export function isSeated(m: LobbyMember): boolean {
  return !m.removed && (m.clientId !== null || m.inPlay);
}

// Away within a grace (a way back from the match, or a dropped socket).
export function withinGrace(m: LobbyMember, now: number): boolean {
  return m.awayUntil !== null && now < m.awayUntil;
}

// Coming back from the lobby's match, not here yet: a back row.
export function comingBack(m: LobbyMember, now: number): boolean {
  return !m.removed && !isPresent(m) && m.returning && withinGrace(m, now);
}

// Away within a grace of either kind: back from the match, or dropped.
export function awayInGrace(m: LobbyMember, now: number): boolean {
  return !m.removed && !isPresent(m) && withinGrace(m, now);
}

// Seats taken, on one side or both.
export function seatedCount(lobby: Lobby, team?: TeamId): number {
  return lobby.members.filter((m) => isSeated(m) && (team === undefined || m.team === team)).length;
}

export function anyonePresent(lobby: Lobby): boolean {
  return lobby.members.some(isPresent);
}

// Members coming back from the match right now.
export function returningCount(lobby: Lobby, now: number): number {
  return lobby.members.filter((m) => comingBack(m, now)).length;
}

// The present member on this socket.
export function memberOnSocket(lobby: Lobby, clientId: number): LobbyMember | undefined {
  return lobby.members.find((m) => m.clientId === clientId);
}

// The member behind a known account; null never matches.
export function memberOfAccount(lobby: Lobby, accountId: number | null): LobbyMember | undefined {
  if (accountId === null) return undefined;
  return lobby.members.find((m) => m.accountId === accountId);
}

// Who hosts: while open, the first in the order opener, veterans of the
// last match in join order, everyone else in join order, who is present
// or within a grace. An away host holds it through the grace, and nobody
// can start until they are back or it ends. Nobody hosts while not open.
export function hostOf(lobby: Lobby, now: number): LobbyMember | null {
  if (lobby.phase !== 'open') return null;
  const [opener, ...rest] = lobby.members;
  const order = [
    ...(opener ? [opener] : []),
    ...rest.filter((m) => m.veteran),
    ...rest.filter((m) => !m.veteran),
  ];
  for (const m of order) {
    if (!m.removed && (isPresent(m) || withinGrace(m, now))) return m;
  }
  return null;
}

// What a join_lobby finds. already: this socket is in it. rebind: the
// member is present on another socket. seat: an absent member comes back
// (held: its seat in play is kept, and it is always let in). new: a
// newcomer with a free seat. refused: full, or removed by the host.
export type Admission =
  | { kind: 'refused' }
  | { kind: 'already'; member: LobbyMember }
  | { kind: 'rebind'; member: LobbyMember }
  | { kind: 'seat'; member: LobbyMember; team: TeamId; held: boolean }
  | { kind: 'new'; team: TeamId };

export function admit(lobby: Lobby, clientId: number, accountId: number | null): Admission {
  const here = memberOnSocket(lobby, clientId);
  if (here) return { kind: 'already', member: here };
  const known = memberOfAccount(lobby, accountId);
  if (known?.removed) return { kind: 'refused' };
  if (known && isPresent(known)) return { kind: 'rebind', member: known };
  if (known?.inPlay) return { kind: 'seat', member: known, team: known.team, held: true };
  if (seatedCount(lobby) >= LOBBY_SEATS) return { kind: 'refused' };
  if (known) {
    const other: TeamId = known.team === 0 ? 1 : 0;
    const team = seatedCount(lobby, known.team) < LOBBY_SIDE ? known.team : other;
    return { kind: 'seat', member: known, team, held: false };
  }
  return { kind: 'new', team: seatedCount(lobby, 0) <= seatedCount(lobby, 1) ? 0 : 1 };
}

// Keeps at most LOBBY_MEMORY members: the oldest absent one goes first,
// never the opener, one in play or one within a grace. A removed member
// counts, so a removed account stays refused unless pushed out.
export function forgetOldest(lobby: Lobby, now: number): void {
  while (lobby.members.length > LOBBY_MEMORY) {
    const i = lobby.members.findIndex(
      (m, idx) => idx > 0 && !isPresent(m) && !m.inPlay && !withinGrace(m, now),
    );
    if (i === -1) return;
    lobby.members.splice(i, 1);
  }
}

// Keeps emptySince true to who is present while the lobby is open.
export function notePresence(lobby: Lobby, now: number): void {
  if (lobby.phase !== 'open' || anyonePresent(lobby)) lobby.emptySince = null;
  else lobby.emptySince ??= now;
}

// Back to open for the next round. From a match, those who played and are
// not here yet are waited for through the return grace (back rows).
export function reopen(lobby: Lobby, now: number, fromMatch: boolean): void {
  lobby.phase = 'open';
  lobby.round++;
  lobby.matchId = null;
  lobby.startedAt = null;
  lobby.lastActivity = now;
  for (const m of lobby.members) {
    if (!m.inPlay) continue;
    m.inPlay = false;
    m.playClientId = null;
    if (fromMatch && !isPresent(m)) {
      m.awayUntil = now + RETURN_GRACE_MS;
      m.returning = true;
    }
  }
  lobby.emptySince = null;
  notePresence(lobby, now);
}

// Clears the graces that ran out; true when any did (the rows change).
export function spendGraces(lobby: Lobby, now: number): boolean {
  let spent = false;
  for (const m of lobby.members) {
    if (m.awayUntil !== null && now >= m.awayUntil) {
      m.awayUntil = null;
      m.returning = false;
      spent = true;
    }
  }
  return spent;
}

// What the clock does to a lobby. drop: an open lobby nobody is in, gone
// without a word (one that never played once its drop grace ends, any
// other after LOBBY_TTL_MS). expire: an open lobby with people in it and
// no activity for LOBBY_IDLE_MS, its members told. reopen: a select or
// match never reported over. A queued lobby waits for its group.
export type LobbyFate = 'keep' | 'drop' | 'expire' | 'reopen';

export function fateOf(lobby: Lobby, now: number): LobbyFate {
  if (lobby.phase === 'select' || lobby.phase === 'match') {
    const started = lobby.startedAt ?? lobby.lastActivity;
    return now - started > LOBBY_PLAY_GUARD_MS ? 'reopen' : 'keep';
  }
  if (lobby.phase === 'queue') return 'keep';
  if (!anyonePresent(lobby)) {
    if (lobby.emptySince === null) return 'keep';
    const empty = now - lobby.emptySince;
    if (lobby.round === 0) return empty >= DROP_GRACE_MS ? 'drop' : 'keep';
    return empty > LOBBY_TTL_MS ? 'drop' : 'keep';
  }
  return now - lobby.lastActivity > LOBBY_IDLE_MS ? 'expire' : 'keep';
}

// Whether the cap may evict this lobby: open, nobody in it, and empty for
// longer than LOBBY_EVICT_GRACE_MS.
export function evictable(lobby: Lobby, now: number): boolean {
  return (
    lobby.phase === 'open' &&
    !anyonePresent(lobby) &&
    lobby.emptySince !== null &&
    now - lobby.emptySince > LOBBY_EVICT_GRACE_MS
  );
}

// A Guest retired into an account (registration, Discord): its record
// takes the new id. When both ids are members, the earlier record stays,
// with the sockets and the play of both, and the other goes. True when the
// lobby changed.
export function mergeAccounts(lobby: Lobby, from: number, to: number): boolean {
  if (from === to) return false;
  const a = lobby.members.findIndex((m) => m.accountId === from);
  if (a === -1) return false;
  const b = lobby.members.findIndex((m) => m.accountId === to);
  if (b === -1) {
    lobby.members[a]!.accountId = to;
    return true;
  }
  const keep = lobby.members[Math.min(a, b)]!;
  const gone = lobby.members[Math.max(a, b)]!;
  keep.accountId = to;
  keep.clientId ??= gone.clientId;
  keep.playClientId ??= gone.playClientId;
  keep.inPlay ||= gone.inPlay;
  keep.veteran ||= gone.veteran;
  keep.removed ||= gone.removed;
  if (gone.awayUntil !== null && (keep.awayUntil === null || gone.awayUntil > keep.awayUntil)) {
    keep.awayUntil = gone.awayUntil;
    keep.returning ||= gone.returning;
  }
  lobby.members.splice(lobby.members.indexOf(gone), 1);
  return true;
}

// The rows everyone sees: the seated members, then those coming back from
// the match through their grace as back rows; a removed member never.
export function rowsOf(lobby: Lobby, recipient: LobbyMember | null, now: number): LobbyPlayer[] {
  const host = hostOf(lobby, now);
  const rows: LobbyPlayer[] = [];
  for (const m of lobby.members) {
    const seated = isSeated(m);
    // Not here but expected: back from the lobby's match, or a socket that
    // dropped, within its grace. Shown, so whoever waits for them (a host
    // whose phone slept included) is named.
    if (!seated && !awayInGrace(m, now)) continue;
    rows.push({
      n: m.n,
      name: m.name,
      team: m.team,
      ...(m === host ? { host: true as const } : {}),
      ...(m === recipient ? { you: true as const } : {}),
      ...(!seated ? { back: true as const } : {}),
      ...(m.inPlay ? { playing: true as const } : {}),
    });
  }
  return rows;
}

export type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;

// The lobby message for one present member: whether they host, their own
// side, the rows, the phase while the lobby plays, their held seat in its
// select or match, and a notice when one is given.
export function lobbyMessage(
  lobby: Lobby,
  recipient: LobbyMember,
  now: number,
  notice?: string,
): LobbyMsg {
  const playing = lobby.phase === 'select' || lobby.phase === 'match';
  return {
    t: 'lobby',
    code: lobby.code,
    host: hostOf(lobby, now) === recipient,
    team: recipient.team,
    players: rowsOf(lobby, recipient, now),
    ...(lobby.phase !== 'open' ? { phase: lobby.phase } : {}),
    ...(playing && recipient.inPlay ? { seat: true as const } : {}),
    ...(notice !== undefined ? { notice } : {}),
  };
}
