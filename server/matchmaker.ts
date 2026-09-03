// Pre-match flow: the queue, private lobbies by code, and the champion
// select session. Transport-agnostic: outbound messages go through the
// injected send, wall-clock time comes in as arguments, and a ready match
// is handed to the injected callback as a list of picks.

import { randomInt } from 'node:crypto';
import type { ServerMsg } from '../src/net/protocol';
import { CHAMPION_LIST, CHAMPIONS, DEFAULT_CHAMPION_ID } from '../src/sim/content/champions';
import { SIGILS } from '../src/sim/content/sigils';
import { clampSkin } from '../src/sim/content/skins';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import type { PlaybookDef } from '../src/sim/playbook/types';
import type { TeamId } from '../src/sim/types';
import type { MatchPick } from './match';
import { packGroups } from './party';

export const MATCH_SIZE = 10;
export const TEAM_CAP = MATCH_SIZE / 2;
export const SELECT_SECONDS = 45;
const DEFAULT_SIGILS: [string, string] = ['riftstep', 'mend'];

export const BOT_START_COUNTDOWN_MS = 10_000;
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
}

// Where a match came from: only public-queue matches are ever rated
// (a private lobby would be a boosting machine otherwise).
export type MatchSource = 'queue' | 'lobby';

interface SelectSession {
  entries: SelectEntry[];
  deadline: number;
  started: boolean;
  source: MatchSource;
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
  // Deadline of the opt-in bot-filled start, null when nobody opted in.
  private botStartAt: number | null = null;
  private lastCountdownSecond = -1;

  constructor(
    private readonly send: Send,
    private readonly onMatchReady: OnMatchReady,
    // Injectable for tests; production uses the crypto-random default.
    private readonly codeGen: () => string = randomCode,
    private readonly opts: MatchmakerOptions = {},
  ) {}

  private queuedSeats(): number {
    let seats = 0;
    for (const g of this.queue) seats += g.members.length;
    return seats;
  }

  private broadcastQueue(now: number): void {
    const startsIn =
      this.botStartAt !== null ? Math.max(0, Math.ceil((this.botStartAt - now) / 1000)) : null;
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
    this.broadcastQueue(now);
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
      this.broadcastQueue(now);
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
    if (!this.queue.some((g) => g.botReady)) this.botStartAt = null;
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

  // Opt-in bot fill: marks THIS player's group ready to start with bots.
  // Starts immediately when everyone queued agrees; otherwise announces a
  // countdown the others may join. Nobody is dragged into a bot game they
  // did not ask for: non-volunteers stay queued for a human match.
  startNow(clientId: number, now: number): void {
    const entry = this.queue.find((g) => g.members.some((m) => m.clientId === clientId));
    if (!entry) return;
    entry.botReady = true;
    if (this.queue.every((g) => g.botReady)) {
      this.botStartAt = null;
      this.startReadyGroups(now);
      this.broadcastQueue(now);
      return;
    }
    if (this.botStartAt === null) this.botStartAt = now + BOT_START_COUNTDOWN_MS;
    this.broadcastQueue(now);
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
      })),
      deadline: now + SELECT_SECONDS * 1000,
      started: false,
      source,
    };
    this.selects.push(session);
    const roster = session.entries.map((e) => ({ name: e.name, team: e.team }));
    for (const e of session.entries) {
      this.send(e.clientId, {
        t: 'select_start',
        team: e.team,
        players: roster,
        deadline: session.deadline,
        ...(this.opts.forge ? { forge: true } : {}),
      });
    }
  }

  pick(
    clientId: number,
    championId: string,
    sigils: [string, string],
    skin?: number,
    botId?: string,
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
    // No duplicate champions within a team (game definition): a taken pick
    // falls back to the first free champion in roster order.
    const teamTaken = session.entries
      .filter((e) => e.team === entry.team && e.clientId !== clientId && e.locked)
      .map((e) => e.locked?.championId);
    if (teamTaken.includes(champ)) {
      champ = CHAMPION_LIST.find((c) => !teamTaken.includes(c.id))?.id ?? DEFAULT_CHAMPION_ID;
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
    const locked = session.entries.filter((e) => e.locked).length;
    for (const e of session.entries) {
      const taken = session.entries
        .filter((o) => o.team === e.team && o.locked)
        .map((o) => o.locked?.championId ?? '');
      this.send(e.clientId, {
        t: 'select_update',
        locked,
        total: session.entries.length,
        taken,
      });
    }
    if (locked === session.entries.length) this.finishSelect(session);
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
    if (this.botStartAt === null) return;
    if (now >= this.botStartAt) {
      this.botStartAt = null;
      this.lastCountdownSecond = -1;
      this.startReadyGroups(now);
      this.broadcastQueue(now);
      return;
    }
    const secs = Math.ceil((this.botStartAt - now) / 1000);
    if (secs !== this.lastCountdownSecond) {
      this.lastCountdownSecond = secs;
      this.broadcastQueue(now);
    }
  }

  private finishSelect(session: SelectSession): void {
    if (session.started) return;
    session.started = true;
    const idx = this.selects.indexOf(session);
    if (idx !== -1) this.selects.splice(idx, 1);
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
    }));
    this.onMatchReady(picks, session.source);
  }

  removeEverywhere(clientId: number, now: number = Date.now()): void {
    const qg = this.queue.find((g) => g.members.some((m) => m.clientId === clientId));
    if (qg) {
      qg.members.splice(
        qg.members.findIndex((m) => m.clientId === clientId),
        1,
      );
      if (qg.members.length === 0) this.queue.splice(this.queue.indexOf(qg), 1);
      if (this.queue.length > 0 && this.queue.every((g) => g.botReady)) {
        // Everyone still queued already agreed: start them now.
        this.botStartAt = null;
        this.startReadyGroups(now);
      } else if (!this.queue.some((g) => g.botReady)) {
        this.botStartAt = null;
      }
      this.broadcastQueue(now);
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
    // others still get their match.
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
