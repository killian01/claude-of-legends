// One live battle royale (ADR 0031): the authoritative sim of the mode and
// the people in it, beside server/match.ts's 5v5. Fifty seats, each its own
// team; the people who started it on the champions they picked, bots on the
// rest. A newcomer takes a bot's seat (ADR 0025), a bot playing the
// champion they picked when there is one: once the match is in play the
// champion arrives fresh at a quiet spot, in its Grace, its tally from zero
// (CONTEXT.md: Arrival; src/sim/royale/grace.ts). A
// person who leaves hands the seat to the mode's bot, held for them when the
// connection only dropped. Transport-agnostic: the service hands it what a
// socket said and sends what it answers.

import { type ClientMsg, type ServerMsg, type WireStepId, wirePoint } from '../src/net/protocol';
import {
  REPLAY_EVENT_CAP,
  REPLAY_VERSION,
  type ReplayEvent,
  type ReplayPick,
  type RoyaleRecord,
} from '../src/net/replay';
import type { RoyaleResult, RoyaleVariant, SeatLabel } from '../src/net/royale_wire';
import {
  freshStats,
  noteMoments,
  orderNumber,
  type SeatStats,
  WALK_STEP_MAX,
  withoutOrderNumber,
} from './match';
import { applyRoyaleCommand, ROYALE_VERBS } from './royale_commands';
import { chooseBotSeat } from './royale_join';
import { RoyalePoints } from './royale_points';
import { finalPlaces, type RankedSeat, royaleRanking, royaleResult } from './royale_ranking';
import { type RoyalePerson, royaleSeats } from './royale_seats';
import type { RoyaleBuild, RoyaleSim, RoyaleSimEvent, RoyaleSimFactory } from './royale_sim';
import { buildRoyaleSnapshot, CACHES_EVERY_TICKS } from './royale_snapshot';

export interface RoyalePlayer {
  clientId: number;
  // The account, or a Guest's negative id: whose points the seat banks and
  // whose rejoin reservation holds it.
  owner: number;
  name: string;
  guest: boolean;
  unitId: number;
  team: number;
  known: Set<number>;
  // sim.tickCount of the last command, for the end's "still playing".
  lastCommandAt: number;
  stats: SeatStats;
  // The client's own order numbers (ClientMsg n), told back as in the 5v5.
  ack: number;
  ackAt: number;
  // Took a bot's seat after the start (ADR 0025).
  dropIn: boolean;
  // Respawn, a drop-in into the match in play: when they landed, and every
  // seat's score then. The rank line and the end card count from there
  // (server/royale_ranking.ts windowStanding), so a seat that came in late
  // is ranked on what it played, not against whole-match scores. Null for
  // a seat from the drop and for a rejoin.
  window: { from: number; base: Map<number, number> } | null;
  // The caches list, and the scoreboard with every seat's name and bot
  // mark, reached this person at least once.
  cachesSent: boolean;
  scoreSent: boolean;
  // The result was told: out for good (One life), or the end.
  resultSent: boolean;
}

interface SeatState {
  unitId: number;
  team: number;
  name: string;
  championId: string;
  // A bot plays it now.
  bot: boolean;
  // The person whose dropped connection this seat waits for, by owner.
  heldFor: number | null;
}

// A battle royale's replay (src/net/replay.ts ReplayRecord with the mode's
// block): the seed, the picks and every event that steered the sim, the
// variant, whether the bots played softer and the newcomers' seats, so
// buildRoyaleSim rebuilds it, and the royale rules it ran under
// (ROYALE_RULES_VERSION), which a loader checks (src/net/replay.ts
// royaleReplayPlayable).
export interface RoyaleReplay {
  version: number;
  seed: number;
  picks: readonly ReplayPick[];
  events: readonly ReplayEvent[];
  ticks: number;
  royale: RoyaleRecord;
}

// Every seat of a match this many seats wide, by default the mode's fifty.
export class RoyaleMatch {
  readonly sim: RoyaleSim;
  readonly players = new Map<number, RoyalePlayer>();
  readonly points: RoyalePoints;
  private readonly seats = new Map<number, SeatState>();
  private readonly standIn: RoyaleBuild['standIn'];
  private readonly replay: RoyaleBuild['replay'];
  // Every event that steered the sim, as the 5v5 records them
  // (server/match.ts): the people's commands, the drop picks among them,
  // and the seats changing hands.
  readonly replayEvents: ReplayEvent[] = [];
  private events: readonly RoyaleSimEvent[] = [];
  // Every seat's place once the match is over, ranked once.
  private places: Map<number, number> | null = null;

