// One live match: the authoritative Sim plus its players. The server never
// resolves gameplay itself: every command is validated here, then handed to
// a sim method (ADR 0001). Transport-agnostic and fully testable without a
// socket.

import { type ClientMsg, isSelectMsg, type ServerMsg } from '../src/net/protocol';
import {
  applySimCommand,
  buildMatchSim,
  REPLAY_EVENT_CAP,
  type ReplayEvent,
  type ReplayPick,
} from '../src/net/replay';
import { attachBot } from '../src/sim/content/bots';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import type { LanePreference, PlaybookDef } from '../src/sim/playbook/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';
import { dropInTeam } from './drop_in';
import { buildSnapshot } from './snapshot';
import { starOrchard } from './star_orchard';

export interface MatchPick {
  clientId: number;
  name: string;
  team: TeamId;
  // Whose seat a person's pick is: the account's id, negative for a Guest
  // (server/guests.ts), read as the select started, so it outlives a
  // socket that closed during the select. Absent on a seat nobody holds.
  accountId?: number;
  championId: string;
  sigils: [string, string];
  // Cosmetic skin index; clamped by the sim.
  skin?: number;
  // Bot policy id: this seat is driven in-sim, not by a connection.
  bot?: string;
  // Forge queue: the picked champion's definition, already resolved and
  // approved for this seat by the matchmaker's account boundary.
  forged?: ForgedChampionDef;
  // An account's own bot in this seat (ADR 0013): its playbook, resolved
  // by the account boundary like a forged definition, and which bot and
  // version it is, for the bot's Record at the end.
  playbook?: PlaybookDef;
  botId?: string;
  botVersion?: number;
  // A ranked bot the fill seated from the pool (docs/design/bots.md): the
  // owning account, with nobody connected behind the seat.
  ownerId?: number;
  // The seat's own lane preference (ADR 0026): a person's settled choice
  // at champion select, a house seat's fill lane. Recorded on the replay
  // pick, which seats it (src/net/replay.ts, buildMatchSim).
  lanes?: LanePreference[];
}

