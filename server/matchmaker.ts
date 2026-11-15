// Pre-match flow: the queue, private lobbies by code, and the champion
// select session. Transport-agnostic: outbound messages go through the
// injected send, wall-clock time comes in as arguments, and a ready match
// is handed to the injected callback as a list of picks. A private lobby
// outlives its match (ADR 0036): its record and rules are server/lobby.ts,
// and this holds the records and runs them.

import { randomInt } from 'node:crypto';
import type { SelectClaim, ServerMsg } from '../src/net/protocol';
import {
  CHAMPION_LIST,
  CHAMPIONS,
  type ChampionRole,
  DEFAULT_CHAMPION_ID,
  homeLane,
} from '../src/sim/content/champions';
import { SIGILS } from '../src/sim/content/sigils';
import { clampSkin } from '../src/sim/content/skins';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { isLanePreference, laneOpen, settleLanes } from '../src/sim/lane_picks';
import type { LanePreference, PlaybookDef } from '../src/sim/playbook/types';
import type { TeamId } from '../src/sim/types';
import {
  addMember,
  admit,
  anyonePresent,
  DROP_GRACE_MS,
  evictable,
  fateOf,
  forgetOldest,
  hostOf,
  isPresent,
  LOBBY_SIDE,
  type Lobby,
  type LobbyMember,
  lobbyMessage,
  MAX_LOBBIES,
  memberOfAccount,
  memberOnSocket,
  mergeAccounts,
  notePresence,
  openLobby,
  reopen,
  returningCount,
  seatedCount,
  spendGraces,
} from './lobby';
import type { MatchPick } from './match';
import { packGroups } from './party';

export {
  DROP_GRACE_MS,
  LOBBY_IDLE_MS,
  LOBBY_PLAY_GUARD_MS,
  LOBBY_TTL_MS,
  MAX_LOBBIES,
  RETURN_GRACE_MS,
} from './lobby';

export const MATCH_SIZE = 10;
export const TEAM_CAP = MATCH_SIZE / 2;
export const SELECT_SECONDS = 45;
const DEFAULT_SIGILS: [string, string] = ['riftstep', 'mend'];

interface Pending {
  clientId: number;
  name: string;
}

// Which private lobby a queue group or a select seat came from, and the
// lobby's round when it left: a stale one never moves the lobby.
interface LobbyTag {
  code: string;
  round: number;
}

// The queue holds GROUPS: a solo player is a group of one, a party (a
// lobby that queued together) stays whole and lands on one side.
interface QueueGroup {
  members: Pending[];
  botReady: boolean;
  lobby?: LobbyTag;
}

interface SelectEntry extends Pending {
  team: TeamId;
  // Whose seat it is (MatchmakerOptions.resolveAccount), read as the
  // select started; null when nobody could say.
  accountId: number | null;
  // forged rides along when the locked champion is a forged definition the
  // resolver approved for this client; match setup embeds it in the picks.
  locked: {
    championId: string;
    sigils: [string, string];
    skin: number;
    forged?: ForgedChampionDef;
    // A bot seat (ADR 0013): the account's own bot, resolved by the
    // account boundary; its playbook rides into the picks.
    playbook?: PlaybookDef;
    botName?: string;
    botId?: string;
    botVersion?: number;
  } | null;
  // The lane the seat claimed (CONTEXT.md: Lane preference; ADR 0026),
  // null while it claims none: live before Lock in, first come, first
  // served inside the team, kept through an auto-lock. A bot seat's claim
  // is its own (claimFor).
  lane: LanePreference | null;
  // When the claim was made, in the session's claim order: the earlier
  // claim settles first.
  claimedAt: number;
  // The player left during the select (a closed socket, a match entered
  // from another tab): the seat goes to its bot when the match starts.
  left?: true;
  // The private lobby this seat came from.
  lobby?: LobbyTag;
}

// Where a match came from: only public-queue matches are ever rated
// (a private lobby would be a boosting machine otherwise).
export type MatchSource = 'queue' | 'lobby';

interface SelectSession {
  entries: SelectEntry[];
  deadline: number;
  started: boolean;
  source: MatchSource;
  // Claims made so far, the clock claimedAt reads.
  claims: number;
}

// The lanes of the seats beside this one on its team that claim one.
function claimsBeside(session: SelectSession, entry: SelectEntry): LanePreference[] {
  const out: LanePreference[] = [];
  for (const e of session.entries) {
    if (e !== entry && e.team === entry.team && e.lane !== null) out.push(e.lane);
  }
  return out;
}

// A bot seat whose playbook states its lanes (ADR 0013): the sim seats the
// playbook's ahead of anything chosen at select, so its claim is fixed.
function fixedLane(entry: SelectEntry): LanePreference | null {
  return entry.locked?.playbook?.lanes?.[0] ?? null;
}

// Whether a claim on one lane takes room from another: the same lane, or
// top and the forest, which share two seats (src/sim/lane_picks.ts).
function crowds(a: LanePreference, b: LanePreference): boolean {
  const shared = (l: LanePreference): boolean => l === 'top' || l === 'jungle';
  return a === b || (shared(a) && shared(b));
}

function roleOfEntry(entry: SelectEntry): ChampionRole | null {
  const id = entry.locked?.championId ?? DEFAULT_CHAMPION_ID;
  return CHAMPIONS[id]?.role ?? entry.locked?.forged?.role ?? null;
}

