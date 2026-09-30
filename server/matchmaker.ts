// Pre-match flow: the queue, private lobbies by code, and the champion
// select session. Transport-agnostic: outbound messages go through the
// injected send, wall-clock time comes in as arguments, and a ready match
// is handed to the injected callback as a list of picks.

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
import type { MatchPick } from './match';
import { packGroups } from './party';

export const MATCH_SIZE = 10;
export const TEAM_CAP = MATCH_SIZE / 2;
export const SELECT_SECONDS = 45;
const DEFAULT_SIGILS: [string, string] = ['riftstep', 'mend'];

// An unstarted lobby expires after this long; abandoned codes must not pin
// memory or stay joinable forever.
export const LOBBY_TTL_MS = 30 * 60_000;

interface Pending {
  clientId: number;
  name: string;
}

// The queue holds GROUPS: a solo player is a group of one, a party (a
// lobby that queued together) stays whole and lands on one side.
interface QueueGroup {
  members: Pending[];
  botReady: boolean;
}

interface SelectEntry extends Pending {
  team: TeamId;
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

// Lobby seats carry a chosen side, so friends can play TOGETHER against
// the bot fill instead of always being split by join order.
interface LobbyEntry extends Pending {
  team: TeamId;
}

interface Lobby {
  code: string;
  hostId: number;
  players: LobbyEntry[];
  createdAt: number;
}

type Send = (clientId: number, msg: ServerMsg) => void;
type OnMatchReady = (picks: MatchPick[], source: MatchSource) => void;

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
}

// Crypto-random codes: a counter transform was reproducible offline, so any
// third party could enumerate live lobbies. Ambiguous letters are excluded.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
function randomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return code;
}

export class Matchmaker {
  private readonly queue: QueueGroup[] = [];
  private readonly lobbies = new Map<string, Lobby>();
  private readonly selects: SelectSession[] = [];

  constructor(
    private readonly send: Send,
    private readonly onMatchReady: OnMatchReady,
    // Injectable for tests; production uses the crypto-random default.
    private readonly codeGen: () => string = randomCode,
    private readonly opts: MatchmakerOptions = {},
  ) {}

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

