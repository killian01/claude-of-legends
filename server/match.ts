// One live match: the authoritative Sim plus its players. The server never
// resolves gameplay itself: every command is validated here, then handed to
// a sim method (ADR 0001). Transport-agnostic and fully testable without a
// socket.

import { type ClientMsg, isSelectMsg, type ServerMsg, type WireStepId } from '../src/net/protocol';
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
import { isSide } from '../src/sim/teams';
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
  // What the seat report says of this seat when it ends (server/
  // seat_report.ts, PRIVACY.md): when it was taken, when the client said
  // its match had loaded, its commands (how many, and the first), how far
  // its champion walked, and the points it banked. Ticks of sim.tickCount.
  stats: SeatStats;
  // The number of the last order this connection sent that the sim
  // applied, and the match time it did (ClientMsg n, SelfSnap ack), for
  // the client's prediction: a seat taken back or taken over starts
  // again from none, as its new connection numbers from one.
  ack: number;
  ackAt: number;
}

export interface SeatStats {
  startTick: number;
  loadedTick: number | null;
  orders: number;
  // The orders by kind (SEAT_ORDER_KINDS), the rest as 'other': a seat that
  // gave orders and never walked says which ones it gave.
  kinds: Record<string, number>;
  firstOrderTick: number | null;
  // The first steps the client said were done, and 'off' for the guide
  // hidden (ClientMsg step), in order, each once.
  steps: string[];
  // Meters walked, from tick to tick; a step longer than WALK_STEP_MAX (a
  // respawn, a recall, a blink) is not walking and is left out.
  walked: number;
  lastX: number;
  lastZ: number;
  // On the planet's sphere (a battle royale, server/royale_match.ts).
  lastY?: number;
  points: number;
  // The seat's first moments (noteMoments), as ticks: a blow given to a
  // champion and one taken from a champion, a takedown, the champion's
  // first fall, the first cache it opened (a battle royale's). What a
  // visitor who left after a minute had met by then.
  firstHitTick: number | null;
  firstHurtTick: number | null;
  firstTakedownTick: number | null;
  firstDeathTick: number | null;
  firstCacheTick: number | null;
}

// The events that make a seat's first moments, as the sims of both modes
// tell them.
export type MomentEvent =
  | { type: 'damage'; sourceId: number; targetId: number }
  | { type: 'death'; unitId: number; killerId: number }
  | { type: 'royale_cache'; unitId: number }
  | { type: string };

// Notes the first moments of a seat's champion off one tick's events;
// `champion` says whether an id is a champion's.
export function noteMoments(
  stats: SeatStats,
  unitId: number,
  events: readonly MomentEvent[],
  tick: number,
  champion: (id: number) => boolean,
): void {
  for (const e of events) {
    if (e.type === 'damage' && 'sourceId' in e) {
      if (e.sourceId === e.targetId) continue;
      if (e.sourceId === unitId && champion(e.targetId)) stats.firstHitTick ??= tick;
      if (e.targetId === unitId && champion(e.sourceId)) stats.firstHurtTick ??= tick;
    } else if (e.type === 'death' && 'killerId' in e) {
      if (e.unitId === unitId) stats.firstDeathTick ??= tick;
      else if (e.killerId === unitId && champion(e.unitId)) stats.firstTakedownTick ??= tick;
    } else if (e.type === 'royale_cache' && 'unitId' in e && e.unitId === unitId) {
      stats.firstCacheTick ??= tick;
    }
  }
}

export const WALK_STEP_MAX = 3;

// The kinds of order a seat's report counts by name; anything else a client
// sends counts as 'other', so a client cannot grow the record.
export const SEAT_ORDER_KINDS: ReadonlySet<string> = new Set([
  'move',
  'attack',
  'attack_move',
  'stop',
  'recall',
  'cast',
  'sigil',
  'buy',
  'sell',
  'drink',
  'skill',
  'order',
]);

// The number an order carries for the client's prediction, when it is
// one of the orders that carry one (ClientMsg n).
export function orderNumber(msg: ClientMsg): number | undefined {
  switch (msg.t) {
    case 'move':
    case 'attack':
    case 'attack_move':
    case 'stop':
    case 'recall':
    case 'cast':
      return typeof msg.n === 'number' ? msg.n : undefined;
    default:
      return undefined;
  }
}