// One lane for every seat of the select, each team settled on its own
// (src/sim/lane_picks.ts): the bot seats' fixed lanes first, then every
// claim in the order it came, then the seats that claim none, in seat
// order, each on its default over what is taken. What the match seats
// each person with, so nobody's home lane steals a lane claimed first.
function settleSelect(session: SelectSession): Map<SelectEntry, LanePreference> {
  const out = new Map<SelectEntry, LanePreference>();
  const rank = (e: SelectEntry): number => (fixedLane(e) ? 0 : e.lane !== null ? 1 : 2);
  for (const team of [0, 1] as const) {
    const order = session.entries
      .filter((e) => e.team === team)
      .sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? a.claimedAt - b.claimedAt : 0));
    const lanes = settleLanes(order.map((e) => ({ role: roleOfEntry(e), lane: e.lane })));
    for (const [i, e] of order.entries()) out.set(e, lanes[i]!);
  }
  return out;
}

// One seat entering a select: a queue seat alternates sides by position, a
// lobby seat carries its side; a seat from a private lobby carries it.
type Seat = Pending & { team?: TeamId; lobby?: LobbyTag };

type Send = (clientId: number, msg: ServerMsg) => void;
// Starts the match and returns its id; nothing back, or a throw, means no
// match started (a lobby's members are then sent back to it).
// Typed loosely so a callback that returns nothing still fits.
type OnMatchReady = (picks: MatchPick[], source: MatchSource) => unknown;

// What a join_lobby came to: joined, an unknown code (the caller charges
// the asker a wrong code, server/code_guess.ts), or refused (full, or
// removed by the host). Both refusals answer alike.
export type JoinOutcome = 'joined' | 'unknown' | 'refused';

// How a socket left: 'leave' (the lobby's Leave, Return to menu, another
// mode) or 'drop' (the socket closed without a leave: its lobby waits for
// it through a grace, and a seat in play stays held).
export type LeaveHow = 'leave' | 'drop';

// What the landing's invitation card reads of a lobby: the opener's name,
// the seats taken, and the phase while it plays.
export interface LobbyInvite {
  host: string;
  players: number;
  phase?: 'queue' | 'select' | 'match';
}

const NOT_FOUND = 'Lobby not found or full.';
const TOO_MANY_LOBBIES = 'Too many private lobbies are open right now. Try again in a bit.';
const PARTY_TOO_BIG =
  'A party of up to five can queue together; a full lobby starts its own match.';
const COULD_NOT_START = 'The match could not start. Try again.';

function comingBackNotice(n: number): string {
  return n === 1
    ? '1 player is coming back from the match.'
    : `${n} players are coming back from the match.`;
}

// The Forge queue (plan-forge phase 6) is a second Matchmaker instance
// with these options: its selects are tagged so clients offer the forged
// roster, and the resolver is the account boundary, answering with the
// definition when THIS client may play that forged champion and null
// otherwise. The Matchmaker itself stays account-blind.
// The account's own bot in a seat (ADR 0013): what the resolver hands
// back when THIS client owns the bot.
export interface BotSeat {
  name: string;
  championId: string;
  sigils: [string, string];
  skin: number;
  playbook: PlaybookDef;
  // The bot and the playbook version playing, for its Record at the end.
  botId: string;
  version: number;
}

export interface MatchmakerOptions {
  forge?: boolean;
  resolveForged?: (clientId: number, championId: string) => ForgedChampionDef | null;
  resolveBot?: (clientId: number, botId: string) => BotSeat | null;
  // What THIS client may pick of the roster: its collection plus the
  // week's rotation (ADR 0018). The same account boundary the other two
  // resolvers are, so the Matchmaker stays account-blind. Absent, or null
  // for a client, means no wall: the practice match and the tests pick
  // freely.
  resolvePlayable?: (clientId: number) => readonly string[] | null;
  // Whose seat a client is: the account's id, negative for a Guest
  // (server/guests.ts). Asked once per seat as its select starts, when
  // every seat's socket is still open, and carried on the pick, so a seat
  // whose socket closes during the select still says whose it is. Absent,
  // or null for a client, and the pick says nothing. A lobby reads it at
  // join and at create, to remember its members by account.
  resolveAccount?: (clientId: number) => number | null;
  // How many private lobbies may be held at once (default MAX_LOBBIES).
  maxLobbies?: number;
  // How long an account's queue lockout still runs (a rated match left),
  // 0 when none: a lobby's party queues only when no member is locked out.
  queueLockedMs?: (accountId: number) => number;
}

// Crypto-random codes: a counter transform was reproducible offline, so any
// third party could enumerate live lobbies. Ambiguous letters are excluded.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
function randomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return code;
}

export class Matchmaker {
  private readonly queue: QueueGroup[] = [];
  private readonly lobbies = new Map<string, Lobby>();
  private readonly selects: SelectSession[] = [];
  private readonly maxLobbies: number;

  constructor(
    private readonly send: Send,
    private readonly onMatchReady: OnMatchReady,
    // Injectable for tests; production uses the crypto-random default.
    private readonly codeGen: () => string = randomCode,
    private readonly opts: MatchmakerOptions = {},
  ) {
    this.maxLobbies = opts.maxLobbies ?? MAX_LOBBIES;
  }

  // Private lobbies held right now.
  get lobbyCount(): number {
    return this.lobbies.size;
  }

  // People waiting in the queue right now (the drop-in rule and the
  // landing's presence line read it, ADR 0025).
  get queuedCount(): number {
    return this.queuedSeats();
  }

  private queuedSeats(): number {
    let seats = 0;
    for (const g of this.queue) seats += g.members.length;
    return seats;
  }

