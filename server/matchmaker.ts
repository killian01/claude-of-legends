// Pre-match flow: the queue, private lobbies by code, and the champion
// select session. Transport-agnostic: outbound messages go through the
// injected send, wall-clock time comes in as arguments, and a ready match
// is handed to the injected callback as a list of picks.

import { randomInt } from 'node:crypto';
import type { ServerMsg } from '../src/net/protocol';
import { CHAMPION_LIST, CHAMPIONS, DEFAULT_CHAMPION_ID } from '../src/sim/content/champions';
import { SIGILS } from '../src/sim/content/sigils';
import { clampSkin } from '../src/sim/content/skins';
import type { TeamId } from '../src/sim/types';
import type { MatchPick } from './match';

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

interface QueueEntry extends Pending {
  botReady: boolean;
}

interface SelectEntry extends Pending {
  team: TeamId;
  locked: { championId: string; sigils: [string, string]; skin: number } | null;
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

// Crypto-random codes: a counter transform was reproducible offline, so any
// third party could enumerate live lobbies. Ambiguous letters are excluded.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
function randomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return code;
}

export class Matchmaker {
  private readonly queue: QueueEntry[] = [];
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
  ) {}

  private broadcastQueue(now: number): void {
    const startsIn =
      this.botStartAt !== null ? Math.max(0, Math.ceil((this.botStartAt - now) / 1000)) : null;
    for (const p of this.queue) {
      this.send(p.clientId, {
        t: 'queue_status',
        count: this.queue.length,
        needed: MATCH_SIZE,
        startsIn,
        ready: p.botReady,
      });
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
    this.queue.push({ clientId, name, botReady: false });
    if (this.queue.length >= MATCH_SIZE) {
      this.startSelect(this.queue.splice(0, MATCH_SIZE), now, 'queue');
      if (!this.queue.some((p) => p.botReady)) this.botStartAt = null;
    }
    this.broadcastQueue(now);
  }

  // Opt-in bot fill: marks THIS player ready to start with bots. Starts
  // immediately when everyone queued agrees; otherwise announces a countdown
  // the others may join. Nobody is dragged into a bot game they did not ask
  // for: non-volunteers stay queued for a human match.
  startNow(clientId: number, now: number): void {
    const entry = this.queue.find((p) => p.clientId === clientId);
    if (!entry) return;
    entry.botReady = true;
    if (this.queue.every((p) => p.botReady)) {
      const players = this.queue.splice(0, this.queue.length);
      this.botStartAt = null;
      this.startSelect(players, now, 'queue');
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
      });
    }
  }

  pick(clientId: number, championId: string, sigils: [string, string], skin?: number): void {
    const session = this.inSelect(clientId);
    if (!session) return;
    const entry = session.entries.find((e) => e.clientId === clientId);
    if (!entry) return;
    let champ = CHAMPIONS[championId] ? championId : DEFAULT_CHAMPION_ID;
    // No duplicate champions within a team (game definition): a taken pick
    // falls back to the first free champion in roster order.
    const teamTaken = session.entries
      .filter((e) => e.team === entry.team && e.clientId !== clientId && e.locked)
      .map((e) => e.locked?.championId);
    if (teamTaken.includes(champ)) {
      champ = CHAMPION_LIST.find((c) => !teamTaken.includes(c.id))?.id ?? DEFAULT_CHAMPION_ID;
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
      const ready: QueueEntry[] = [];
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i]!.botReady) ready.unshift(...this.queue.splice(i, 1));
      }
      if (ready.length > 0) this.startSelect(ready, now, 'queue');
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
      name: e.name,
      team: e.team,
      championId: e.locked?.championId ?? DEFAULT_CHAMPION_ID,
      sigils: e.locked?.sigils ?? DEFAULT_SIGILS,
      skin: e.locked?.skin ?? 0,
    }));
    this.onMatchReady(picks, session.source);
  }

  removeEverywhere(clientId: number, now: number = Date.now()): void {
    const qi = this.queue.findIndex((p) => p.clientId === clientId);
    if (qi !== -1) {
      this.queue.splice(qi, 1);
      if (this.queue.length > 0 && this.queue.every((p) => p.botReady)) {
        // Everyone still queued already agreed: start them now.
        const players = this.queue.splice(0, this.queue.length);
        this.botStartAt = null;
        this.startSelect(players, now, 'queue');
      } else if (!this.queue.some((p) => p.botReady)) {
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
