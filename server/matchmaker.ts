// Pre-match flow: the queue, private lobbies by code, and the champion
// select session. Transport-agnostic: outbound messages go through the
// injected send, wall-clock time comes in as arguments, and a ready match
// is handed to the injected callback as a list of picks.

import type { ServerMsg } from '../src/net/protocol';
import { CHAMPIONS, DEFAULT_CHAMPION_ID } from '../src/sim/content/champions';
import { SIGILS } from '../src/sim/content/sigils';
import type { TeamId } from '../src/sim/types';
import type { MatchPick } from './match';

export const MATCH_SIZE = 10;
export const SELECT_SECONDS = 45;
const DEFAULT_SIGILS: [string, string] = ['riftstep', 'mend'];

interface Pending {
  clientId: number;
  name: string;
}

interface SelectEntry extends Pending {
  team: TeamId;
  locked: { championId: string; sigils: [string, string] } | null;
}

interface SelectSession {
  entries: SelectEntry[];
  deadline: number;
  started: boolean;
}

interface Lobby {
  code: string;
  hostId: number;
  players: Pending[];
}

type Send = (clientId: number, msg: ServerMsg) => void;
type OnMatchReady = (picks: MatchPick[]) => void;

function toCode(n: number): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = '';
  let v = n;
  for (let i = 0; i < 5; i++) {
    code += letters[v % letters.length];
    v = Math.floor(v / letters.length) + 7;
  }
  return code;
}

export class Matchmaker {
  private readonly queue: Pending[] = [];
  private readonly lobbies = new Map<string, Lobby>();
  private readonly selects: SelectSession[] = [];
  private lobbyCounter = 1;

  constructor(
    private readonly send: Send,
    private readonly onMatchReady: OnMatchReady,
  ) {}

  private broadcastQueue(): void {
    for (const p of this.queue) {
      this.send(p.clientId, { t: 'queue_status', count: this.queue.length, needed: MATCH_SIZE });
    }
  }

  private inSelect(clientId: number): SelectSession | null {
    for (const s of this.selects) {
      if (!s.started && s.entries.some((e) => e.clientId === clientId)) return s;
    }
    return null;
  }

  addToQueue(clientId: number, name: string, now: number): void {
    this.removeEverywhere(clientId);
    this.queue.push({ clientId, name });
    if (this.queue.length >= MATCH_SIZE) {
      this.startSelect(this.queue.splice(0, MATCH_SIZE), now);
    }
    this.broadcastQueue();
  }

  startNow(clientId: number, now: number): void {
    if (!this.queue.some((p) => p.clientId === clientId)) return;
    const players = this.queue.splice(0, this.queue.length);
    this.startSelect(players, now);
    this.broadcastQueue();
  }

  createLobby(clientId: number, name: string): void {
    this.removeEverywhere(clientId);
    const code = toCode(this.lobbyCounter++);
    const lobby: Lobby = { code, hostId: clientId, players: [{ clientId, name }] };
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
    lobby.players.push({ clientId, name });
    this.broadcastLobby(lobby);
  }

  startLobby(clientId: number, now: number): void {
    for (const lobby of this.lobbies.values()) {
      if (lobby.hostId !== clientId) continue;
      this.lobbies.delete(lobby.code);
      this.startSelect(lobby.players, now);
      return;
    }
  }

  private broadcastLobby(lobby: Lobby): void {
    for (const p of lobby.players) {
      this.send(p.clientId, {
        t: 'lobby',
        code: lobby.code,
        host: p.clientId === lobby.hostId,
        players: lobby.players.map((x) => x.name),
      });
    }
  }

  private startSelect(players: Pending[], now: number): void {
    if (players.length === 0) return;
    const session: SelectSession = {
      entries: players.map((p, i) => ({
        ...p,
        team: (i % 2) as TeamId,
        locked: null,
      })),
      deadline: now + SELECT_SECONDS * 1000,
      started: false,
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

  pick(clientId: number, championId: string, sigils: [string, string]): void {
    const session = this.inSelect(clientId);
    if (!session) return;
    const entry = session.entries.find((e) => e.clientId === clientId);
    if (!entry) return;
    const champ = CHAMPIONS[championId] ? championId : DEFAULT_CHAMPION_ID;
    const valid =
      Array.isArray(sigils) &&
      sigils.length === 2 &&
      sigils[0] !== sigils[1] &&
      sigils.every((s) => typeof s === 'string' && SIGILS[s]);
    entry.locked = { championId: champ, sigils: valid ? [sigils[0], sigils[1]] : DEFAULT_SIGILS };
    const locked = session.entries.filter((e) => e.locked).length;
    for (const e of session.entries) {
      this.send(e.clientId, { t: 'select_update', locked, total: session.entries.length });
    }
    if (locked === session.entries.length) this.finishSelect(session);
  }

  // Expires select deadlines; call regularly with the current wall clock.
  tickClock(now: number): void {
    for (const session of this.selects) {
      if (!session.started && now >= session.deadline) this.finishSelect(session);
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
    }));
    this.onMatchReady(picks);
  }

  removeEverywhere(clientId: number): void {
    const qi = this.queue.findIndex((p) => p.clientId === clientId);
    if (qi !== -1) {
      this.queue.splice(qi, 1);
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
    // others still get their match.
    const session = this.inSelect(clientId);
    if (session) {
      const entry = session.entries.find((e) => e.clientId === clientId);
      if (entry && !entry.locked) {
        entry.locked = { championId: DEFAULT_CHAMPION_ID, sigils: DEFAULT_SIGILS };
        if (session.entries.every((e) => e.locked)) this.finishSelect(session);
      }
    }
  }
}