  private broadcastQueue(): void {
    // No countdown any more: Start takes the whole queue at once.
    const startsIn = null;
    const count = this.queuedSeats();
    for (const g of this.queue) {
      for (const p of g.members) {
        this.send(p.clientId, {
          t: 'queue_status',
          count,
          needed: MATCH_SIZE,
          startsIn,
          ready: g.botReady,
        });
      }
    }
  }

  private inSelect(clientId: number): SelectSession | null {
    for (const s of this.selects) {
      if (!s.started && s.entries.some((e) => e.clientId === clientId)) return s;
    }
    return null;
  }

  addToQueue(clientId: number, name: string, now: number): void {
    this.removeEverywhere(clientId, now);
    this.queue.push({ members: [{ clientId, name }], botReady: false });
    this.tryFormFullMatch(now);
    this.broadcastQueue();
  }

  // A whole lobby enters the public queue as one group on one side, and
  // the lobby waits for it (phase 'queue'). Only the host of an open lobby
  // may pull the trigger; a party larger than a team cannot queue (a full
  // lobby starts its own match), nor one with a member still locked out of
  // the queue. Every refusal is a notice: the lobby stays standing.
  queuePartyFromLobby(hostId: number, now: number = Date.now()): void {
    const lobby = this.lobbyHostedBy(hostId, now);
    if (!lobby) return;
    const present = lobby.members.filter(isPresent);
    if (present.length > TEAM_CAP) {
      this.broadcastLobby(lobby, now, PARTY_TOO_BIG);
      return;
    }
    if (this.refusedForReturners(lobby, now)) return;
    const lockedMs = this.opts.queueLockedMs;
    if (lockedMs) {
      const locked = present
        .map((m) => ({ m, ms: m.accountId === null ? 0 : lockedMs(m.accountId) }))
        .filter((x) => x.ms > 0)
        .sort((a, b) => b.ms - a.ms);
      if (locked.length > 0) {
        const secs = (ms: number): number => Math.ceil(ms / 1000);
        for (const r of present) {
          const own = locked.find((x) => x.m === r);
          const worst = locked[0]!;
          const notice = own
            ? `You left a rated match. The party can queue in ${secs(own.ms)}s.`
            : `${worst.m.name} left a rated match. The party can queue in ${secs(worst.ms)}s.`;
          this.send(r.clientId!, lobbyMessage(lobby, r, now, notice));
        }
        return;
      }
    }
    const players = this.takeIntoPlay(lobby, now, 'queue');
    this.queue.push({
      members: players.map((p) => ({ clientId: p.clientId, name: p.name })),
      botReady: false,
      lobby: { code: lobby.code, round: lobby.round },
    });
    this.tryFormFullMatch(now);
    this.broadcastQueue();
  }

  // Ten seats worth of whole groups: seat them (parties stay together)
  // and take those groups out of the queue. Groups that do not pack wait.
  private tryFormFullMatch(now: number): void {
    if (this.queuedSeats() < MATCH_SIZE) return;
    const seated = packGroups(
      this.queue.map((g) => g.members.length),
      MATCH_SIZE,
      TEAM_CAP,
      { exact: true },
    );
    if (!seated) return;
    const players: Seat[] = [];
    const groups: QueueGroup[] = [];
    for (const s of seated) {
      const group = this.queue[s.index]!;
      groups.push(group);
      for (const m of group.members) players.push({ ...m, team: s.team, lobby: group.lobby });
    }
    for (const s of [...seated].sort((a, b) => b.index - a.index)) this.queue.splice(s.index, 1);
    this.startSelect(players, now, 'queue');
    this.partiesSeated(groups, now);
  }

  // The lobbies whose parties a select just seated follow them into it.
  private partiesSeated(groups: readonly QueueGroup[], now: number): void {
    for (const g of groups) {
      const lobby = this.lobbyAt(g.lobby);
      if (lobby?.phase !== 'queue') continue;
      lobby.phase = 'select';
      lobby.startedAt = now;
      this.broadcastLobby(lobby, now);
    }
  }

  // Seat every bot-ready group into as many bot-filled matches as needed
  // (successive loose packs; a party never splits).
  private startReadyGroups(now: number): void {
    for (;;) {
      const ready = this.queue.filter((g) => g.botReady);
      if (ready.length === 0) return;
      const seated = packGroups(
        ready.map((g) => g.members.length),
        MATCH_SIZE,
        TEAM_CAP,
        { exact: false },
      );
      if (!seated || seated.length === 0) return;
      const players: Seat[] = [];
      const groups: QueueGroup[] = [];
      for (const s of seated) {
        const group = ready[s.index]!;
        groups.push(group);
        for (const m of group.members) players.push({ ...m, team: s.team, lobby: group.lobby });
        this.queue.splice(this.queue.indexOf(group), 1);
      }
      this.startSelect(players, now, 'queue');
      this.partiesSeated(groups, now);
    }
  }

  // The bot fill: whoever presses Start takes EVERYONE queued along, at
  // once, into as few bot-filled matches as the groups pack into. It used
  // to take only volunteers and leave the rest queued behind a ten-second
  // countdown for a human match, which on a server where two people are
  // rarely queued at the same moment meant the second one missed the
  // first (ADR 0025). Nobody queues here to wait for ten humans.
  startNow(clientId: number, now: number): void {
    if (!this.queue.some((g) => g.members.some((m) => m.clientId === clientId))) return;
    for (const g of this.queue) g.botReady = true;
    this.startReadyGroups(now);
    this.broadcastQueue();
  }