interface MatchPlayer {
  clientId: number;
  name: string;
  team: TeamId;
  unitId: number;
  known: Set<number>;
  // sim.tickCount of this player's last command, for the AFK sweep.
  lastCommandAt: number;
  // A coach seat (ADR 0013): the account's own bot plays; the person only
  // orders. Never idle-swept, never handed to a stand-in, never a leaver.
  coach: boolean;
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
  // The match's forged definitions, unique and in pick order: what match
  // setup distributes to every client and what the saved replay embeds.
  readonly forgedDefs: readonly ForgedChampionDef[];
  private readonly unitNames = new Map<number, string>();
  private readonly pickUnitIds: readonly number[];
  // Seats a bot holds from the start that a newcomer may take (ADR 0025):
  // house bots, and ranked bots the fill seated from the pool. A seat a
  // dropped player left to a stand-in is not here: it is held for them.
  private readonly botSeats = new Map<number, { team: TeamId; pool: boolean }>();
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
      ...(p.playbook !== undefined ? { playbook: p.playbook } : {}),
      ...(p.lanes !== undefined ? { lanes: [...p.lanes] } : {}),
    }));
    const forged = new Map<string, ForgedChampionDef>();
    for (const p of picks) {
      if (p.forged && !forged.has(p.forged.id)) forged.set(p.forged.id, p.forged);
    }
    this.forgedDefs = [...forged.values()];
    // The shared builder IS the live construction: a replayed sim starts
    // from the same seed, picks, and policy attachments by definition.
    const { sim, unitIds } = buildMatchSim(starOrchard(), seed, this.replayPicks, this.forgedDefs);
    this.sim = sim;
    this.pickUnitIds = unitIds;
    picks.forEach((p, i) => {
      const unitId = unitIds[i]!;
      this.unitNames.set(unitId, p.name);
      // House bots and pool bots have nobody behind them: no player row.
      if (p.bot || p.ownerId !== undefined) {
        this.botSeats.set(unitId, { team: p.team, pool: p.ownerId !== undefined });
        return;
      }
      this.players.set(p.clientId, {
        clientId: p.clientId,
        name: p.name,
        team: p.team,
        unitId,
        known: new Set(),
        lastCommandAt: 0,
        coach: p.playbook !== undefined,
      });
    });
  }

  // The unit a pick became, by its index in pick order (the ids are
  // allocated in that order): for seats nobody is connected behind.
  unitIdOfPick(index: number): number | undefined {
    return this.pickUnitIds[index];
  }

  // Connected players whose last command is older than maxIdleTicks.
  idleClientIds(maxIdleTicks: number): number[] {
    const out: number[] = [];
    for (const p of this.players.values()) {
      if (p.coach) continue;
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
  // seat's default bot (the Jungler on a seat that asked for the forest,
  // else the Laner) instead of standing inert for the rest of the match,
  // and the scoreboard row says so. The seat's lane preference stands, so
  // the stand-in holds the lane and no teammate moves. Returns the seat,
  // for the team notice and the rejoin reservation.
  handleDisconnect(
    clientId: number,
  ): { name: string; team: TeamId; unitId: number; coach?: true } | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    this.players.delete(clientId);
    // A coach leaving changes nothing on the map: the bot was playing
    // already and keeps playing; the seat is held for the coach to return.
    if (p.coach) return { name: p.name, team: p.team, unitId: p.unitId, coach: true };
    attachBot(this.sim, p.unitId, undefined);
    this.recordReplay({ k: this.sim.tickCount, u: p.unitId, e: 'bot_on' });
    this.unitNames.set(p.unitId, `${p.name} (bot)`);
    return { name: p.name, team: p.team, unitId: p.unitId };
  }

  // The reverse: a reconnected player takes the seat back from the bot.
  // The fresh known set makes the snapshot layer resend every identity, so
  // the new mirror world starts complete.
  restorePlayer(
    clientId: number,
    seat: { name: string; team: TeamId; unitId: number; coach?: true },
  ): void {
    if (!seat.coach) {
      this.sim.detachPolicy(seat.unitId);
      this.recordReplay({ k: this.sim.tickCount, u: seat.unitId, e: 'bot_off' });
      this.unitNames.set(seat.unitId, seat.name);
    }
    this.players.set(clientId, {
      clientId,
      name: seat.name,
      team: seat.team,
      unitId: seat.unitId,
      known: new Set(),
      // A fresh idle clock: a rejoin must not be flagged AFK on arrival.
      lastCommandAt: this.sim.tickCount,
      coach: seat.coach === true,
    });
  }

  // How many bot seats a newcomer could still take.
  get openBotSeats(): number {
    return this.botSeats.size;
  }

  // A newcomer takes a bot's seat (ADR 0025): the side with fewer people
  // on it (server/drop_in.ts), a house bot before a ranked one, the lowest
  // unit id first so the choice never depends on anything but the match.
  // The champion comes as the bot left it: its level, its gold, its items.
  // Returns the seat, or null when no bot seat is left.
  takeBotSeat(
    clientId: number,
    name: string,
  ): { unitId: number; team: TeamId; pool: boolean } | null {
    const humans: [number, number] = [0, 0];
    for (const p of this.players.values()) humans[p.team] += 1;
    const seats: [number, number] = [0, 0];
    for (const s of this.botSeats.values()) seats[s.team] += 1;
    const team = dropInTeam(humans, seats);
    if (team === null) return null;
    const chosen = [...this.botSeats]
      .filter(([, s]) => s.team === team)
      .sort(([ua, a], [ub, b]) => Number(a.pool) - Number(b.pool) || ua - ub)[0]?.[0];
    if (chosen === undefined) return null;
    const pool = this.botSeats.get(chosen)?.pool === true;
    this.botSeats.delete(chosen);
    this.restorePlayer(clientId, { name, team, unitId: chosen });
    return { unitId: chosen, team, pool };
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

  // The last tick's events, for the play ledger a bot seat's Record wants.
  get lastEvents(): readonly SimEvent[] {
    return this.eventsThisTick;
  }

  handleCommand(clientId: number, msg: ClientMsg): void {
    const p = this.players.get(clientId);
    if (!p) return;
    // The select's messages are over once the match runs (ADR 0026): a
    // late lane claim is neither recorded nor counted as play.
    if (isSelectMsg(msg)) return;
    // A coach only orders; every hands-on verb belongs to the bot. And an
    // order from a hand seat is nobody's to obey.
    if (p.coach !== (msg.t === 'order')) return;
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