  constructor(
    readonly id: number,
    readonly seed: number,
    readonly variant: RoyaleVariant,
    people: readonly RoyalePerson[],
    factory: RoyaleSimFactory,
    seatCount?: number,
  ) {
    const seats = royaleSeats(people, seed, seatCount);
    const build = factory(seed, variant, seats);
    this.sim = build.sim;
    this.standIn = build.standIn;
    this.replay = build.replay;
    seats.forEach((s, i) => {
      const unitId = build.unitIds[i];
      if (unitId === undefined) return;
      this.seats.set(unitId, {
        unitId,
        // The team the sim seated the champion on: each its own.
        team: this.sim.units.get(unitId)?.team ?? s.team,
        name: s.name,
        championId: s.championId,
        bot: s.clientId === null,
        heldFor: null,
      });
    });
    seats.forEach((s, i) => {
      const unitId = build.unitIds[i];
      if (s.clientId === null || unitId === undefined) return;
      const person = people.find((p) => p.clientId === s.clientId);
      if (person) this.seat(person, unitId, false);
    });
    this.points = new RoyalePoints(this.sim, variant);
  }

  get seatCount(): number {
    return this.seats.size;
  }

  private record(ev: ReplayEvent): void {
    if (this.replayEvents.length < REPLAY_EVENT_CAP) this.replayEvents.push(ev);
  }

  // The match's replay, once it stayed within bounds; null past them.
  replayRecord(): RoyaleReplay | null {
    if (this.replayEvents.length >= REPLAY_EVENT_CAP) return null;
    return {
      version: REPLAY_VERSION,
      seed: this.seed,
      picks: this.replay.picks,
      events: this.replayEvents,
      ticks: this.sim.tickCount,
      royale: this.replay.royale,
    };
  }

  get stage(): 'drop' | 'play' | 'over' {
    return this.sim.royale.stage;
  }

  get over(): boolean {
    return this.sim.royale.stage === 'over';
  }

  get lastEvents(): readonly RoyaleSimEvent[] {
    return this.events;
  }

  // Who holds a seat now, for the names on the wire.
  seatLabel(unitId: number): SeatLabel | undefined {
    const s = this.seats.get(unitId);
    return s ? { name: s.name, bot: s.bot } : undefined;
  }

  // Out for good: fallen in One life.
  isOut(unitId: number): boolean {
    return this.variant === 'one_life' && this.sim.royale.eliminated.includes(unitId);
  }

  private takeable(s: SeatState): boolean {
    return s.bot && s.heldFor === null && !this.isOut(s.unitId);
  }

  // Bot seats a newcomer could take now.
  get openBotSeats(): number {
    let n = 0;
    for (const s of this.seats.values()) if (this.takeable(s)) n += 1;
    return n;
  }

  private seat(person: RoyalePerson, unitId: number, dropIn: boolean): RoyalePlayer {
    const s = this.seats.get(unitId);
    const u = this.sim.units.get(unitId);
    const stats = freshStats(this.sim.tickCount, u?.pos.x ?? 0, u?.pos.z ?? 0);
    if (u?.pos.y !== undefined) stats.lastY = u.pos.y;
    const r = this.sim.royale;
    const arrived = dropIn && r.stage === 'play';
    // The seat came down fresh (the Arrival): what it scores from here
    // falls inside every other drop-in's window.
    if (arrived) {
      for (const other of this.players.values()) {
        other.window?.base.set(unitId, r.scores.get(unitId) ?? 0);
      }
    }
    const player: RoyalePlayer = {
      clientId: person.clientId,
      owner: person.owner,
      name: person.name,
      guest: person.guest,
      unitId,
      team: s?.team ?? 0,
      known: new Set(),
      lastCommandAt: this.sim.tickCount,
      stats,
      ack: 0,
      ackAt: 0,
      dropIn,
      window:
        arrived && this.variant === 'respawn'
          ? { from: this.sim.time, base: new Map(r.scores) }
          : null,
      cachesSent: false,
      scoreSent: false,
      resultSent: false,
    };
    this.players.set(person.clientId, player);
    return player;
  }

  // The seat changed hands: everyone who knows the champion is sent its
  // identity again, the new name and bot mark with it.
  private reidentify(unitId: number): void {
    for (const p of this.players.values()) p.known.delete(unitId);
  }