  // Opens a private lobby for this client, who hosts it, and returns its
  // code; null when refused (the cap). key: the opener's connection key
  // (server/code_guess.ts budgetKey), for the per-connection count.
  createLobby(
    clientId: number,
    name: string,
    now: number = Date.now(),
    key: string | null = null,
  ): string | null {
    this.removeEverywhere(clientId, now, 'leave');
    if (this.lobbies.size >= this.maxLobbies) {
      // One more than the cap makes room only by evicting the lobby left
      // empty the longest, and only past a grace: else the opener waits.
      let oldest: Lobby | null = null;
      for (const l of this.lobbies.values()) {
        if (evictable(l, now) && (!oldest || l.emptySince! < oldest.emptySince!)) oldest = l;
      }
      if (!oldest) {
        this.send(clientId, { t: 'error', message: TOO_MANY_LOBBIES });
        return null;
      }
      this.lobbies.delete(oldest.code);
    }
    let code = this.codeGen();
    for (let guard = 0; this.lobbies.has(code) && guard < 50; guard++) code = this.codeGen();
    if (this.lobbies.has(code)) {
      this.send(clientId, { t: 'error', message: 'Could not create a lobby, try again.' });
      return null;
    }
    const lobby = openLobby(
      code,
      { clientId, accountId: this.accountOf(clientId), name },
      now,
      key,
    );
    this.lobbies.set(code, lobby);
    this.broadcastLobby(lobby, now);
    return code;
  }

  // Joins a lobby by code, in any phase: a newcomer takes a free seat on
  // the emptier side, a remembered member comes back to their own side
  // when it has room, a member whose seat in play is held is always let
  // in, and the same account on a second socket moves to it. The joiner
  // leaves every other place it waits in first, never this lobby.
  joinLobby(clientId: number, name: string, code: string, now: number = Date.now()): JoinOutcome {
    const lobby = this.lobbies.get(String(code).toUpperCase());
    if (!lobby) {
      this.send(clientId, { t: 'error', message: NOT_FOUND });
      return 'unknown';
    }
    const accountId = this.accountOf(clientId);
    const first = admit(lobby, clientId, accountId);
    if (first.kind === 'already') {
      this.broadcastLobby(lobby, now);
      return 'joined';
    }
    if (first.kind === 'refused') {
      this.send(clientId, { t: 'error', message: NOT_FOUND });
      return 'refused';
    }
    this.leaveAll(clientId, now, 'leave', lobby);
    // Leaving a select or a queue of this very lobby changed its seats.
    const a = admit(lobby, clientId, accountId);
    let member: LobbyMember;
    if (a.kind === 'refused') {
      this.send(clientId, { t: 'error', message: NOT_FOUND });
      return 'refused';
    }
    if (a.kind === 'new') member = addMember(lobby, { clientId, accountId, name, team: a.team });
    else {
      member = a.member;
      member.clientId = clientId;
      if (a.kind === 'seat') member.team = a.team;
    }
    member.name = name;
    member.awayUntil = null;
    member.returning = false;
    lobby.lastActivity = now;
    notePresence(lobby, now);
    forgetOldest(lobby, now);
    this.broadcastLobby(lobby, now);
    return 'joined';
  }

  // A lobby member picks their side, in any phase. A full side (counting
  // the members in play) refuses silently: the client greys the button
  // out, and the 'error' channel would tear the lobby screen down.
  setLobbyTeam(clientId: number, team: unknown, now: number = Date.now()): void {
    if (team !== 0 && team !== 1) return;
    for (const lobby of this.lobbies.values()) {
      const member = memberOnSocket(lobby, clientId);
      if (!member) continue;
      if (member.team === team) return;
      if (seatedCount(lobby, team) >= LOBBY_SIDE) return;
      member.team = team;
      lobby.lastActivity = now;
      this.broadcastLobby(lobby, now);
      return;
    }
  }

  // The host of an open lobby starts its own match: every present member
  // goes into its champion select. Refused with a notice while members
  // are coming back from the last match.
  startLobby(clientId: number, now: number = Date.now()): void {
    const lobby = this.lobbyHostedBy(clientId, now);
    if (!lobby || this.refusedForReturners(lobby, now)) return;
    this.startSelect(this.takeIntoPlay(lobby, now, 'select'), now, 'lobby');
  }

  // A start or a party the caller refused (the server at capacity): the
  // lobby this client hosts hears why, and stays standing. A non-host's
  // Start is ignored, refused or not.
  refuseStart(clientId: number, message: string, now: number = Date.now()): void {
    const lobby = this.lobbyHostedBy(clientId, now);
    if (lobby) this.broadcastLobby(lobby, now, message);
  }

  // The host of an open lobby removes a member by number (never the host,
  // never the opener): forgotten from the rows, told if present, and the
  // code refuses that account from then on.
  removeMember(clientId: number, n: unknown, now: number = Date.now()): void {
    if (typeof n !== 'number') return;
    const lobby = this.lobbyHostedBy(clientId, now);
    if (!lobby) return;
    const target = lobby.members.find((m) => m.n === n && !m.removed);
    if (!target || target === lobby.members[0] || target.clientId === clientId) return;
    const socket = target.clientId;
    target.removed = true;
    target.clientId = null;
    target.awayUntil = null;
    target.returning = false;
    if (socket !== null) {
      this.send(socket, { t: 'error', message: 'You were removed from the lobby.' });
    }
    notePresence(lobby, now);
    this.broadcastLobby(lobby, now);
  }

