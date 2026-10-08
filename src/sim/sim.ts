// The sim coordinator. Stays thin: systems live in sibling modules driven
// through CombatCtx, and the tick calls them in a FIXED order (the order is
// load-bearing for determinism):
//   statuses -> income and regen -> waves -> minion AI -> tower AI ->
//   auto-attacks -> movement -> projectiles -> zones -> deaths -> respawns ->
//   vision -> clock.

import { stepAttackMove } from './attack_move';
import { runBotDecisions } from './bot_driver';
import { initialCampStates, noteCampSightings, onCampSlain, stepCamps } from './camps';
import { ChampionRegistry } from './champion_registry';
import { type CoachOrder, stepCoachOrder } from './coach';
import { stepAutoAttacks } from './combat/auto_attack';
import { castAbility, executeCast, stepWindups } from './combat/casting';
import { stepDots } from './combat/dots';
import { stepShieldBursts } from './combat/shield_burst';
import {
  breakStealth,
  cancelRecall,
  effectiveMoveSpeed,
  expireStatuses,
  isRooted,
  isStunned,
  sightFactor,
} from './combat/status';
import { type ChampionDef, DEFAULT_CHAMPION_ID, homeLane } from './content/champions';
import { ITEMS, mayCarryDraught } from './content/items';
import { GAME_MAP, type GameMap, type LaneId, type WardenPit } from './content/map';
import { type AspectId, type CreatureId, RING_GOLD_EACH, TIDE_PERIOD_S } from './content/rings';
import { PLANET_NEUTRAL_SCALE, RING_RISE_AT_S, WARDEN_RISE_AT_S } from './content/royale_events';
import { SIGILS } from './content/sigils';
import { clampSkin } from './content/skins';
import { stepDashes } from './dashes';
import { hasDecisionToken, spendDecisionToken } from './decision_budget';
import { startDraught, stepDraughts } from './draught';
import { Favors, favorBonus } from './favors';
import type { ForgedChampionDef } from './forge/forged_def';
import { applyFountainRegen, fountainSeat, withinFountain } from './fountain';
import { copy, dist, point } from './geo';
import { type Ground, PlaneGround } from './ground';
import { stepIdleDefense } from './idle_defense';
import { LANE_ACTIVITY_WINDOW_S, LaneSightings } from './lane_sightings';
import { assignLanes, laneOf } from './lanes';
import { createMapUnits } from './map_units';
import { stepMinionAi } from './minion_ai';
import { stepMovement } from './movement';
import { NavGrid } from './navgrid';
import { initialObjectiveState, onWardenSlain, stepObjectives, wardenPitOf } from './objectives';
import { passiveOf, runGraftTakedown, stepPassives } from './passives';
import { playbookPolicy } from './playbook/interpreter';
import type { LanePreference, PlaybookDef } from './playbook/types';
import type { Action, ObsCamp, Observation, Policy } from './policy';
import type { Projectile } from './projectiles';
import { stepProjectiles } from './projectiles';
import { startRecall, stepRecalls } from './recall';
import { createRemoteSeat, type RemoteSeat, runRemoteDecisions } from './remote_policy';
import { respawnDelay } from './respawn';
import { ASSIST_GOLD_FRAC, championBounty, grantKillRewards, grantPassiveGold } from './rewards';
import { initialRingStates, onCreatureSlain, type RingClock, ringClocks, stepRings } from './rings';
import { Rng } from './rng';
import { keepHold } from './royale/grace';
import { RoyaleMode, type RoyaleOptions } from './royale/mode';
import { DROP_S, type RoyaleEvent, type RoyaleState } from './royale/types';
import { MINIONS_ONLY, stepSeparation } from './separation';
import type { CombatCtx } from './sim_context';
import {
  deepCopy,
  freezeUnits,
  refillMap,
  refillSet,
  type SimSnapshot,
  thawUnits,
} from './snapshot';
import {
  BASIC_MAX_RANK,
  effectiveRank,
  levelTo,
  recalcChampion,
  ULT_MAX_RANK,
  ULT_RANK_LEVELS,
} from './stats';
import { TeamBuffs } from './team_buffs';
import { otherTeam, perTeam, TWO_TEAMS, validTeam } from './teams';
import { stepTowerAi } from './tower_ai';
import {
  type AbilityKey,
  type DamageType,
  DT,
  type ScoreRow,
  type TeamId,
  TICK_RATE,
  type Vec2,
} from './types';
import { createChampion, hostile, staticFootprint, type Unit, type UnitKind } from './unit';
import { computeVisibility, sightBlocked } from './vision';
import { clampThroughWalls, stepWalls, type Wall } from './walls';
import { FIRST_WAVE_AT, spawnWave, WAVE_EVERY } from './waves';
import type { Zone } from './zones';
import { stepZones } from './zones';

export type SimEvent =
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; dtype: DamageType }
  | { type: 'attack'; unitId: number; targetId: number }
  | { type: 'death'; unitId: number; killerId: number }
  | { type: 'cast'; unitId: number; key: AbilityKey }
  | { type: 'sigil'; unitId: number; slot: number }
  | { type: 'gold'; unitId: number; amount: number }
  // A bot's active play changed (ADR 0013): the trace behind the overlay
  // and the report. Emitted from inside the decision slot.
  | { type: 'play'; unitId: number; playId: string }
  | { type: 'victory'; team: TeamId }
  // A ring's creature fell and its aspect became the team's favor.
  | { type: 'favor'; team: TeamId; aspect: AspectId; creature: CreatureId | null }
  // An Ascendant fell and the team holds the Wrath.
  | { type: 'wrath'; team: TeamId; creature: CreatureId }
  // The Wrath finished a champion brought under its line.
  | { type: 'execute'; unitId: number; killerId: number }
  // The battle royale's own (royale/types.ts).
  | RoyaleEvent;

// How long a champion's damage on a victim keeps earning an assist.
const ASSIST_WINDOW_S = 10;
// Exported: the HUD draws exactly this many build slots, so a full bag and
// an empty one read as the same shape.
export const INVENTORY_SLOTS = 6;

// Deterministic spawn offsets around the fountain center, by join order.
const SPAWN_SLOTS: readonly { x: number; z: number }[] = [
  { x: 0, z: 0 },
  { x: 1.6, z: 0 },
  { x: 0, z: 1.6 },
  { x: -1.6, z: 0 },
  { x: 0, z: -1.6 },
];