// A command as the replay keeps it and the sim applies it: without the
// client's order number.
export function withoutOrderNumber(msg: ClientMsg): ClientMsg {
  if (!('n' in msg) || orderNumber(msg) === undefined) return msg;
  const { n: _n, ...rest } = msg as ClientMsg & { n?: number };
  return rest as ClientMsg;
}

export function freshStats(tick: number, x: number, z: number): SeatStats {
  return {
    startTick: tick,
    loadedTick: null,
    orders: 0,
    kinds: {},
    firstOrderTick: null,
    steps: [],
    walked: 0,
    lastX: x,
    lastZ: z,
    points: 0,
    firstHitTick: null,
    firstHurtTick: null,
    firstTakedownTick: null,
    firstDeathTick: null,
    firstCacheTick: null,
  };
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
        stats: this.statsAt(unitId),
        ack: 0,
        ackAt: 0,
      });
    });
  }

  private statsAt(unitId: number): SeatStats {
    const u = this.sim.units.get(unitId);
    return freshStats(this.sim.tickCount, u?.pos.x ?? 0, u?.pos.z ?? 0);
  }

  // The client says its match is on screen (the 'loaded' message): the
  // first time only, so the seat report can tell a slow load from a
  // player who saw the match and did nothing.
  markLoaded(clientId: number): void {
    const p = this.players.get(clientId);
    if (p && p.stats.loadedTick === null) p.stats.loadedTick = this.sim.tickCount;
  }

  // A first step the client did, or 'off' (ClientMsg step), checked on
  // the wire already: for the seat's report, once each.
  noteStep(clientId: number, id: WireStepId | 'off'): void {
    const p = this.players.get(clientId);
    if (p && !p.stats.steps.includes(id)) p.stats.steps.push(id);
  }

  // Points banked for the seat (server/points.ts), for its report.
  notePoints(clientId: number, delta: number): void {
    const p = this.players.get(clientId);
    if (p) p.stats.points += delta;
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
      // A seat taken back or taken over starts a report of its own.
      stats: this.statsAt(seat.unitId),
      ack: 0,
      ackAt: 0,
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
    // The drop in balances the 5v5's two sides.
    const humans: [number, number] = [0, 0];
    for (const p of this.players.values()) if (isSide(p.team)) humans[p.team] += 1;
    const seats: [number, number] = [0, 0];
    for (const s of this.botSeats.values()) if (isSide(s.team)) seats[s.team] += 1;
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
    // How far each seat's champion walked, for its report. Bookkeeping
    // beside the sim, never read by it.
    for (const p of this.players.values()) {
      const u = this.sim.units.get(p.unitId);
      if (!u) continue;
      const step = Math.hypot(u.pos.x - p.stats.lastX, u.pos.z - p.stats.lastZ);
      if (!u.dead && step <= WALK_STEP_MAX) p.stats.walked += step;
      p.stats.lastX = u.pos.x;
      p.stats.lastZ = u.pos.z;
      noteMoments(p.stats, p.unitId, this.eventsThisTick, this.sim.tickCount, this.isChampion);
    }
  }

  private readonly isChampion = (id: number): boolean =>
    this.sim.units.get(id)?.kind === 'champion';

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
    p.stats.orders += 1;
    const kind = SEAT_ORDER_KINDS.has(msg.t) ? msg.t : 'other';
    p.stats.kinds[kind] = (p.stats.kinds[kind] ?? 0) + 1;
    if (p.stats.firstOrderTick === null) p.stats.firstOrderTick = this.sim.tickCount;
    // The order's number is the client's own (src/net/self_predict.ts):
    // told back in the seat's snapshots, never recorded, never applied.
    const n = orderNumber(msg);
    if (n !== undefined && Number.isSafeInteger(n) && n > p.ack) {
      p.ack = n;
      p.ackAt = this.sim.time;
    }
    const cmd = withoutOrderNumber(msg);
    // Recorded raw, then applied through the SAME validated path a replay
    // uses: an invalid command no-ops identically live and replayed.
    this.recordReplay({ k: this.sim.tickCount, u: p.unitId, e: 'cmd', c: cmd });
    applySimCommand(this.sim, p.team, p.unitId, cmd);
  }

  buildSnapshotFor(clientId: number): ServerMsg | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    return buildSnapshot(this.sim, p.team, p.unitId, p.known, this.eventsThisTick, p);
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