  // The lobby's match is over (its winner, or however it closed): every
  // lobby playing it reopens, waiting for those who played. Any other id
  // does nothing, and so does a second call.
  matchOver(matchId: number, now: number = Date.now()): void {
    for (const lobby of this.lobbies.values()) {
      if (lobby.phase !== 'match' || lobby.matchId !== matchId) continue;
      reopen(lobby, now, true);
      this.broadcastLobby(lobby, now);
    }
  }

  // A socket took back a held seat in a lobby's match (the hello rejoin):
  // the member it belongs to plays on that socket. Found by the socket, or
  // by the account in the lobby playing that match.
  enteredMatch(
    clientId: number,
    accountId: number | null = null,
    matchId: number | null = null,
    now: number = Date.now(),
  ): void {
    for (const lobby of this.lobbies.values()) {
      if (lobby.phase !== 'match') continue;
      let member = memberOnSocket(lobby, clientId);
      if (!member?.inPlay) {
        member =
          matchId !== null && lobby.matchId === matchId
            ? memberOfAccount(lobby, accountId)
            : undefined;
      }
      if (!member?.inPlay || member.removed) continue;
      if (member.clientId === clientId) member.clientId = null;
      member.inPlay = true;
      member.playClientId = clientId;
      this.broadcastLobby(lobby, now);
      return;
    }
  }

  // A socket walked out of a lobby's match: its seat there is given up,
  // and it waits for the next one if it is in the lobby. The member is
  // found by the socket that plays, else by the account (a Guest retired
  // into an account mid-match still plays on a socket under the old id).
  leftMatch(
    clientId: number,
    accountId: number | null,
    matchId: number,
    now: number = Date.now(),
  ): void {
    for (const lobby of this.lobbies.values()) {
      if (lobby.phase !== 'match' || lobby.matchId !== matchId) continue;
      const member =
        lobby.members.find((m) => m.inPlay && m.playClientId === clientId) ??
        memberOfAccount(lobby, accountId);
      if (!member?.inPlay) continue;
      member.inPlay = false;
      member.playClientId = null;
      this.broadcastLobby(lobby, now);
    }
  }

  // A Guest retired into an account (registration, Discord): every lobby
  // remembers it under the new id, one record per person.
  renameMember(fromAccountId: number, toAccountId: number, now: number = Date.now()): void {
    for (const lobby of this.lobbies.values()) {
      if (!mergeAccounts(lobby, fromAccountId, toAccountId)) continue;
      const kept = memberOfAccount(lobby, toAccountId);
      if (kept?.removed && kept.clientId !== null) {
        this.send(kept.clientId, { t: 'error', message: 'You were removed from the lobby.' });
        kept.clientId = null;
      }
      notePresence(lobby, now);
      this.broadcastLobby(lobby, now);
    }
  }

  // A Guest's new name (POST /api/ladder/name), in every lobby at once.
  renameLive(accountId: number, name: string, now: number = Date.now()): void {
    for (const lobby of this.lobbies.values()) {
      const member = memberOfAccount(lobby, accountId);
      if (!member || member.name === name) continue;
      member.name = name;
      lobby.lastActivity = now;
      this.broadcastLobby(lobby, now);
    }
  }

  // The invitation card's lobby (the landing's request): the opener's
  // name, the seats taken, the phase while it plays; null when unknown or
  // gone.
  lobbyInvite(code: string): LobbyInvite | null {
    const lobby = this.lobbies.get(String(code).toUpperCase());
    if (!lobby) return null;
    return {
      host: lobby.members[0]!.name,
      players: seatedCount(lobby),
      ...(lobby.phase !== 'open' ? { phase: lobby.phase } : {}),
    };
  }

  // Whether this account is a remembered member of this lobby, not
  // removed: its way back is never charged nor refused as a wrong code.
  remembers(code: string, accountId: number | null): boolean {
    const lobby = this.lobbies.get(String(code).toUpperCase());
    const member = lobby ? memberOfAccount(lobby, accountId) : undefined;
    return member !== undefined && !member.removed;
  }

  // Lobbies opened from this connection key whose opener is in them now,
  // leaving out the one this client opened (creating leaves it).
  openLobbiesFrom(key: string, exceptClientId: number | null = null): number {
    let count = 0;
    for (const lobby of this.lobbies.values()) {
      const opener = lobby.members[0];
      if (lobby.createdBy !== key || !opener || opener.clientId === null) continue;
      if (opener.clientId !== exceptClientId) count++;
    }
    return count;
  }

  private accountOf(clientId: number): number | null {
    return this.opts.resolveAccount?.(clientId) ?? null;
  }

  private lobbyAt(tag: LobbyTag | undefined): Lobby | null {
    if (!tag) return null;
    const lobby = this.lobbies.get(tag.code);
    return lobby && lobby.round === tag.round ? lobby : null;
  }

  // The open lobby this client hosts, present on this socket.
  private lobbyHostedBy(clientId: number, now: number): Lobby | null {
    for (const lobby of this.lobbies.values()) {
      const member = memberOnSocket(lobby, clientId);
      if (member && hostOf(lobby, now) === member) return lobby;
    }
    return null;
  }

  // A start or a party waits for those coming back from the last match.
  private refusedForReturners(lobby: Lobby, now: number): boolean {
    const back = returningCount(lobby, now);
    if (back === 0) return false;
    this.broadcastLobby(lobby, now, comingBackNotice(back));
    return true;
  }