  // A newcomer takes a bot's seat (ADR 0025), with the sigils and skin they
  // chose; in play, the champion's Arrival (Sim.beginArrival): fresh at a
  // quiet spot inside the light, in its Grace, its score, kills, deaths and
  // assists from zero, recorded so a replay re-simulates it on the same
  // tick. During the drop the seat simply lands with everyone. Null when no
  // seat is left to take.
  takeBotSeat(person: RoyalePerson): RoyalePlayer | null {
    const candidates = [...this.seats.values()].filter((s) => this.takeable(s));
    const unitId = chooseBotSeat(
      candidates.map((s) => ({
        unitId: s.unitId,
        championId: this.sim.units.get(s.unitId)?.championId ?? s.championId,
        dead: this.sim.units.get(s.unitId)?.dead === true,
        out: this.isOut(s.unitId),
      })),
      person.pick.championId,
    );
    const s = unitId === null ? undefined : this.seats.get(unitId);
    if (unitId === null || !s) return null;
    this.sim.detachPolicy(unitId);
    this.record({ k: this.sim.tickCount, u: unitId, e: 'bot_off' });
    // The person plays the sigils and skin they chose, not the bot's: the
    // seat is one playing their champion whenever the match has one
    // (chooseBotSeat, royaleSeats deals every champion to the bots).
    const kit = { sigils: [...person.pick.sigils] as [string, string], skin: person.pick.skin };
    this.sim.setLoadout(unitId, kit.sigils, kit.skin);
    this.record({ k: this.sim.tickCount, u: unitId, e: 'kit', kit });
    if (this.sim.royale.stage === 'play') {
      this.sim.beginArrival(unitId);
      this.record({ k: this.sim.tickCount, u: unitId, e: 'arrive' });
    }
    s.bot = false;
    s.name = person.name;
    this.reidentify(unitId);
    return this.seat(person, unitId, true);
  }