// A match on another map than the launch one (the Star Orchard test mode,
// docs/star-orchard.md): the map record, its walkability grid, and strict
// navigation, which keeps every step, spawn and respawn on a walkable cell
// of a grid finer than a unit's stride. Absent, the launch map as always.
// The team count (ADR 0030) is two for the 5v5, the default, and one per
// champion in a free-for-all; the systems only the 5v5 has (the map's
// towers and Sanctums, waves, the fountain, lane sightings) run only in a
// match of two teams. A mode that decides death on its own terms gives
// respawnPoint (where a dead champion comes back; null keeps it dead, and
// it is asked again every tick until it answers) and respawnDelay (how
// long a champion that just died waits); without them, the fountain and
// the 5v5's clock.
export interface SimOptions {
  map?: GameMap;
  nav?: NavGrid;
  strictNavigation?: boolean;
  teamCount?: number;
  respawnPoint?: (unit: Unit, sim: Sim) => Vec2 | null;
  respawnDelay?: (unit: Unit, sim: Sim) => number;
  // The ground the match stands on (ground.ts, ADR 0029): the planet's
  // sphere for a match on the Wanderseed. Absent, the plane over `nav`.
  ground?: Ground;
  // The kinds of unit that push each other apart (separation.ts): the
  // minions alone on the Orchard, where champions walk through a wave as
  // the genre's do; a crowd of champions on the planet adds them.
  separation?: readonly UnitKind[];
  // The battle royale (ADR 0031, src/sim/royale/mode.ts): the variant and
  // the planet's layout. The match then drops, lands, loots and burns
  // under the Dusk; nothing of the 5v5 runs.
  royale?: RoyaleOptions;
}

// A team's fading memory of one enemy champion (Sim.lastSeen): where it
// stood, y included on the planet (ADR 0029).
export interface LastSeenRecord {
  x: number;
  z: number;
  y?: number;
  at: number;
  hpFrac: number;
}

export class Sim {
  readonly rng: Rng;
  readonly map: GameMap;
  // The 5v5's grid: its lanes, waves, towers and fountain walk it.
  readonly nav: NavGrid;
  // What every system that also runs on the planet walks (ground.ts).
  readonly ground: Ground;
  // Match-scoped champion resolution: the roster plus this match's forged
  // definitions (plan-forge phase 2). Register forged champions BEFORE
  // adding their units; the registration order is part of match identity.
  readonly champions = new ChampionRegistry();
  // How many teams the match holds (ADR 0030): teams are 0 to teamCount - 1.
  readonly teamCount: number;
  readonly units = new Map<number, Unit>();
  readonly projectiles = new Map<number, Projectile>();
  readonly zones = new Map<number, Zone>();
  readonly walls = new Map<number, Wall>();
  // Bots: sim entities driven in-tick by an attached Policy (ADR 0002).
  readonly policies = new Map<number, Policy>();
  // Seats whose Policy runs outside this process (remote_policy.ts).
  readonly remoteSeats = new Map<number, RemoteSeat>();
  // Each team's memory of who stood in which lane (CONTEXT.md: Lane
  // opponent), fed by the vision step.
  readonly laneSightings: LaneSightings;
  time = 0;
  tickCount = 0;
  winner: TeamId | null = null;
  // One set per team, in team order.
  private visibility: Set<number>[];
  // Each team's fading memory of enemy champions: where one was last SEEN
  // and how hurt it was. The honest mirror of a human remembering who ran
  // into which brush; observe.ts exposes only fresh, currently-unseen
  // entries (additive obs v0). Indexed by observing team, keyed by unit id.
  readonly lastSeen: Map<number, LastSeenRecord>[];
  // Every lane has a line for a wave to walk; the planet has none.
  private readonly hasLanes: boolean;
  private nextWaveAt = FIRST_WAVE_AT;
  private waveCount = 0;
  private nextId = 1;
  private events: SimEvent[] = [];
  private readonly dead = new Set<number>();
  private readonly killers = new Map<number, number>();
  // The Warden's Boon lives outside units so it survives deaths.
  readonly teamBuffs: TeamBuffs;
  // Public like teamBuffs: tests rewind the spawn clock instead of ticking
  // ten sim-minutes to meet the first Warden.
  readonly objectives = initialObjectiveState();
  private readonly campStates: ReturnType<typeof initialCampStates>;
  // The rings' creatures and clocks (CONTEXT.md: Ring), empty on a map
  // without rings; public like objectives, so tests rewind a clock.
  readonly ringStates: ReturnType<typeof initialRingStates>;
  // The favors each team holds (CONTEXT.md: Favor), the truth the units'
  // mirrors are refreshed from (grantFavor).
  readonly favors: Favors;
  // The battle royale's rules and state, null in every other match.
  readonly royaleMode: RoyaleMode | null;

  constructor(
    seed: number,
    private readonly options: SimOptions = {},
  ) {
    const teamCount = options.teamCount ?? TWO_TEAMS;
    if (!Number.isInteger(teamCount) || teamCount < 1) {
      throw new Error(`a match holds at least one team, not ${teamCount}`);
    }
    this.teamCount = teamCount;
    this.laneSightings = new LaneSightings(teamCount);
    this.lastSeen = perTeam(teamCount, () => new Map<number, LastSeenRecord>());
    this.teamBuffs = new TeamBuffs(teamCount);
    this.favors = new Favors(teamCount);
    this.rng = new Rng(seed);
    this.map = options.map ?? GAME_MAP;
    this.hasLanes = (['top', 'mid', 'bot'] as const).every((l) => this.map.lanes[l].length >= 2);
    this.campStates = initialCampStates(this.map, teamCount);
    this.ringStates = initialRingStates(this.map);
    this.nav = options.nav ?? new NavGrid(this.map.size, this.map.walls, this.map.borderMargin);
    this.ground = options.ground ?? new PlaneGround(this.nav);
    // The towers and Sanctums are the two sides' (ADR 0030).
    if (this.twoTeams()) {
      for (const u of createMapUnits(this.map, () => this.nextId++)) {
        this.units.set(u.id, u);
        this.ground.blockCircle(u.pos, staticFootprint(u));
      }
    }
    this.royaleMode = options.royale ? new RoyaleMode(this.rng, this.ground, options.royale) : null;
    if (this.royaleMode) {
      // The big creatures rise on the mode's clock, counted from landing
      // (royale/risings.ts keeps it from there).
      this.objectives.nextSpawnAt = DROP_S + WARDEN_RISE_AT_S[this.royaleMode.variant];
      for (const ring of this.ringStates) ring.nextRiseAt = DROP_S + RING_RISE_AT_S;
    }
    this.visibility = computeVisibility(this.map, this.units, 0, undefined, teamCount);
  }

  // The battle royale's state (royale/types.ts), null in every other match.
  get royale(): RoyaleState | null {
    return this.royaleMode?.state ?? null;
  }

  // An event from a mode's step, into this tick's stream.
  pushEvent(e: SimEvent): void {
    this.events.push(e);
  }

  // The landing point a seat picks during the battle royale's drop: a point
  // on the sphere, kept until the drop ends (the last pick wins); in
  // Respawn, a dead seat's pick of where it comes back (royale/
  // return_pick.ts). False otherwise, and outside a battle royale.
  pickDrop(unitId: number, p: { x: number; y: number; z: number }): boolean {
    const u = this.units.get(unitId);
    if (!this.royaleMode || u?.kind !== 'champion') return false;
    return this.royaleMode.pickDrop(unitId, p, this.time, u.dead);
  }