  // Every present member goes into the lobby's next queue or select: in
  // play on their socket, the veterans of this round; the next round.
  private takeIntoPlay(lobby: Lobby, now: number, phase: 'queue' | 'select'): Seat[] {
    lobby.round++;
    const tag: LobbyTag = { code: lobby.code, round: lobby.round };
    const players: Seat[] = [];
    for (const m of lobby.members) {
      m.veteran = false;
      if (m.clientId === null) continue;
      players.push({ clientId: m.clientId, name: m.name, team: m.team, lobby: tag });
      m.inPlay = true;
      m.playClientId = m.clientId;
      m.clientId = null;
      m.veteran = true;
      m.awayUntil = null;
      m.returning = false;
    }
    lobby.phase = phase;
    lobby.matchId = null;
    lobby.startedAt = phase === 'select' ? now : null;
    lobby.lastActivity = now;
    lobby.emptySince = null;
    return players;
  }

  // To present members only; a notice goes to each of them.
  private broadcastLobby(lobby: Lobby, now: number, notice?: string): void {
    for (const m of lobby.members) {
      if (m.clientId !== null) this.send(m.clientId, lobbyMessage(lobby, m, now, notice));
    }
  }

  // Queue entries alternate sides by position; lobby entries carry the side
  // their players chose and keep it.
  private startSelect(players: Seat[], now: number, source: MatchSource): void {
    if (players.length === 0) return;
    const session: SelectSession = {
      entries: players.map((p, i) => ({
        clientId: p.clientId,
        name: p.name,
        team: p.team ?? ((i % 2) as TeamId),
        accountId: this.opts.resolveAccount?.(p.clientId) ?? null,
        locked: null,
        lane: null,
        claimedAt: 0,
        ...(p.lobby ? { lobby: p.lobby } : {}),
      })),
      deadline: now + SELECT_SECONDS * 1000,
      started: false,
      source,
      claims: 0,
    };
    this.selects.push(session);
    const roster = session.entries.map((e) => ({ name: e.name, team: e.team }));
    for (const [self, e] of session.entries.entries()) {
      this.send(e.clientId, {
        t: 'select_start',
        team: e.team,
        players: roster,
        self,
        deadline: session.deadline,
        ...(this.opts.forge ? { forge: true } : {}),
      });
    }
  }

  // The select's state for one seat: the session's lock count, and its
  // own team's locked champions and lane claims, never the other side's.
  private selectUpdate(session: SelectSession, team: TeamId): ServerMsg {
    const claims: SelectClaim[] = [];
    for (const [seat, o] of session.entries.entries()) {
      if (o.team === team) claims.push({ seat, lane: o.lane, locked: o.locked !== null });
    }
    return {
      t: 'select_update',
      locked: session.entries.filter((e) => e.locked).length,
      total: session.entries.length,
      taken: session.entries
        .filter((o) => o.team === team && o.locked)
        .map((o) => o.locked?.championId ?? ''),
      claims,
    };
  }

  private broadcastSelect(session: SelectSession, team?: TeamId): void {
    for (const e of session.entries) {
      if (team === undefined || e.team === team) {
        this.send(e.clientId, this.selectUpdate(session, e.team));
      }
    }
  }

  // Claim a lane for a seat when its team has room for it beside the other
  // seats' claims (first come, first served). False when it is full, and
  // the seat keeps whatever it claimed before.
  private claim(session: SelectSession, entry: SelectEntry, lane: LanePreference): boolean {
    if (entry.lane === lane) return true;
    if (!laneOpen(claimsBeside(session, entry), lane)) return false;
    entry.lane = lane;
    entry.claimedAt = ++session.claims;
    return true;
  }

  // A bot seat's claim (ADR 0013): its playbook's first lane, which the sim
  // seats whatever was chosen, so it is taken even from a person who
  // claimed it first, the latest claims in its way released; else its
  // champion's home lane, an ordinary claim that a full lane refuses.
  private claimFor(session: SelectSession, entry: SelectEntry): void {
    const fixed = fixedLane(entry);
    if (fixed === null) {
      const home = homeLane(roleOfEntry(entry));
      if (home === null || !this.claim(session, entry, home)) entry.lane = null;
      return;
    }
    const rivals = session.entries
      .filter(
        (e) =>
          e !== entry &&
          e.team === entry.team &&
          e.lane !== null &&
          fixedLane(e) === null &&
          crowds(e.lane, fixed),
      )
      .sort((a, b) => b.claimedAt - a.claimedAt);
    for (const rival of rivals) {
      if (laneOpen(claimsBeside(session, entry), fixed)) break;
      rival.lane = null;
    }
    if (entry.lane !== fixed) {
      entry.lane = fixed;
      entry.claimedAt = ++session.claims;
    }
  }

  // A lane claim before Lock in (ADR 0026). Anything but one of the four
  // lanes is ignored. A full lane, or a bot seat (its lane is its
  // playbook's), is refused, and the seat is answered alone so its select
  // reverts; a claim that stands goes to the whole team.
  setLane(clientId: number, lane: unknown): void {
    if (!isLanePreference(lane)) return;
    const session = this.inSelect(clientId);
    const entry = session?.entries.find((e) => e.clientId === clientId);
    if (!session || !entry) return;
    if (entry.locked?.playbook || !this.claim(session, entry, lane)) {
      this.send(clientId, this.selectUpdate(session, entry.team));
      return;
    }
    this.broadcastSelect(session, entry.team);
  }