  // A whole lobby enters the public queue as one group on one side. Only
  // the host may pull the trigger, and a party larger than a team cannot
  // queue (a full lobby should start its own match).
  queuePartyFromLobby(hostId: number, now: number): void {
    for (const lobby of this.lobbies.values()) {
      if (lobby.hostId !== hostId) continue;
      if (lobby.players.length > TEAM_CAP) {
        this.send(hostId, {
          t: 'error',
          message: 'A party of up to five can queue together; a full lobby starts its own match.',
        });
        return;
      }
      this.lobbies.delete(lobby.code);
      this.queue.push({
        members: lobby.players.map((p) => ({ clientId: p.clientId, name: p.name })),
        botReady: false,
      });
      this.tryFormFullMatch(now);
      this.broadcastQueue();
      return;
    }
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
    const players: (Pending & { team: TeamId })[] = [];
    for (const s of seated) {
      for (const m of this.queue[s.index]!.members) players.push({ ...m, team: s.team });
    }
    for (const s of [...seated].sort((a, b) => b.index - a.index)) this.queue.splice(s.index, 1);
    this.startSelect(players, now, 'queue');
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
      const players: (Pending & { team: TeamId })[] = [];
      for (const s of seated) {
        const group = ready[s.index]!;
        for (const m of group.members) players.push({ ...m, team: s.team });
        this.queue.splice(this.queue.indexOf(group), 1);
      }
      this.startSelect(players, now, 'queue');
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

  createLobby(clientId: number, name: string, now: number = Date.now()): void {
    this.removeEverywhere(clientId, now);
    let code = this.codeGen();
    for (let guard = 0; this.lobbies.has(code) && guard < 50; guard++) code = this.codeGen();
    if (this.lobbies.has(code)) {
      this.send(clientId, { t: 'error', message: 'Could not create a lobby, try again.' });
      return;
    }
    const lobby: Lobby = {
      code,
      hostId: clientId,
      players: [{ clientId, name, team: 0 }],
      createdAt: now,
    };
    this.lobbies.set(code, lobby);
    this.broadcastLobby(lobby);
  }

  joinLobby(clientId: number, name: string, code: string): void {
    const lobby = this.lobbies.get(code.toUpperCase());
    if (!lobby || lobby.players.length >= MATCH_SIZE) {
      this.send(clientId, { t: 'error', message: 'Lobby not found or full.' });
      return;
    }
    this.removeEverywhere(clientId);
    // Default to the emptier side; anyone can switch afterwards.
    const count0 = lobby.players.filter((p) => p.team === 0).length;
    const count1 = lobby.players.length - count0;
    lobby.players.push({ clientId, name, team: count0 <= count1 ? 0 : 1 });
    this.broadcastLobby(lobby);
  }

  // A lobby member picks their side. A full side refuses silently: the
  // client greys the button out, and the 'error' channel would tear the
  // lobby screen down (it is reserved for closed and expired lobbies).
  setLobbyTeam(clientId: number, team: unknown): void {
    if (team !== 0 && team !== 1) return;
    for (const lobby of this.lobbies.values()) {
      const entry = lobby.players.find((p) => p.clientId === clientId);
      if (!entry) continue;
      if (entry.team === team) return;
      if (lobby.players.filter((p) => p.team === team).length >= TEAM_CAP) return;
      entry.team = team;
      this.broadcastLobby(lobby);
      return;
    }
  }

  startLobby(clientId: number, now: number): void {
    for (const lobby of this.lobbies.values()) {
      if (lobby.hostId !== clientId) continue;
      this.lobbies.delete(lobby.code);
      this.startSelect(lobby.players, now, 'lobby');
      return;
    }
  }

  private broadcastLobby(lobby: Lobby): void {
    for (const p of lobby.players) {
      this.send(p.clientId, {
        t: 'lobby',
        code: lobby.code,
        host: p.clientId === lobby.hostId,
        team: p.team,
        players: lobby.players.map((x) => ({ name: x.name, team: x.team })),
      });
    }
  }

  // Queue entries alternate sides by position; lobby entries carry the side
  // their players chose and keep it.
  private startSelect(
    players: (Pending & { team?: TeamId })[],
    now: number,
    source: MatchSource,
  ): void {
    if (players.length === 0) return;
    const session: SelectSession = {
      entries: players.map((p, i) => ({
        clientId: p.clientId,
        name: p.name,
        team: p.team ?? ((i % 2) as TeamId),
        locked: null,
        lane: null,
        claimedAt: 0,
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
    if (!entry) return;
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

  // Expires select deadlines, stale lobbies, and the bot-fill countdown;
  // call regularly with the current wall clock.
  tickClock(now: number): void {
    for (const lobby of [...this.lobbies.values()]) {
      if (now - lobby.createdAt > LOBBY_TTL_MS) {
        this.lobbies.delete(lobby.code);
        for (const p of lobby.players) {
          this.send(p.clientId, { t: 'error', message: 'Lobby expired.' });
        }
      }
    }
    for (const session of this.selects) {
      if (!session.started && now >= session.deadline) this.finishSelect(session);
    }
  }

  private finishSelect(session: SelectSession): void {
    if (session.started) return;
    session.started = true;
    const idx = this.selects.indexOf(session);
    if (idx !== -1) this.selects.splice(idx, 1);
    const lanes = settleSelect(session);
    const picks: MatchPick[] = session.entries.map((e) => ({
      clientId: e.clientId,
      name: e.locked?.botName ? `${e.name} (${e.locked.botName})` : e.name,
      team: e.team,
      championId: e.locked?.championId ?? DEFAULT_CHAMPION_ID,
      sigils: e.locked?.sigils ?? DEFAULT_SIGILS,
      skin: e.locked?.skin ?? 0,
      ...(e.locked?.forged ? { forged: e.locked.forged } : {}),
      ...(e.locked?.playbook ? { playbook: e.locked.playbook } : {}),
      ...(e.locked?.botId !== undefined ? { botId: e.locked.botId } : {}),
      ...(e.locked?.botVersion !== undefined ? { botVersion: e.locked.botVersion } : {}),
      lanes: [lanes.get(e)!],
    }));
    this.onMatchReady(picks, session.source);
  }

  // The clock is no longer read here (the queue has no countdown left to
  // cancel, ADR 0025); callers still pass it, so the signature stays.
  removeEverywhere(clientId: number, _now: number = Date.now()): void {
    const qg = this.queue.find((g) => g.members.some((m) => m.clientId === clientId));
    if (qg) {
      qg.members.splice(
        qg.members.findIndex((m) => m.clientId === clientId),
        1,
      );
      if (qg.members.length === 0) this.queue.splice(this.queue.indexOf(qg), 1);
      this.broadcastQueue();
    }
    for (const lobby of [...this.lobbies.values()]) {
      const li = lobby.players.findIndex((p) => p.clientId === clientId);
      if (li === -1) continue;
      lobby.players.splice(li, 1);
      if (lobby.players.length === 0 || lobby.hostId === clientId) {
        this.lobbies.delete(lobby.code);
        for (const p of lobby.players) {
          this.send(p.clientId, { t: 'error', message: 'Lobby closed.' });
        }
      } else {
        this.broadcastLobby(lobby);
      }
    }
    // A player vanishing mid-select is auto-locked with defaults so the
    // others still get their match; a lane it claimed stays claimed.
    const session = this.inSelect(clientId);
    if (session) {
      const entry = session.entries.find((e) => e.clientId === clientId);
      if (entry && !entry.locked) {
        entry.locked = { championId: DEFAULT_CHAMPION_ID, sigils: DEFAULT_SIGILS, skin: 0 };
        if (session.entries.every((e) => e.locked)) this.finishSelect(session);
      }
    }
  }
}