  // A seat's pick of its open Graft offer in the battle royale (the 'graft'
  // action and command): a card index, free, taken while dead, flying or
  // dropping. False when nothing was taken, and outside a battle royale.
  pickGraft(unitId: number, pick: number): boolean {
    const u = this.units.get(unitId);
    if (!this.royaleMode || u?.kind !== 'champion') return false;
    return this.royaleMode.pickGraft(this, unitId, pick);
  }

  // A drop-in's Arrival in the battle royale (server/royale_match.ts, the
  // replay's 'arrive' event): the seat comes down fresh at a quiet spot, in
  // its Grace (royale/grace.ts); nothing outside a battle royale.
  beginArrival(unitId: number): void {
    const u = this.units.get(unitId);
    if (!this.royaleMode || u?.kind !== 'champion') return;
    this.royaleMode.beginArrival(this, unitId);
  }

  // Whether a seat may act right now in the battle royale: on the ground,
  // in play, not carried by a launch pad. Always true elsewhere.
  private royaleActs(unitId: number): boolean {
    const mode = this.royaleMode;
    if (!mode) return true;
    return mode.state.stage === 'play' && !mode.isFlying(unitId);
  }

  // The 5v5's shape: the systems only it has run in a match of two teams.
  private twoTeams(): boolean {
    return this.teamCount === TWO_TEAMS;
  }

  private ctx(): CombatCtx {
    return {
      time: this.time,
      rng: this.rng,
      nav: this.nav,
      ground: this.ground,
      units: this.units,
      projectiles: this.projectiles,
      zones: this.zones,
      walls: this.walls,
      events: this.events,
      dead: this.dead,
      killers: this.killers,
      teamBuffs: this.teamBuffs,
      freeForAll: this.teamCount > TWO_TEAMS,
      ...(this.royaleMode ? { neutralScale: PLANET_NEUTRAL_SCALE } : {}),
      allocId: () => this.nextId++,
    };
  }

  // Register a forged champion for this match; its id becomes pickable by
  // addChampion. Validation happens inside the registry (throws on an
  // invalid or duplicate def).
  addForgedChampion(def: ForgedChampionDef): void {
    this.champions.addForged(def);
  }

  // A champion joins at `at`, else at its team's spawn: the map's authored
  // seats, else a slot around the fountain. A team without a fountain (a
  // free-for-all's, ADR 0030) needs `at`.
  addChampion(team: TeamId, at?: Vec2, championId: string = DEFAULT_CHAMPION_ID, skin = 0): Unit {
    const def = this.champions.get(championId);
    if (!def) throw new Error(`unknown champion ${championId}`);
    if (!validTeam(team, this.teamCount)) {
      throw new Error(`no team ${team} in a match of ${this.teamCount}`);
    }
    const pos = at ?? this.spawnPoint(team);
    const champ = createChampion(this.nextId++, team, pos, def);
    champ.skin = clampSkin(championId, skin);
    this.units.set(champ.id, champ);
    this.assignLanes(team);
    return champ;
  }

  // Where a team's next champion stands at the start: the map's authored
  // spawns in turn, else a seat around the team's fountain. A map without a
  // fountain for the team (the planet) seats a champion only where it is
  // told to stand.
  private spawnPoint(team: TeamId): Vec2 {
    const fountain = this.map.fountains.find((f) => f.team === team);
    if (!fountain) throw new Error(`no fountain for team ${team}`);
    let count = 0;
    for (const u of this.units.values()) {
      if (u.kind === 'champion' && u.team === team) count++;
    }
    const slot = SPAWN_SLOTS[count % SPAWN_SLOTS.length]!;
    const authored = this.map.spawns?.filter((s) => s.team === team) ?? [];
    const spawn = authored[count % Math.max(1, authored.length)];
    return spawn ? { x: spawn.x, z: spawn.z } : fountainSeat(fountain, slot);
  }

  // Every champion of a team holds a lane from creation (CONTEXT.md: Home
  // lane, Assigned lane; src/sim/lanes.ts): its lane preference while that
  // lane has a seat open, else its role's home lane while that one has,
  // else the lane with the most seats open. A person's seat counts like a
  // bot's, so the fill's support lands beside a person's marksman and a
  // stand-in bot on a dropped seat inherits the lane (playtest review: all
  // ten participants once funneled into whichever lane was furthest
  // pushed). The preference is the brain's (a playbook's lanes) when it
  // states one, else the seat's own (pickLanes: a person's choice at
  // select, a house seat's fill lane), so a stand-in's playbook that
  // states none leaves the seat's choice standing. Recomputed over the
  // team in creation order whenever a champion joins it or a preference
  // is seated, which happens at setup, and when a seat changes hands.
  private assignLanes(team: TeamId): void {
    const seats: Unit[] = [];
    for (const u of this.units.values()) {
      if (u.kind === 'champion' && u.team === team) seats.push(u);
    }
    const lanes = assignLanes(
      seats.map((u) => ({
        home: homeLane(u.championId === null ? null : this.champions.get(u.championId)?.role),
        prefer: u.lanePrefer ?? u.pickedLanes,
      })),
    );
    for (const [i, u] of seats.entries()) u.lane = lanes[i]!;
  }

  championDef(championId: string): ChampionDef | null {
    return this.champions.get(championId);
  }

  // The lane opponents a team's memory names right now (CONTEXT.md): the
  // enemy champion seen the most inside each lane over the last three
  // minutes, null where nobody was seen.
  // Seconds enemies were seen in each lane over the last minute (the
  // additive laneActivity observation field, behind the split push).
  laneActivity(team: TeamId, windowS = LANE_ACTIVITY_WINDOW_S): Readonly<Record<LaneId, number>> {
    return {
      top: this.laneSightings.activity(team, 'top', this.time, windowS),
      mid: this.laneSightings.activity(team, 'mid', this.time, windowS),
      bot: this.laneSightings.activity(team, 'bot', this.time, windowS),
    };
  }

  laneOpponents(team: TeamId): Readonly<Record<LaneId, number | null>> {
    return {
      top: this.laneSightings.opponent(team, 'top', this.time),
      mid: this.laneSightings.opponent(team, 'mid', this.time),
      bot: this.laneSightings.opponent(team, 'bot', this.time),
    };
  }

  attachPolicy(unitId: number, policy: Policy): void {
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion') return;
    this.policies.set(unitId, policy);
  }

  // A seat driven by a playbook (ADR 0013): the same in-tick attachment as
  // attachPolicy, plus the active-play trace, which writes the unit's
  // `play` and emits a 'play' event whenever it changes. The trace never
  // influences a decision, so a traced playbook and a bare one drive the
  // seat identically (tests/playbook.test.ts).
  attachPlaybook(unitId: number, def: PlaybookDef): void {
    this.seatLanes(unitId, def.lanes ?? null);
    this.attachPolicy(unitId, this.policyForPlaybook(def));
  }