  pick(
    clientId: number,
    championId: string,
    sigils: [string, string],
    skin?: number,
    botId?: string,
    lane?: unknown,
  ): void {
    const session = this.inSelect(clientId);
    if (!session) return;
    const entry = session.entries.find((e) => e.clientId === clientId);
    if (!entry || entry.left) return;
    // A bot pick (ADR 0013): the resolver is the account boundary; the
    // bot's own champion, sigils and skin replace what the client sent.
    let seat: BotSeat | null = null;
    if (typeof botId === 'string' && this.opts.resolveBot) {
      seat = this.opts.resolveBot(clientId, botId);
      if (seat) {
        championId = seat.championId;
        sigils = seat.sigils;
        skin = seat.skin;
      }
    }
    let champ = CHAMPIONS[championId] ? championId : DEFAULT_CHAMPION_ID;
    // A Forge-queue pick outside the roster asks the resolver: only the
    // definition of a forged champion THIS client may play comes back.
    // Anything unresolved falls back to the default champion, like any
    // other invalid pick.
    let forged: ForgedChampionDef | undefined;
    if (!CHAMPIONS[championId] && this.opts.forge) {
      const def = this.opts.resolveForged?.(clientId, championId) ?? null;
      if (def) {
        champ = championId;
        forged = def;
      }
    }
    // What this client may pick of the roster (ADR 0018). A forged
    // champion is outside the collection entirely: it is not a roster
    // champion, and its own resolver already answered for it.
    const playable = forged ? null : (this.opts.resolvePlayable?.(clientId) ?? null);
    const mayPick = (id: string): boolean => playable === null || playable.includes(id);
    // A locked champion outside it falls back like any other invalid pick.
    // A bot seat that lost its champion this way loses the seat with it:
    // the playbook was written for a champion this account no longer has.
    if (!mayPick(champ)) {
      champ = playable?.[0] ?? DEFAULT_CHAMPION_ID;
      seat = null;
    }
    // No duplicate champions within a team (game definition): a taken pick
    // falls back to the first free champion in roster order. It must draw
    // from what this client may pick, or the duplicate rule would hand out
    // a champion the account does not hold. The floor that makes this
    // always find something is server/laurels.ts: four starters plus three
    // rotating is seven, and four teammates can take at most four.
    const teamTaken = session.entries
      .filter((e) => e.team === entry.team && e.clientId !== clientId && e.locked)
      .map((e) => e.locked?.championId);
    if (teamTaken.includes(champ)) {
      champ =
        CHAMPION_LIST.find((c) => !teamTaken.includes(c.id) && mayPick(c.id))?.id ??
        DEFAULT_CHAMPION_ID;
      forged = undefined;
      seat = null;
    }
    const valid =
      Array.isArray(sigils) &&
      sigils.length === 2 &&
      sigils[0] !== sigils[1] &&
      sigils.every((s) => typeof s === 'string' && SIGILS[s]);
    entry.locked = {
      championId: champ,
      sigils: valid ? [sigils[0], sigils[1]] : DEFAULT_SIGILS,
      skin: clampSkin(champ, skin),
      ...(forged ? { forged } : {}),
      ...(seat
        ? {
            playbook: seat.playbook,
            botName: seat.name,
            botId: seat.botId,
            botVersion: seat.version,
          }
        : {}),
    };
    // The lane rides the lock when it was not claimed before (a full one
    // keeps the earlier claim); a bot seat claims its own.
    if (seat) this.claimFor(session, entry);
    else if (isLanePreference(lane)) this.claim(session, entry, lane);
    this.broadcastSelect(session);
    if (session.entries.every((e) => e.locked)) this.finishSelect(session);
  }

  // Expires select deadlines and lobbies, and spends the lobbies' graces;
  // call regularly with the current wall clock.
  tickClock(now: number): void {
    for (const lobby of [...this.lobbies.values()]) {
      const fate = fateOf(lobby, now);
      if (fate === 'drop') this.lobbies.delete(lobby.code);
      else if (fate === 'expire') {
        this.lobbies.delete(lobby.code);
        for (const m of lobby.members) {
          if (m.clientId !== null) this.send(m.clientId, { t: 'error', message: 'Lobby expired.' });
        }
      } else if (fate === 'reopen') {
        // A guard against a match end never reported.
        reopen(lobby, now, false);
        this.broadcastLobby(lobby, now);
      } else if (spendGraces(lobby, now)) {
        notePresence(lobby, now);
        this.broadcastLobby(lobby, now);
      }
    }
    for (const session of [...this.selects]) {
      if (!session.started && now >= session.deadline) this.finishSelect(session, now);
    }
  }

