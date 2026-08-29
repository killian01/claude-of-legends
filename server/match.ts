// One live match: the authoritative Sim plus its players. The server never
// resolves gameplay itself: every command is validated here, then handed to
// a sim method (ADR 0001). Transport-agnostic and fully testable without a
// socket.

import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import {
  applySimCommand,
  buildMatchSim,
  REPLAY_EVENT_CAP,
  type ReplayEvent,
  type ReplayPick,
} from '../src/net/replay';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import type { Sim, SimEvent } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';
import { buildSnapshot } from './snapshot';

export interface MatchPick {
  clientId: number;
  name: string;
  team: TeamId;
  championId: string;
  sigils: [string, string];
  // Cosmetic skin index; clamped by the sim.
  skin?: number;
  // Bot policy id: this seat is driven in-sim, not by a connection.
  bot?: string;
}

interface MatchPlayer {
  clientId: number;
  name: string;
  team: TeamId;
  unitId: number;
  known: Set<number>;
  // sim.tickCount of this player's last command, for the AFK sweep.
  lastCommandAt: number;
}

// A connected player silent for this long in a multi-human match is
// treated as a walk-out (two minutes at 20 Hz).
export const AFK_IDLE_TICKS = 20 * 120;

// Seatless viewers per match; a small cap keeps the snapshot loop honest.
export const MAX_SPECTATORS = 10;

export class Match {
  readonly sim: Sim;
  readonly seed: number;
  readonly players = new Map<number, MatchPlayer>();
  readonly spectators = new Map<number, { team: TeamId; known: Set<number> }>();
  // What a replay needs: the exact picks and every event that steered the
  // sim (src/net/replay.ts rebuilds the match from these plus the seed).
  readonly replayPicks: ReplayPick[];
  readonly replayEvents: ReplayEvent[] = [];
  private readonly unitNames = new Map<number, string>();
  private eventsThisTick: SimEvent[] = [];

  constructor(seed: number, picks: readonly MatchPick[]) {
    this.seed = seed;
    this.replayPicks = picks.map((p) => ({
      name: p.name,
      team: p.team,
      championId: p.championId,
      sigils: [p.sigils[0], p.sigils[1]],
      ...(p.skin !== undefined ? { skin: p.skin } : {}),
      ...(p.bot !== undefined ? { bot: p.bot } : {}),
    }));
    // The shared builder IS the live construction: a replayed sim starts
    // from the same seed, picks, and policy attachments by definition.
    const { sim, unitIds } = buildMatchSim(seed, this.replayPicks);
    this.sim = sim;
    picks.forEach((p, i) => {
      const unitId = unitIds[i]!;
      this.unitNames.set(unitId, p.name);
      if (p.bot) return;
      this.players.set(p.clientId, {
        clientId: p.clientId,
        name: p.name,
        team: p.team,
        unitId,
        known: new Set(),
        lastCommandAt: 0,
      });
    });
  }

  // Connected players whose last command is older than maxIdleTicks.
  idleClientIds(maxIdleTicks: number): number[] {
    const out: number[] = [];
    for (const p of this.players.values()) {
      if (this.sim.tickCount - p.lastCommandAt > maxIdleTicks) out.push(p.clientId);
    }
    return out;
  }

  private recordReplay(ev: ReplayEvent): void {
    if (this.replayEvents.length < REPLAY_EVENT_CAP) this.replayEvents.push(ev);
  }

  // True when the log stayed within bounds and is worth saving.
  get replayComplete(): boolean {
    return this.replayEvents.length < REPLAY_EVENT_CAP;
  }

  // Client ids on the same team as the sender. Chat and pings route through
  // this: the snapshot layer is fog-scoped, so the social layer must be
  // team-scoped too or a ping leaks a map coordinate to the enemy.
  teamRecipients(senderClientId: number): number[] {
    const sender = this.players.get(senderClientId);
    if (!sender) return [];
    return [...this.players.values()].filter((p) => p.team === sender.team).map((p) => p.clientId);
  }

  // A dropped player's champion keeps fighting: the seat is handed to the
  // default bot policy instead of standing inert for the rest of the match,
  // and the scoreboard row says so. Returns the seat, for the team notice
  // and the rejoin reservation.
  handleDisconnect(clientId: number): { name: string; team: TeamId; unitId: number } | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    this.players.delete(clientId);
    const def = BOTS[DEFAULT_BOT_ID];
    if (def) this.sim.attachPolicy(p.unitId, def.policy);
    this.recordReplay({ k: this.sim.tickCount, u: p.unitId, e: 'bot_on' });
    this.unitNames.set(p.unitId, `${p.name} (bot)`);
    return { name: p.name, team: p.team, unitId: p.unitId };
  }

  // The reverse: a reconnected player takes the seat back from the bot.
  // The fresh known set makes the snapshot layer resend every identity, so
  // the new mirror world starts complete.
  restorePlayer(clientId: number, seat: { name: string; team: TeamId; unitId: number }): void {
    this.sim.detachPolicy(seat.unitId);
    this.recordReplay({ k: this.sim.tickCount, u: seat.unitId, e: 'bot_off' });
    this.unitNames.set(seat.unitId, seat.name);
    this.players.set(clientId, {
      clientId,
      name: seat.name,
      team: seat.team,
      unitId: seat.unitId,
      known: new Set(),
      // A fresh idle clock: a rejoin must not be flagged AFK on arrival.
      lastCommandAt: this.sim.tickCount,
    });
  }

  // Scoreboard rows carrying the seat's real player or bot name alongside
  // the champion name the sim already put in `name`.
  buildScore(): ServerMsg {
    const rows = this.sim.scoreboard().map((r) => ({
      ...r,
      player: this.unitNames.get(r.unitId) ?? null,
    }));
    return { t: 'score', rows };
  }

  tick(): void {
    this.eventsThisTick = this.sim.tick();
  }

  handleCommand(clientId: number, msg: ClientMsg): void {
    const p = this.players.get(clientId);
    if (!p) return;
    p.lastCommandAt = this.sim.tickCount;
    // Recorded raw, then applied through the SAME validated path a replay
    // uses: an invalid command no-ops identically live and replayed.
    this.recordReplay({ k: this.sim.tickCount, u: p.unitId, e: 'cmd', c: msg });
    applySimCommand(this.sim, p.team, p.unitId, msg);
  }

  buildSnapshotFor(clientId: number): ServerMsg | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    return buildSnapshot(this.sim, p.team, p.unitId, p.known, this.eventsThisTick);
  }

  // Spectators: seatless viewers on one team's fog. selfUnitId 0 makes the
  // snapshot builder ship self null and no personal events; their known
  // sets live here so identities resend per spectator like any client.
  addSpectator(clientId: number, team: TeamId): boolean {
    if (this.spectators.size >= MAX_SPECTATORS) return false;
    this.spectators.set(clientId, { team: team === 1 ? 1 : 0, known: new Set() });
    return true;
  }

  removeSpectator(clientId: number): void {
    this.spectators.delete(clientId);
  }

  buildSpectatorSnapshotFor(clientId: number): ServerMsg | null {
    const s = this.spectators.get(clientId);
    if (!s) return null;
    return buildSnapshot(this.sim, s.team, 0, s.known, this.eventsThisTick);
  }
}