  // A seat's lane preference, seated ahead of the home lane (phase 12;
  // the forest first means no lane, ADR 0023): the team's lanes are dealt
  // again with it in. What attachPlaybook does before it attaches; on its
  // own for a policy attached bare that still asks for its seat.
  seatLanes(unitId: number, lanes: readonly LanePreference[] | null): void {
    const seat = this.units.get(unitId);
    if (seat?.kind !== 'champion') return;
    seat.lanePrefer = lanes ? [...lanes] : null;
    this.assignLanes(seat.team);
  }

  // The seat's own lane preference (CONTEXT.md: Lane preference; ADR
  // 0026): a person's choice at champion select, a house seat's fill lane,
  // null for none. Kept apart from the brain's (seatLanes), which goes
  // ahead of it when set; the team's lanes are dealt again with it in, as
  // seatLanes does. Draws nothing from the rng.
  pickLanes(unitId: number, lanes: readonly LanePreference[] | null): void {
    const seat = this.units.get(unitId);
    if (seat?.kind !== 'champion') return;
    seat.pickedLanes = lanes ? [...lanes] : null;
    this.assignLanes(seat.team);
  }

  // The playbook's Policy alone, traced, without the seating attachPlaybook
  // does around it: what a replay re-attaches after a checkpoint restore
  // (src/net/replay.ts, restorePolicies), when the lanes are already where
  // the snapshot put them and dealing them again would move the world. It
  // carries the match's own map, so a bot restored on the Star Orchard
  // keeps reading the Star Orchard's lanes.
  policyForPlaybook(def: PlaybookDef): Policy {
    return playbookPolicy(
      def,
      (playId, id) => {
        const u = this.units.get(id);
        if (!u || u.play === playId) return;
        u.play = playId;
        this.events.push({ type: 'play', unitId: id, playId });
      },
      this.map,
    );
  }

  // Hand a seat to a Policy running outside the process. The sim ships that
  // seat an observation every decision slot and takes one action back; it
  // never learns what produced the action (ADR 0002 phase 2).
  addRemoteSeat(unitId: number): boolean {
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion') return false;
    if (this.remoteSeats.has(unitId)) return true;
    this.remoteSeats.set(unitId, createRemoteSeat(unitId));
    return true;
  }

  removeRemoteSeat(unitId: number): void {
    this.remoteSeats.delete(unitId);
  }

  // Queue the seat's next action. The latest one wins and it is consumed on
  // the seat's next decision slot, so sending more than one per slot buys
  // no extra throughput: the cap is structural, not policed after the fact.
  queueRemoteAction(unitId: number, action: Action): boolean {
    const seat = this.remoteSeats.get(unitId);
    if (!seat) return false;
    seat.pending = action;
    return true;
  }

  // Drain the observation built on the seat's last slot, null when there is
  // nothing new. Draining is what makes the next one arrive.
  takeRemoteObservation(unitId: number): Observation | null {
    const seat = this.remoteSeats.get(unitId);
    if (!seat?.observation) return null;
    const obs = seat.observation;
    seat.observation = null;
    return obs;
  }

  // A reconnected player takes their champion back from the stand-in bot.
  detachPolicy(unitId: number): void {
    this.policies.delete(unitId);
    const u = this.units.get(unitId);
    if (u) u.play = null;
  }

  // A world checkpoint (src/sim/snapshot.ts): every field that moves,
  // as plain data, deep-copied. Policies and champion definitions are not
  // state and are left where they are.
  snapshot(): SimSnapshot {
    return { tick: this.tickCount, state: deepCopy(this.gatherState()) };
  }

  // A short number standing for where this match is, right now: the tick,
  // the rng, and every unit's place and health. It is what a replay
  // checks itself against as it plays (src/net/replay.ts): a replay is a
  // re-simulation, so the one thing it cannot do on its own is notice
  // that it has stopped matching the match it claims to be. Cheap by
  // design (no copy, no allocation per unit) because it runs every
  // couple of hundred ticks inside the sim loop.
  checksum(): number {
    let h = (0x811c9dc5 ^ this.tickCount) >>> 0;
    const mix = (n: number): void => {
      h = (Math.imul(h ^ (n | 0), 0x01000193) + 0x9e3779b9) >>> 0;
    };
    mix(this.rng.state);
    for (const u of this.units.values()) {
      mix(u.id);
      mix(Math.round(u.pos.x * 64));
      mix(Math.round(u.pos.z * 64));
      // A point on the planet carries its third coordinate; the plane's
      // checksum is the one replays already recorded.
      if (u.pos.y !== undefined) mix(Math.round(u.pos.y * 64));
      mix(Math.round(u.hp));
    }
    return h >>> 0;
  }

  // The checkpoint back into THIS sim, in place: the containers attached
  // policies close over are refilled, never replaced. The snapshot stays
  // intact and can be restored again. The policies themselves are not
  // touched: a match whose seats change hands (a disconnect, a rejoin)
  // puts them back from its record (src/net/replay.ts, restorePolicies).
  restore(snap: SimSnapshot): void {
    const s = deepCopy(snap.state) as ReturnType<Sim['gatherState']>;
    this.time = s.time;
    this.tickCount = s.tickCount;
    this.winner = s.winner;
    this.nextWaveAt = s.nextWaveAt;
    this.waveCount = s.waveCount;
    this.nextId = s.nextId;
    this.rng.state = s.rng;
    this.ground.restoreBlockers(s.nav);
    thawUnits(this.units, s.units, this.champions);
    refillMap(this.projectiles, s.projectiles);
    refillMap(this.zones, s.zones);
    refillMap(this.walls, s.walls);
    this.visibility = s.visibility;
    for (const [team, memory] of this.lastSeen.entries()) {
      refillMap(memory, s.lastSeen[team] ?? new Map());
    }
    refillSet(this.dead, s.dead);
    refillMap(this.killers, s.killers);
    this.teamBuffs.restore(s.teamBuffs);
    Object.assign(this.objectives, s.objectives);
    this.campStates.splice(0, this.campStates.length, ...s.campStates);
    this.ringStates.splice(0, this.ringStates.length, ...s.ringStates);
    this.favors.restore(s.favors);
    this.laneSightings.restore(s.laneSightings);
    if (this.royaleMode && s.royale) this.royaleMode.restore(s.royale);
    this.events = [];
  }

  // Every field that moves, gathered by reference; snapshot() deep-copies
  // the lot, so nothing here aliases past the copy.
  private gatherState() {
    return {
      time: this.time,
      tickCount: this.tickCount,
      winner: this.winner,
      nextWaveAt: this.nextWaveAt,
      waveCount: this.waveCount,
      nextId: this.nextId,
      rng: this.rng.state,
      nav: this.ground.snapshotBlockers(),
      units: freezeUnits(this.units),
      projectiles: new Map(this.projectiles),
      zones: new Map(this.zones),
      walls: new Map(this.walls),
      visibility: this.visibility,
      lastSeen: this.lastSeen,
      dead: new Set(this.dead),
      killers: new Map(this.killers),
      teamBuffs: this.teamBuffs.snapshot(),
      objectives: { ...this.objectives },
      campStates: this.campStates.map((c) => ({ ...c })),
      ringStates: this.ringStates.map((r) => ({ ...r })),
      favors: this.favors.snapshot(),
      laneSightings: this.laneSightings.snapshot(),
      royale: this.royaleMode ? this.royaleMode.snapshot() : null,
    };
  }