  // The select is over: the match starts from its picks. Each private
  // lobby in it is decided on its own: one whose seats all left reopens
  // (and a lobby's own select that lost everyone starts no match at all);
  // the others follow the match, or, when it could not start, go back to
  // their lobby. Never throws.
  private finishSelect(session: SelectSession, now: number = Date.now()): void {
    if (session.started) return;
    session.started = true;
    const idx = this.selects.indexOf(session);
    if (idx !== -1) this.selects.splice(idx, 1);
    const tagged = new Map<Lobby, SelectEntry[]>();
    for (const e of session.entries) {
      const lobby = this.lobbyAt(e.lobby);
      if (lobby?.phase !== 'select') continue;
      const list = tagged.get(lobby) ?? [];
      list.push(e);
      tagged.set(lobby, list);
    }
    for (const [lobby, entries] of [...tagged]) {
      if (!entries.every((e) => e.left)) continue;
      tagged.delete(lobby);
      reopen(lobby, now, false);
      this.broadcastLobby(lobby, now);
    }
    if (session.source === 'lobby' && session.entries.every((e) => e.left)) return;
    const lanes = settleSelect(session);
    const picks: MatchPick[] = session.entries.map((e) => ({
      clientId: e.clientId,
      name: e.locked?.botName ? `${e.name} (${e.locked.botName})` : e.name,
      team: e.team,
      ...(e.accountId !== null ? { accountId: e.accountId } : {}),
      championId: e.locked?.championId ?? DEFAULT_CHAMPION_ID,
      sigils: e.locked?.sigils ?? DEFAULT_SIGILS,
      skin: e.locked?.skin ?? 0,
      ...(e.locked?.forged ? { forged: e.locked.forged } : {}),
      ...(e.locked?.playbook ? { playbook: e.locked.playbook } : {}),
      ...(e.locked?.botId !== undefined ? { botId: e.locked.botId } : {}),
      ...(e.locked?.botVersion !== undefined ? { botVersion: e.locked.botVersion } : {}),
      lanes: [lanes.get(e)!],
      ...(e.left ? { absent: true as const } : {}),
      ...(e.lobby ? { lobby: e.lobby.code } : {}),
    }));
    let matchId: number | null = null;
    try {
      const id = this.onMatchReady(picks, session.source);
      if (typeof id === 'number') matchId = id;
    } catch (err) {
      console.error('match setup failed:', err);
    }
    for (const [lobby, entries] of tagged) {
      if (lobby.phase !== 'select') continue;
      if (matchId !== null) {
        lobby.phase = 'match';
        lobby.matchId = matchId;
      } else {
        // Back to the lobby, on the sockets that were in the select.
        for (const e of entries) {
          if (e.left) continue;
          const m = lobby.members.find((x) => x.playClientId === e.clientId);
          if (m && m.clientId === null) m.clientId = m.playClientId;
        }
        reopen(lobby, now, false);
      }
      this.broadcastLobby(lobby, now, matchId === null ? COULD_NOT_START : undefined);
    }
  }

  // Takes a socket out of the queue, every lobby and its select. True only
  // when it was there: queued, present in a lobby, or in a select (a
  // lobby's member in play elsewhere does not count). A lobby member
  // leaving on 'drop' is waited for through a grace and keeps hosting
  // through it; an open lobby that never played and has nobody left in it
  // is gone at once on a 'leave' (after the grace on a 'drop').
  removeEverywhere(clientId: number, now: number = Date.now(), how: LeaveHow = 'leave'): boolean {
    return this.leaveAll(clientId, now, how, null);
  }

  private leaveAll(clientId: number, now: number, how: LeaveHow, except: Lobby | null): boolean {
    let left = false;
    const qg = this.queue.find((g) => g.members.some((m) => m.clientId === clientId));
    if (qg) {
      left = true;
      qg.members.splice(
        qg.members.findIndex((m) => m.clientId === clientId),
        1,
      );
      const lobby = this.lobbyAt(qg.lobby);
      const m = lobby?.members.find((x) => x.playClientId === clientId);
      if (m) {
        m.inPlay = false;
        m.playClientId = null;
      }
      if (qg.members.length === 0) {
        this.queue.splice(this.queue.indexOf(qg), 1);
        if (lobby?.phase === 'queue') reopen(lobby, now, false);
      }
      if (lobby) this.broadcastLobby(lobby, now);
      this.broadcastQueue();
    }
    for (const lobby of [...this.lobbies.values()]) {
      if (lobby === except) continue;
      const m = memberOnSocket(lobby, clientId);
      if (m) {
        left = true;
        m.clientId = null;
        m.awayUntil = how === 'drop' ? now + DROP_GRACE_MS : null;
        m.returning = false;
        if (
          lobby.phase === 'open' &&
          lobby.round === 0 &&
          how === 'leave' &&
          !anyonePresent(lobby)
        ) {
          this.lobbies.delete(lobby.code);
          continue;
        }
        notePresence(lobby, now);
        this.broadcastLobby(lobby, now);
      }
      // A walk-out from the lobby's match gives the seat up; a drop holds it.
      const player = lobby.members.find((x) => x.inPlay && x.playClientId === clientId);
      if (player && lobby.phase === 'match' && how === 'leave') {
        player.inPlay = false;
        player.playClientId = null;
        this.broadcastLobby(lobby, now);
      }
    }
    // A player vanishing mid-select is auto-locked with defaults so the
    // others still get their match; a lane it claimed stays claimed. Its
    // pick, locked or not, says nobody is behind it any more. A lobby
    // member who left gives the seat up; one who dropped keeps it held.
    const session = this.inSelect(clientId);
    const entry = session?.entries.find((e) => e.clientId === clientId);
    if (session && entry && !entry.left) {
      left = true;
      entry.left = true;
      const lobby = this.lobbyAt(entry.lobby);
      const m = lobby?.members.find((x) => x.inPlay && x.playClientId === clientId);
      if (lobby && m && how === 'leave') {
        m.inPlay = false;
        m.playClientId = null;
        this.broadcastLobby(lobby, now);
      }
      if (!entry.locked) {
        entry.locked = { championId: DEFAULT_CHAMPION_ID, sigils: DEFAULT_SIGILS, skin: 0 };
        if (session.entries.every((e) => e.locked)) this.finishSelect(session, now);
      }
    }
    return left;
  }
}