  // A person leaves the seat: the mode's bot plays it from here, and when
  // `hold` (a dropped connection) the seat waits for its owner to return.
  leave(clientId: number, hold: boolean): RoyalePlayer | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    this.players.delete(clientId);
    const s = this.seats.get(p.unitId);
    if (s) {
      s.bot = true;
      s.heldFor = hold ? p.owner : null;
      this.standIn(p.unitId);
      this.record({ k: this.sim.tickCount, u: p.unitId, e: 'bot_on' });
      this.reidentify(p.unitId);
    }
    return p;
  }

  // The seat held for `person` (a dropped connection) is theirs again.
  rejoin(person: RoyalePerson, unitId: number): RoyalePlayer | null {
    const s = this.seats.get(unitId);
    if (!s || s.heldFor !== person.owner || !s.bot) return null;
    this.sim.detachPolicy(unitId);
    this.record({ k: this.sim.tickCount, u: unitId, e: 'bot_off' });
    s.bot = false;
    s.heldFor = null;
    s.name = person.name;
    this.reidentify(unitId);
    return this.seat(person, unitId, false);
  }

  // The reservation on a seat ran out: a newcomer may take it.
  release(unitId: number): void {
    const s = this.seats.get(unitId);
    if (s) s.heldFor = null;
  }

  // The landing point a person picked during the drop.
  pickDrop(clientId: number, x: unknown, y: unknown, z: unknown): void {
    const p = this.players.get(clientId);
    if (!p || this.sim.royale.stage !== 'drop') return;
    const at = wirePoint(x, z, y);
    if (!at || at.y === undefined) return;
    p.lastCommandAt = this.sim.tickCount;
    const pick = { x: at.x, y: at.y, z: at.z };
    this.record({ k: this.sim.tickCount, u: p.unitId, e: 'cmd', c: { t: 'drop', ...pick } });
    this.sim.pickDrop(p.unitId, pick);
  }

  handleCommand(clientId: number, msg: ClientMsg): void {
    const p = this.players.get(clientId);
    if (!p || !ROYALE_VERBS.has(msg.t)) return;
    p.lastCommandAt = this.sim.tickCount;
    p.stats.orders += 1;
    p.stats.kinds[msg.t] = (p.stats.kinds[msg.t] ?? 0) + 1;
    if (p.stats.firstOrderTick === null) p.stats.firstOrderTick = this.sim.tickCount;
    const n = orderNumber(msg);
    if (n !== undefined && Number.isSafeInteger(n) && n > p.ack) {
      p.ack = n;
      p.ackAt = this.sim.time;
    }
    const cmd = withoutOrderNumber(msg);
    this.record({ k: this.sim.tickCount, u: p.unitId, e: 'cmd', c: cmd });
    applyRoyaleCommand(this.sim, p.team, p.unitId, cmd);
  }

  markLoaded(clientId: number): void {
    const p = this.players.get(clientId);
    if (p && p.stats.loadedTick === null) p.stats.loadedTick = this.sim.tickCount;
  }

  noteStep(clientId: number, id: WireStepId | 'off'): void {
    const p = this.players.get(clientId);
    if (p && !p.stats.steps.includes(id)) p.stats.steps.push(id);
  }

  notePoints(clientId: number, delta: number): void {
    const p = this.players.get(clientId);
    if (p) p.stats.points += delta;
  }

  tick(): readonly RoyaleSimEvent[] {
    this.events = this.sim.tick();
    for (const p of this.players.values()) {
      const u = this.sim.units.get(p.unitId);
      if (!u) continue;
      const dy = (u.pos.y ?? 0) - (p.stats.lastY ?? 0);
      const step = Math.hypot(u.pos.x - p.stats.lastX, dy, u.pos.z - p.stats.lastZ);
      if (!u.dead && step <= WALK_STEP_MAX) p.stats.walked += step;
      p.stats.lastX = u.pos.x;
      p.stats.lastZ = u.pos.z;
      if (u.pos.y !== undefined) p.stats.lastY = u.pos.y;
      noteMoments(p.stats, p.unitId, this.events, this.sim.tickCount, this.isChampion);
    }
    return this.events;
  }

  private readonly isChampion = (id: number): boolean =>
    this.sim.units.get(id)?.kind === 'champion';

  // The people whose champion fell for good this tick (One life).
  outThisTick(): RoyalePlayer[] {
    const out: RoyalePlayer[] = [];
    for (const ev of this.events) {
      if (ev.type !== 'royale_out') continue;
      for (const p of this.players.values()) if (p.unitId === ev.unitId) out.push(p);
    }
    return out;
  }

  snapshotFor(clientId: number): ServerMsg | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    const caches = !p.cachesSent || this.sim.tickCount % CACHES_EVERY_TICKS === 0;
    p.cachesSent = true;
    if (this.over && !this.places) {
      this.places = finalPlaces(royaleRanking(this.sim.royale, this.rankedSeats()));
    }
    const finalPlace = this.places?.get(p.unitId);
    return buildRoyaleSnapshot(
      this.sim,
      { unitId: p.unitId, team: p.team, known: p.known, seat: p },
      this.events,
      {
        seat: (id) => this.seatLabel(id),
        seats: this.seats.size,
        people: this.players.size,
        caches,
        ...(finalPlace !== undefined ? { finalPlace } : {}),
        ...(p.window ? { windowBase: p.window.base } : {}),
      },
    );
  }

  // The scoreboard, the seat's name and bot mark on every line.
  buildScore(): ServerMsg {
    const rows = this.sim.scoreboard().map((r) => {
      const s = this.seats.get(r.unitId);
      return { ...r, player: s?.name ?? null, ...(s?.bot ? { b: 1 as const } : {}) };
    });
    return { t: 'score', rows };
  }

  rankedSeats(): RankedSeat[] {
    return [...this.seats.values()].map((s) => ({
      unitId: s.unitId,
      name: s.name,
      championId: this.sim.units.get(s.unitId)?.championId ?? s.championId,
      bot: s.bot,
      deaths: this.sim.units.get(s.unitId)?.deaths ?? 0,
    }));
  }

  resultFor(clientId: number): RoyaleResult | null {
    const p = this.players.get(clientId);
    if (!p) return null;
    const r = this.sim.royale;
    const result = royaleResult(r, this.rankedSeats(), p.unitId, p.window?.base ?? null);
    // Respawn: how long the seat was the person's, for the end card's
    // "in 6:12".
    if (this.variant === 'respawn') {
      result.held = Math.max(0, Math.round(this.sim.time - (p.window?.from ?? r.dropEndsAt)));
    }
    // The Grafts the seat took, in order, for the end card.
    const grafts = r.grafts.get(p.unitId);
    if (grafts && grafts.length > 0) result.grafts = [...grafts];
    return result;
  }
}