  // One row per champion; position-free, so it crosses the fog safely.
  scoreboard(): readonly ScoreRow[] {
    const rows: ScoreRow[] = [];
    for (const u of this.units.values()) {
      if (u.kind !== 'champion' || u.championId === null) continue;
      const def = u.champion;
      rows.push({
        unitId: u.id,
        name: def ? (def.name.split(',')[0] ?? def.name) : u.championId,
        championId: u.championId,
        // Seat identity lives above the sim; the server fills it in.
        player: null,
        team: u.team,
        level: u.level,
        kills: u.kills,
        deaths: u.deaths,
        assists: u.assists,
        cs: u.cs,
        items: [...u.items],
      });
    }
    return rows;
  }

  // True when any alive friendly unit has the point in sight range with no
  // wall in between (blinds shrink the radius). Fog-scopes projectiles and
  // zones on the wire AND in Policy observations: one rule, both consumers.
  // A point on the planet carries y.
  isPointVisible(team: TeamId, x: number, z: number, y?: number): boolean {
    const p = point(x, z, y);
    for (const u of this.units.values()) {
      if (u.team !== team || u.neutral || u.dead) continue;
      if (dist(u.pos, p) > u.sightRange * sightFactor(u, this.time)) continue;
      if (sightBlocked(this.map, u.pos, p)) continue;
      return true;
    }
    return false;
  }

  isVisible(team: TeamId, unitId: number): boolean {
    const u = this.units.get(unitId);
    if (!u) return false;
    // Your own team always sees its units, DEAD INCLUDED: review finding
    // F.1/F.3, a dead champion vanishing from its own snapshot froze the
    // online HUD and killed the death screen. Neutral units carry a nominal
    // team and never qualify: camps sit in the fog for everyone.
    if (!u.neutral && u.team === team) return true;
    if (u.dead) return false;
    // Structures are always revealed, like the genre; so are the Warden
    // and a ring's creature (both teams watch them rise and fall, that IS
    // the drama). The creatures sat in the fog like camps for a while (the
    // forest round, ADR 0023); the Pyrefang's rise was then a show nobody
    // could see, so they stand revealed again. Camps stay in the fog.
    if (
      u.kind === 'tower' ||
      u.kind === 'sanctum' ||
      u.kind === 'warden' ||
      u.kind === 'creature'
    ) {
      return true;
    }
    return this.visibility[team]?.has(unitId) ?? false;
  }

  // The Warden's Boon state for a team, null when inactive (IWorld).
  // When the team's Wrath ends (CONTEXT.md), null when it holds none.
  teamWrath(team: TeamId): number | null {
    return this.teamBuffs.wrathUntil(team, this.time);
  }

  // Hands a team the Wrath by hand (a test, a practice drill); a match
  // grants it through an Ascendant's death.
  grantWrath(team: TeamId): void {
    this.teamBuffs.grantWrath(team, this.time);
  }

  teamBuff(team: TeamId): { until: number; stacks: number } | null {
    return this.teamBuffs.boon(team, this.time);
  }

  // When the next Warden rises; null while one is alive (IWorld).
  objectiveSpawnAt(): number | null {
    return this.objectives.wardenId === null ? this.objectives.nextSpawnAt : null;
  }

  // The live Warden's pit (IWorld); null while none stands. The next pit
  // is drawn at the death and told to nobody until the rise: where the
  // Warden appears is not on the map before it does (ADR 0023).
  wardenPit(): WardenPit | null {
    return this.objectives.wardenId === null ? null : wardenPitOf(this.map, this.objectives);
  }

  // The camps as a team knows them (the observation, ADR 0023): every
  // spot, its kind, and the team's own memory of it.
  campsFor(team: TeamId): ObsCamp[] {
    return this.campStates.map((state) => {
      const seen = state.seen[team] ?? null;
      return {
        x: state.spot.x,
        z: state.spot.z,
        ...(state.spot.y !== undefined ? { y: state.spot.y } : {}),
        kind: state.spot.kind,
        seenAt: seen ? seen.at : null,
        up: seen ? seen.up : null,
        downSince: seen ? seen.downSince : null,
      };
    });
  }

  // The rings' clocks (IWorld): the live creature or the next rise, and
  // the aspect in play, per ring. Empty on a map without rings.
  ringClocks(): readonly RingClock[] {
    return ringClocks(this.ringStates);
  }

  // The favors a team holds (IWorld), a frozen copy.
  teamFavors(team: TeamId) {
    return this.favors.stacks(team);
  }

  // One more stack of an aspect for a team (CONTEXT.md: Favor): the team
  // record moves, every champion of the team mirrors it and has its stats
  // recomputed, dead ones included since the favor outlives a death. The
  // door the death handling uses, and tests.
  grantFavor(team: TeamId, aspect: AspectId): void {
    this.favors.grant(team, aspect);
    const stacks = this.favors.stacks(team);
    for (const u of this.units.values()) {
      if (u.kind !== 'champion' || u.team !== team) continue;
      u.favors = stacks;
      recalcChampion(u);
    }
  }

  // An order's point is the plane's (x, z), or on the planet the sphere
  // point with y.
  orderMove(unitId: number, x: number, z: number, y?: number): void {
    if (this.winner !== null || !this.royaleActs(unitId)) return;
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0 || u.dead || this.dead.has(unitId)) return;
    cancelRecall(u);
    u.holding = false;
    u.attackTargetId = null;
    u.attackMoveTarget = null;
    u.path = this.ground.findPath(u.pos, point(x, z, y));
  }

  // Stop (S): halt in place and HOLD, opting out of idle auto-defense until
  // the next movement or attack order. The genre's wave-freeze verb.
  orderStop(unitId: number): void {
    if (this.winner !== null || !this.royaleActs(unitId)) return;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion' || u.dead || this.dead.has(unitId)) return;
    u.holding = true;
    u.path = [];
    u.attackTargetId = null;
    u.attackMoveTarget = null;
    if (this.royaleMode) keepHold(this.royaleMode, unitId);
  }

  // The owner's coach order for a bot seat (ADR 0013): sim state like any
  // order, so it records and replays; null releases it.
  setCoachOrder(unitId: number, order: CoachOrder | null): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion') return;
    u.coachOrder = order;
    u.coachOrderSeenAt = this.time;
  }

  // System-driven pathing (attack-move) that does not clear the standing
  // intent the way a player move order does.
  orderPath(unitId: number, x: number, z: number, y?: number): void {
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0 || u.dead) return;
    u.path = this.ground.findPath(u.pos, point(x, z, y));
  }

  orderAttack(unitId: number, targetId: number): void {
    if (this.winner !== null || !this.royaleActs(unitId)) return;
    const u = this.units.get(unitId);
    const target = this.units.get(targetId);
    if (!u || !target || u.dead || target.dead) return;
    if (this.dead.has(unitId) || this.dead.has(targetId)) return;
    if (!hostile(u, target)) return;
    cancelRecall(u);
    u.holding = false;
    u.attackMoveTarget = null;
    u.attackTargetId = targetId;
    this.royaleMode?.noteAct(unitId, this.time);
  }

  orderAttackMove(unitId: number, x: number, z: number, y?: number): void {
    if (this.winner !== null || !this.royaleActs(unitId)) return;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion' || u.dead || this.dead.has(unitId)) return;
    cancelRecall(u);
    u.holding = false;
    u.attackTargetId = null;
    u.attackMoveTarget = point(x, z, y);
    u.path = this.ground.findPath(u.pos, point(x, z, y));
  }

  startRecall(unitId: number): void {
    // No recall in the battle royale: there is no fountain to go home to.
    if (this.winner !== null || this.royaleMode) return;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion' || u.dead || this.dead.has(unitId)) return;
    if (isStunned(u, this.time)) return;
    startRecall(u, this.time);
  }

  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean {
    if (this.winner !== null || !this.royaleActs(unitId)) return false;
    const u = this.units.get(unitId);
    if (!u || u.championId === null || u.dead) return false;
    const def = u.champion?.abilities[key];
    if (!def) return false;
    if (!hasDecisionToken(u, this.time)) return false;
    const ok = castAbility(this.ctx(), u, key, def, aim);
    if (ok) {
      spendDecisionToken(u, this.time);
      cancelRecall(u);
      this.royaleMode?.noteAct(unitId, this.time);
    }
    return ok;
  }

  // Starts a champion past level 1 (a Forge test drive opens at the
  // ultimate's level so R is on the table): the xp curve is walked, so
  // skill points and stat growth land exactly as a match grants them.
  setLevel(unitId: number, level: number): void {
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion') return;
    levelTo(u, level);
  }

  // Spends one skill point to rank up an ability. Basics cap at rank 5; R
  // caps at 3 with champion-level gates 6/11/16. Free action (no decision
  // token): it is meta-progression, not an in-world act.
  levelAbility(unitId: number, key: AbilityKey): boolean {
    // The battle royale ranks every spell itself (royale/levels.ts).
    if (this.winner !== null || this.royaleMode) return false;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion' || u.championId === null) return false;
    if (u.skillPoints <= 0) return false;
    const rank = effectiveRank(u, key);
    if (key === 'R') {
      if (rank >= ULT_MAX_RANK) return false;
      if (u.level < (ULT_RANK_LEVELS[rank] ?? Number.POSITIVE_INFINITY)) return false;
    } else if (rank >= BASIC_MAX_RANK) {
      return false;
    }
    u.abilityRanks[key] = rank + 1;
    u.skillPoints -= 1;
    return true;
  }

  // A champion's sigils and skin as a person who took its seat chose them
  // (a battle royale's drop-in, server/royale_match.ts): the two sigils
  // ready, the skin clamped to the champion's; unknown sigils are left as
  // they were.
  setLoadout(unitId: number, sigils: readonly string[], skin: number): void {
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion') return;
    const [a, b] = sigils;
    if (sigils.length === 2 && a !== b && a && b && SIGILS[a] && SIGILS[b]) {
      u.sigils = [a, b];
      u.sigilCooldowns = [0, 0];
    }
    if (u.championId) u.skin = clampSkin(u.championId, skin);
  }

  castSigil(unitId: number, slot: number, aim: Vec2): boolean {
    if (this.winner !== null || !this.royaleActs(unitId)) return false;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion' || u.dead || this.dead.has(unitId)) return false;
    if (isStunned(u, this.time)) return false;
    const sigilId = u.sigils[slot];
    const def = sigilId ? SIGILS[sigilId] : undefined;
    if (!def) return false;
    if (def.spec.kind === 'dash' && isRooted(u, this.time)) return false;
    if ((u.sigilCooldowns[slot] ?? 0) > this.time) return false;
    if (!hasDecisionToken(u, this.time)) return false;
    const ok = executeCast(
      this.ctx(),
      u,
      def.spec,
      def.castRange,
      aim,
      { ad: u.stats.ad, ap: u.stats.ap },
      `sigil_${sigilId}`,
    );
    if (!ok) return false;
    spendDecisionToken(u, this.time);
    cancelRecall(u);
    this.royaleMode?.noteAct(unitId, this.time);
    u.sigilCooldowns[slot] = this.time + def.cooldown;
    breakStealth(u);
    this.events.push({ type: 'sigil', unitId, slot });
    return true;
  }

  buyItem(unitId: number, itemId: string): boolean {
    // No shop in the battle royale: loot is the build (royale/loot.ts).
    if (this.winner !== null || this.royaleMode) return false;
    const u = this.units.get(unitId);
    const def = ITEMS[itemId];
    if (!u || !def || u.kind !== 'champion') return false;
    // Death is shopping time, like the genre: a corpse respawns at its own
    // fountain, so the range check is waived while it waits. Selling still
    // wants a live champion standing there.
    if (def.drink && !mayCarryDraught(u.items)) return false;
    const dead = u.dead || this.dead.has(unitId);
    if (!dead && !withinFountain(this.map, u.team, u.pos)) return false;

    // Consume owned components (one instance each) and discount their cost.
    const consumedIndices: number[] = [];
    let discount = 0;
    for (const compId of def.buildsFrom ?? []) {
      const idx = u.items.findIndex((it, i) => it === compId && !consumedIndices.includes(i));
      if (idx !== -1) {
        consumedIndices.push(idx);
        discount += ITEMS[compId]?.cost ?? 0;
      }
    }
    const cost = Math.max(0, def.cost - discount);
    if (u.gold < cost) return false;
    if (u.items.length - consumedIndices.length >= INVENTORY_SLOTS) return false;

    u.gold -= cost;
    u.items = u.items.filter((_, i) => !consumedIndices.includes(i));
    u.items.push(itemId);
    recalcChampion(u);
    return true;
  }

  // Sells the item in `slot` for 70 percent of its own price, fountain
  // only (player review: one misclick should not be gold gone forever).
  sellItem(unitId: number, slot: number): boolean {
    if (this.winner !== null || this.royaleMode) return false;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion' || u.dead || this.dead.has(unitId)) return false;
    if (!withinFountain(this.map, u.team, u.pos)) return false;
    const itemId = u.items[slot];
    if (itemId === undefined) return false;
    const def = ITEMS[itemId];
    if (!def) return false;
    u.items = u.items.filter((_, i) => i !== slot);
    u.gold += Math.floor(def.cost * 0.7);
    recalcChampion(u);
    return true;
  }

  // Drinks the Sapdraught in `slot` (draught.ts), anywhere, alive. Free
  // like a sale: no decision token, and not an order, so a recall channel
  // carries on.
  drinkItem(unitId: number, slot: number): boolean {
    if (this.winner !== null || this.royaleMode) return false;
    const u = this.units.get(unitId);
    if (u?.kind !== 'champion' || u.dead || this.dead.has(unitId)) return false;
    return startDraught(u, slot, this.time);
  }

  // Where a dead champion comes back, null to keep it dead for now: the
  // mode's point when it decides (SimOptions.respawnPoint), else its own
  // fountain, slotted by teammate order so two teammates can never share
  // an exact respawn coordinate; a team without a fountain stays down.
  private respawnSpot(u: Unit): Vec2 | null {
    if (this.royaleMode) return this.royaleMode.respawnPoint(u, this);
    if (this.options.respawnPoint) {
      const at = this.options.respawnPoint(u, this);
      return at ? { ...at } : null;
    }
    const fountain = this.map.fountains.find((f) => f.team === u.team);
    if (!fountain) return null;
    let teammateIndex = 0;
    for (const o of this.units.values()) {
      if (o.kind === 'champion' && o.team === u.team && o.id < u.id) teammateIndex++;
    }
    const slot = SPAWN_SLOTS[teammateIndex % SPAWN_SLOTS.length]!;
    const pos = fountainSeat(fountain, slot);
    if (!this.options.strictNavigation) return pos;
    return this.nav.nearestWalkable(pos.x, pos.z) ?? { x: fountain.x, z: fountain.z };
  }

  // The battle royale's drop: nothing stands on the ground yet, so only the
  // seats decide (their landing picks) until everyone lands together.
  private tickDrop(royale: RoyaleMode): SimEvent[] {
    runBotDecisions(this, this.policies);
    runRemoteDecisions(this, this.remoteSeats);
    this.time += DT;
    this.tickCount += 1;
    royale.stepDrop(this);
    const out = this.events;
    this.events = [];
    return out;
  }

  tick(): SimEvent[] {
    const royale = this.royaleMode;
    if (royale && royale.state.stage === 'drop') return this.tickDrop(royale);
    const ctx = this.ctx();
    royale?.beforeTick(this);

    stepRecalls(ctx, this.map);
    // Shield detonations must fire before generic expiry prunes them.
    stepShieldBursts(ctx);
    for (const u of this.units.values()) expireStatuses(u, this.time);
    stepWalls(ctx);

    stepDots(ctx);
    stepDraughts(ctx);
    if (this.winner === null && !royale) grantPassiveGold(ctx);
    const tideTick = this.tickCount % (TIDE_PERIOD_S * TICK_RATE) === 0;
    for (const u of this.units.values()) {
      if (u.dead) continue;
      if (u.stats.hpRegen > 0) u.hp = Math.min(u.maxHp, u.hp + u.stats.hpRegen * DT);
      if (u.stats.manaRegen > 0) u.mana = Math.min(u.maxMana, u.mana + u.stats.manaRegen * DT);
      // The Tide (CONTEXT.md: Favor): a share of the missing health back
      // every five seconds, for the team that holds it.
      if (tideTick && u.kind === 'champion' && u.favors.tide > 0) {
        u.hp = Math.min(u.maxHp, u.hp + (u.maxHp - u.hp) * favorBonus(u.favors, 'tide'));
      }
    }
    if (this.twoTeams()) applyFountainRegen(ctx, this.map);
    stepPassives(ctx, this.tickCount);
    for (const u of this.units.values()) {
      if (u.coachOrder) stepCoachOrder(this, u);
    }

    runBotDecisions(this, this.policies);
    runRemoteDecisions(this, this.remoteSeats);

    // A map without lanes sends no waves, and one without pits raises no
    // Warden: the planet's creatures are its own mode's (ADR 0031).
    if (this.twoTeams() && this.winner === null && this.hasLanes && this.time >= this.nextWaveAt) {
      spawnWave(ctx, this.map, this.waveCount++, this.options.strictNavigation);
      this.nextWaveAt += WAVE_EVERY;
    }
    if (this.winner === null) {
      if (this.map.wardenPits.length > 0) stepObjectives(ctx, this.map, this.objectives);
      stepRings(ctx, this.ringStates);
      stepCamps(ctx, this.campStates);
    }

    stepMinionAi(ctx, this.nav, this.map, this.tickCount);
    stepTowerAi(ctx);
    stepAttackMove(this);
    stepIdleDefense(this);
    stepWindups(ctx);
    stepAutoAttacks(ctx);
    stepDashes(ctx, DT);

    for (const u of this.units.values()) {
      if (u.path.length === 0 || u.dead || this.dead.has(u.id)) continue;
      // Winding up a cast plants the caster; a dash in flight owns the body.
      if (u.pendingSpell || u.activeDash) continue;
      const speed = effectiveMoveSpeed(u, this.time);
      if (speed > 0) {
        // Stale paths can cross a wall raised after they were computed;
        // clamp the step at the wall face instead of walking through.
        if (this.walls.size > 0 || this.options.strictNavigation) {
          const from = copy(u.pos);
          stepMovement(u, DT, speed);
          clampThroughWalls(this.ground, from, u);
          if (this.options.strictNavigation && !this.ground.lineOfWalk(from, u.pos)) {
            u.pos = from;
            u.path = [];
          }
        } else {
          stepMovement(u, DT, speed);
        }
      }
    }

    royale?.stepPads(this);
    stepSeparation(ctx, this.options.separation ?? MINIONS_ONLY);
    stepProjectiles(ctx, DT);
    stepZones(ctx);
    if (royale && this.winner === null) {
      royale.stepRecovery(ctx);
      royale.stepDusk(ctx, this);
      royale.stepSeedfallImpact(ctx, this);
    }

    for (const id of this.dead) {
      const u = this.units.get(id);
      if (!u) continue;
      const killerId = this.killers.get(id) ?? 0;
      if (royale) {
        // Everything to the last hit (royale/mode.ts); a camp spot's last
        // body pays the piece.
        const spot = u.kind === 'camp' ? this.campStates.find((c) => c.unitIds.includes(id)) : null;
        royale.onDeath(this, u, killerId, spot ? spot.unitIds.length === 1 : false);
      } else {
        grantKillRewards(ctx, u, killerId);
      }
      if (u.kind === 'champion') {
        const killer = this.units.get(killerId);
        if (killer && killer.kind === 'champion' && killer.team !== u.team) {
          killer.kills += 1;
          killer.killStreak += 1;
          passiveOf(killer)?.onTakedown?.(ctx, killer, u);
          if (killer.grafts.length > 0) runGraftTakedown(ctx, killer, u);
        }
        // Assists: every enemy champion that damaged the victim within the
        // window, killer excluded. Dead helpers still earn theirs, and the
        // helpers split an assist pot so a won team fight pays the team,
        // not only the last hitter.
        const assisters: Unit[] = [];
        for (const r of u.recentDamagers) {
          if (r.id === killerId) continue;
          if (this.time - r.at > ASSIST_WINDOW_S) continue;
          const helper = this.units.get(r.id);
          if (helper && helper.kind === 'champion' && helper.team !== u.team) {
            assisters.push(helper);
          }
        }
        const assistGold =
          assisters.length > 0
            ? Math.floor((championBounty(u) * ASSIST_GOLD_FRAC) / assisters.length)
            : 0;
        for (const helper of assisters) {
          helper.assists += 1;
          helper.gold += assistGold;
          this.events.push({ type: 'gold', unitId: helper.id, amount: assistGold });
          passiveOf(helper)?.onTakedown?.(ctx, helper, u);
        }
        u.recentDamagers = [];
        u.killStreak = 0;
        u.deaths += 1;
        u.dead = true;
        u.hp = 0;
        const delay = this.options.respawnDelay;
        u.respawnAt =
          this.time +
          (royale
            ? royale.respawnDelay()
            : delay
              ? delay(u, this)
              : respawnDelay(u.level, this.time));
        u.path = [];
        u.attackTargetId = null;
        u.statuses = [];
      } else {
        // Creep score: a minion last-hit by an enemy champion.
        if (u.kind === 'minion') {
          const killer = this.units.get(killerId);
          if (killer && killer.kind === 'champion' && killer.team !== u.team) killer.cs += 1;
        }
        // The Warden falls: the killing team claims the Boon and the
        // respawn clock starts. On the planet its last hit carries the
        // Wrath instead (royale/risings.ts), and it never rises again.
        if (u.kind === 'warden') {
          const killer = this.units.get(killerId);
          if (killer && killer.kind === 'champion') {
            if (royale) royale.grantWrath(this, killer);
            else this.teamBuffs.grantBoon(killer.team, this.time);
          }
          onWardenSlain(this.objectives, this.time, this.rng, this.map.wardenPits.length);
        }
        if (u.kind === 'camp') {
          const spot = this.campStates.find((c) => c.unitIds.includes(id));
          onCampSlain(this.campStates, id, this.units.get(killerId), this.time);
          // The mode's camps come back on its own clock, whatever the kind.
          if (royale && spot && spot.unitIds.length === 0) {
            spot.nextSpawnAt = royale.campBackAt(this.time);
          }
        }
        // A ring's creature falls: its aspect becomes the killing team's
        // favor (the Wrath when it was the Ascendant), every member of
        // that team is paid, and the ring's clock restarts. A creature
        // nobody's champion killed pays nobody.
        if (u.kind === 'creature') {
          const fall = onCreatureSlain(this.ringStates, id, this.time);
          const killer = this.units.get(killerId);
          if (fall !== null && killer && killer.kind === 'champion') {
            if (fall.aspect !== null) this.grantFavor(killer.team, fall.aspect);
            else if (royale) royale.grantWrath(this, killer);
            else this.teamBuffs.grantWrath(killer.team, this.time);
            for (const member of this.units.values()) {
              if (member.kind !== 'champion' || member.team !== killer.team) continue;
              member.gold += RING_GOLD_EACH;
              this.events.push({ type: 'gold', unitId: member.id, amount: RING_GOLD_EACH });
            }
            if (fall.aspect !== null) {
              this.events.push({
                type: 'favor',
                team: killer.team,
                aspect: fall.aspect,
                creature: fall.creature,
              });
            } else {
              this.events.push({ type: 'wrath', team: killer.team, creature: fall.creature });
            }
          }
        }
        if (u.moveSpeed <= 0) this.ground.unblockCircle(u.pos, staticFootprint(u));
        this.units.delete(id);
        if (u.kind === 'sanctum' && this.winner === null) {
          this.winner = otherTeam(u.team);
          this.events.push({ type: 'victory', team: this.winner });
        }
      }
    }
    this.dead.clear();
    this.killers.clear();
    if (royale && royale.state.stage === 'play') {
      royale.stepAfterDeaths(this);
      if (royale.isOver() && this.winner === null) {
        const w = royale.state.winnerId;
        this.winner = w !== null ? (this.units.get(w)?.team ?? null) : null;
      }
    }

    for (const u of this.units.values()) {
      if (this.winner !== null) break;
      if (u.kind !== 'champion' || !u.dead || this.time < u.respawnAt) continue;
      // Cooldowns persist through death (review F.2: dying was a free
      // ultimate refresh).
      const back = this.respawnSpot(u);
      if (!back) continue;
      u.dead = false;
      u.pos = back;
      u.hp = royale ? royale.respawnHealth(u) : u.maxHp;
      u.mana = u.maxMana;
      u.statuses = [];
      // The battle royale's return comes back in its Grace (royale/grace.ts).
      royale?.onRespawn(this, u);
    }

    this.visibility = computeVisibility(
      this.map,
      this.units,
      this.time,
      this.zones,
      this.teamCount,
    );
    noteCampSightings(this.campStates, this.time, (team, x, z, y) =>
      this.isPointVisible(team, x, z, y),
    );

    // Refresh each team's memory of the enemy champions it can see right
    // now; a dead champion is forgotten (its corpse spot means nothing).
    // Every other team remembers; only a two-team match on a map with lanes
    // has lanes to note.
    for (const u of this.units.values()) {
      if (u.kind !== 'champion' || u.neutral) continue;
      for (let observer = 0; observer < this.teamCount; observer++) {
        if (observer === u.team) continue;
        const memory = this.lastSeen[observer]!;
        if (u.dead) {
          memory.delete(u.id);
          continue;
        }
        if (!this.visibility[observer]!.has(u.id)) continue;
        const seen: LastSeenRecord = {
          x: u.pos.x,
          z: u.pos.z,
          at: this.time,
          hpFrac: u.maxHp > 0 ? u.hp / u.maxHp : 0,
        };
        if (u.pos.y !== undefined) seen.y = u.pos.y;
        memory.set(u.id, seen);
        if (!this.twoTeams() || !this.hasLanes) continue;
        const lane = laneOf(u.pos.x, u.pos.z, this.map);
        if (lane) this.laneSightings.record(observer, lane, u.id, this.time, DT);
      }
    }

    // Fairness: a champion's attack order must not keep tracking a target
    // its team cannot see; the blind chase would both leak the unseen
    // position and walk the chaser across the map. Evaluated on the tick's
    // FRESH visibility (a strike already winding up still resolves under
    // its own rules).
    for (const u of this.units.values()) {
      if (u.kind !== 'champion' || u.dead || u.attackTargetId === null) continue;
      const t = this.units.get(u.attackTargetId);
      if (t && !t.dead && !this.isVisible(u.team, t.id)) {
        u.attackTargetId = null;
        // The chase path dies with the order, or the blind walk continues.
        u.path = [];
      }
    }

    this.time += DT;
    this.tickCount += 1;
    const out = this.events;
    this.events = [];
    return out;
  }
}
