// The sim coordinator. Stays thin: systems live in sibling modules driven
// through CombatCtx, and the tick calls them in a FIXED order (the order is
// load-bearing for determinism):
//   statuses -> income and regen -> waves -> minion AI -> tower AI ->
//   auto-attacks -> movement -> projectiles -> zones -> deaths -> respawns ->
//   vision -> clock.

import { stepAttackMove } from './attack_move';
import { runBotDecisions } from './bot_driver';
import { initialCampStates, onCampSlain, stepCamps } from './camps';
import { ChampionRegistry } from './champion_registry';
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
import { type ChampionDef, DEFAULT_CHAMPION_ID } from './content/champions';
import { ITEMS } from './content/items';
import { GAME_MAP, type GameMap, type LaneId } from './content/map';
import { SIGILS } from './content/sigils';
import { clampSkin } from './content/skins';
import { stepDashes } from './dashes';
import { hasDecisionToken, spendDecisionToken } from './decision_budget';
import type { ForgedChampionDef } from './forge/forged_def';
import { applyFountainRegen } from './fountain';
import { stepIdleDefense } from './idle_defense';
import { createMapUnits } from './map_units';
import { stepMinionAi } from './minion_ai';
import { stepMovement } from './movement';
import { NavGrid } from './navgrid';
import { initialObjectiveState, onWardenSlain, stepObjectives } from './objectives';
import { passiveOf, stepPassives } from './passives';
import { findPath } from './pathfind';
import type { Action, Observation, Policy } from './policy';
import type { Projectile } from './projectiles';
import { stepProjectiles } from './projectiles';
import { startRecall, stepRecalls } from './recall';
import { createRemoteSeat, type RemoteSeat, runRemoteDecisions } from './remote_policy';
import { respawnDelay } from './respawn';
import { ASSIST_GOLD_FRAC, championBounty, grantKillRewards, grantPassiveGold } from './rewards';
import { Rng } from './rng';
import { stepSeparation } from './separation';
import type { CombatCtx } from './sim_context';
import {
  BASIC_MAX_RANK,
  effectiveRank,
  levelTo,
  recalcChampion,
  ULT_MAX_RANK,
  ULT_RANK_LEVELS,
} from './stats';
import { TeamBuffs } from './team_buffs';
import { stepTowerAi } from './tower_ai';
import {
  type AbilityKey,
  type DamageType,
  DT,
  type ScoreRow,
  type TeamId,
  type Vec2,
} from './types';
import { createChampion, hostile, staticFootprint, type Unit } from './unit';
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
  | { type: 'victory'; team: TeamId };

// How long a champion's damage on a victim keeps earning an assist.
const ASSIST_WINDOW_S = 10;
const SHOP_RANGE_PAD = 2;
// Exported: the HUD draws exactly this many build slots, so a full bag and
// an empty one read as the same shape.
export const INVENTORY_SLOTS = 6;

// Bot lane assignment order for a five-seat team: one mid, two top, two
// bot. The old three-entry cycle wrapped to mid,top,bot,mid,top: every team
// permanently ran a duo mid, a duo top, and one abandoned solo bot lane.
const BOT_LANES: readonly LaneId[] = ['mid', 'top', 'bot', 'top', 'bot'];

// Deterministic spawn offsets around the fountain center, by join order.
const SPAWN_SLOTS: readonly { x: number; z: number }[] = [
  { x: 0, z: 0 },
  { x: 1.6, z: 0 },
  { x: 0, z: 1.6 },
  { x: -1.6, z: 0 },
  { x: 0, z: -1.6 },
];

export class Sim {
  readonly rng: Rng;
  readonly map: GameMap = GAME_MAP;
  readonly nav: NavGrid;
  // Match-scoped champion resolution: the roster plus this match's forged
  // definitions (plan-forge phase 2). Register forged champions BEFORE
  // adding their units; the registration order is part of match identity.
  readonly champions = new ChampionRegistry();
  readonly units = new Map<number, Unit>();
  readonly projectiles = new Map<number, Projectile>();
  readonly zones = new Map<number, Zone>();
  readonly walls = new Map<number, Wall>();
  // Bots: sim entities driven in-tick by an attached Policy (ADR 0002).
  readonly policies = new Map<number, Policy>();
  // Seats whose Policy runs outside this process (remote_policy.ts).
  readonly remoteSeats = new Map<number, RemoteSeat>();
  time = 0;
  tickCount = 0;
  winner: TeamId | null = null;
  private visibility: [Set<number>, Set<number>] = [new Set(), new Set()];
  // Each team's fading memory of enemy champions: where one was last SEEN
  // and how hurt it was. The honest mirror of a human remembering who ran
  // into which brush; observe.ts exposes only fresh, currently-unseen
  // entries (additive obs v0). Indexed by observing team, keyed by unit id.
  readonly lastSeen: [
    Map<number, { x: number; z: number; at: number; hpFrac: number }>,
    Map<number, { x: number; z: number; at: number; hpFrac: number }>,
  ] = [new Map(), new Map()];
  private nextWaveAt = FIRST_WAVE_AT;
  private waveCount = 0;
  private nextId = 1;
  private events: SimEvent[] = [];
  private readonly dead = new Set<number>();
  private readonly killers = new Map<number, number>();
  // The Warden's Boon lives outside units so it survives deaths.
  readonly teamBuffs = new TeamBuffs();
  // Public like teamBuffs: tests rewind the spawn clock instead of ticking
  // ten sim-minutes to meet the first Warden.
  readonly objectives = initialObjectiveState();
  private readonly campStates = initialCampStates(GAME_MAP);

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.nav = new NavGrid(this.map.size, this.map.walls, this.map.borderMargin);
    for (const u of createMapUnits(this.map, () => this.nextId++)) {
      this.units.set(u.id, u);
      this.nav.blockCircle(u.pos.x, u.pos.z, staticFootprint(u));
    }
    this.visibility = computeVisibility(this.map, this.units, 0);
  }

  private ctx(): CombatCtx {
    return {
      time: this.time,
      rng: this.rng,
      nav: this.nav,
      units: this.units,
      projectiles: this.projectiles,
      zones: this.zones,
      walls: this.walls,
      events: this.events,
      dead: this.dead,
      killers: this.killers,
      teamBuffs: this.teamBuffs,
      allocId: () => this.nextId++,
    };
  }

  // Register a forged champion for this match; its id becomes pickable by
  // addChampion. Validation happens inside the registry (throws on an
  // invalid or duplicate def).
  addForgedChampion(def: ForgedChampionDef): void {
    this.champions.addForged(def);
  }

  addChampion(team: TeamId, at?: Vec2, championId: string = DEFAULT_CHAMPION_ID, skin = 0): Unit {
    const def = this.champions.get(championId);
    if (!def) throw new Error(`unknown champion ${championId}`);
    const fountain = this.map.fountains.find((f) => f.team === team);
    if (!fountain) throw new Error(`no fountain for team ${team}`);
    let count = 0;
    for (const u of this.units.values()) {
      if (u.kind === 'champion' && u.team === team) count++;
    }
    const slot = SPAWN_SLOTS[count % SPAWN_SLOTS.length]!;
    const pos = at ?? { x: fountain.x + slot.x, z: fountain.z + slot.z };
    const champ = createChampion(this.nextId++, team, pos, def);
    champ.skin = clampSkin(championId, skin);
    this.units.set(champ.id, champ);
    return champ;
  }

  championDef(championId: string): ChampionDef | null {
    return this.champions.get(championId);
  }

  // Assign a lane round-robin per team (playtest review: all ten
  // participants used to funnel into whichever lane was furthest pushed).
  // Counts scripted and remote seats together: a lane is a lane whoever
  // holds it, and counting only one kind stacked mixed teams into one lane.
  private assignBotLane(unit: Unit): void {
    let held = 0;
    for (const id of this.policies.keys()) {
      if (this.units.get(id)?.team === unit.team) held++;
    }
    for (const id of this.remoteSeats.keys()) {
      if (this.units.get(id)?.team === unit.team) held++;
    }
    unit.lane = BOT_LANES[held % BOT_LANES.length]!;
  }

  attachPolicy(unitId: number, policy: Policy): void {
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion') return;
    this.assignBotLane(u);
    this.policies.set(unitId, policy);
  }

  // Hand a seat to a Policy running outside the process. The sim ships that
  // seat an observation every decision slot and takes one action back; it
  // never learns what produced the action (ADR 0002 phase 2).
  addRemoteSeat(unitId: number): boolean {
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion') return false;
    if (this.remoteSeats.has(unitId)) return true;
    this.assignBotLane(u);
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
    if (!seat || !seat.observation) return null;
    const obs = seat.observation;
    seat.observation = null;
    return obs;
  }

  // A reconnected player takes their champion back from the stand-in bot.
  detachPolicy(unitId: number): void {
    this.policies.delete(unitId);
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
  isPointVisible(team: TeamId, x: number, z: number): boolean {
    for (const u of this.units.values()) {
      if (u.team !== team || u.neutral || u.dead) continue;
      if (Math.hypot(u.pos.x - x, u.pos.z - z) > u.sightRange * sightFactor(u, this.time)) {
        continue;
      }
      if (sightBlocked(this.map, u.pos, { x, z })) continue;
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
    // Structures are always revealed, like the genre; so is the Warden
    // (both teams watch its health bar, that IS the drama).
    if (u.kind === 'tower' || u.kind === 'sanctum' || u.kind === 'warden') return true;
    return this.visibility[team].has(unitId);
  }

  // The Warden's Boon state for a team, null when inactive (IWorld).
  teamBuff(team: TeamId): { until: number; stacks: number } | null {
    return this.teamBuffs.boon(team, this.time);
  }

  // When the next Warden rises; null while one is alive (IWorld).
  objectiveSpawnAt(): number | null {
    return this.objectives.wardenId === null ? this.objectives.nextSpawnAt : null;
  }

  orderMove(unitId: number, x: number, z: number): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0 || u.dead || this.dead.has(unitId)) return;
    cancelRecall(u);
    u.holding = false;
    u.attackTargetId = null;
    u.attackMoveTarget = null;
    u.path = findPath(this.nav, u.pos, { x, z });
  }

  // Stop (S): halt in place and HOLD, opting out of idle auto-defense until
  // the next movement or attack order. The genre's wave-freeze verb.
  orderStop(unitId: number): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.dead || this.dead.has(unitId)) return;
    u.holding = true;
    u.path = [];
    u.attackTargetId = null;
    u.attackMoveTarget = null;
  }

  // System-driven pathing (attack-move) that does not clear the standing
  // intent the way a player move order does.
  orderPath(unitId: number, x: number, z: number): void {
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0 || u.dead) return;
    u.path = findPath(this.nav, u.pos, { x, z });
  }

  orderAttack(unitId: number, targetId: number): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    const target = this.units.get(targetId);
    if (!u || !target || u.dead || target.dead) return;
    if (this.dead.has(unitId) || this.dead.has(targetId)) return;
    if (!hostile(u, target)) return;
    cancelRecall(u);
    u.holding = false;
    u.attackMoveTarget = null;
    u.attackTargetId = targetId;
  }

  orderAttackMove(unitId: number, x: number, z: number): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.dead || this.dead.has(unitId)) return;
    cancelRecall(u);
    u.holding = false;
    u.attackTargetId = null;
    u.attackMoveTarget = { x, z };
    u.path = findPath(this.nav, u.pos, { x, z });
  }

  startRecall(unitId: number): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.dead || this.dead.has(unitId)) return;
    if (isStunned(u, this.time)) return;
    startRecall(u, this.time);
  }

  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean {
    if (this.winner !== null) return false;
    const u = this.units.get(unitId);
    if (!u || u.championId === null || u.dead) return false;
    const def = u.champion?.abilities[key];
    if (!def) return false;
    if (!hasDecisionToken(u, this.time)) return false;
    const ok = castAbility(this.ctx(), u, key, def, aim);
    if (ok) {
      spendDecisionToken(u, this.time);
      cancelRecall(u);
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
    if (this.winner !== null) return false;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.championId === null) return false;
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

  castSigil(unitId: number, slot: number, aim: Vec2): boolean {
    if (this.winner !== null) return false;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.dead || this.dead.has(unitId)) return false;
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
    u.sigilCooldowns[slot] = this.time + def.cooldown;
    breakStealth(u);
    this.events.push({ type: 'sigil', unitId, slot });
    return true;
  }

  buyItem(unitId: number, itemId: string): boolean {
    if (this.winner !== null) return false;
    const u = this.units.get(unitId);
    const def = ITEMS[itemId];
    if (!u || !def || u.kind !== 'champion') return false;
    const fountain = this.map.fountains.find((f) => f.team === u.team);
    if (!fountain) return false;
    // Death is shopping time, like the genre: a corpse respawns at its own
    // fountain, so the range check is waived while it waits. Selling still
    // wants a live champion standing there.
    const dead = u.dead || this.dead.has(unitId);
    const d = Math.hypot(u.pos.x - fountain.x, u.pos.z - fountain.z);
    if (!dead && d > fountain.r + SHOP_RANGE_PAD) return false;

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
    if (this.winner !== null) return false;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.dead || this.dead.has(unitId)) return false;
    const fountain = this.map.fountains.find((f) => f.team === u.team);
    if (!fountain) return false;
    if (Math.hypot(u.pos.x - fountain.x, u.pos.z - fountain.z) > fountain.r + SHOP_RANGE_PAD) {
      return false;
    }
    const itemId = u.items[slot];
    if (itemId === undefined) return false;
    const def = ITEMS[itemId];
    if (!def) return false;
    u.items = u.items.filter((_, i) => i !== slot);
    u.gold += Math.floor(def.cost * 0.7);
    recalcChampion(u);
    return true;
  }

  tick(): SimEvent[] {
    const ctx = this.ctx();

    stepRecalls(ctx, this.map);
    // Shield detonations must fire before generic expiry prunes them.
    stepShieldBursts(ctx);
    for (const u of this.units.values()) expireStatuses(u, this.time);
    stepWalls(ctx);

    stepDots(ctx);
    if (this.winner === null) grantPassiveGold(ctx);
    for (const u of this.units.values()) {
      if (u.dead) continue;
      if (u.stats.hpRegen > 0) u.hp = Math.min(u.maxHp, u.hp + u.stats.hpRegen * DT);
      if (u.stats.manaRegen > 0) u.mana = Math.min(u.maxMana, u.mana + u.stats.manaRegen * DT);
    }
    applyFountainRegen(ctx, this.map);
    stepPassives(ctx, this.tickCount);

    runBotDecisions(this, this.policies);
    runRemoteDecisions(this, this.remoteSeats);

    if (this.winner === null && this.time >= this.nextWaveAt) {
      spawnWave(ctx, this.map, this.waveCount++);
      this.nextWaveAt += WAVE_EVERY;
    }
    if (this.winner === null) {
      stepObjectives(ctx, this.map, this.objectives);
      stepCamps(ctx, this.campStates);
    }

    stepMinionAi(ctx, this.nav, this.map, this.tickCount);
    stepTowerAi(ctx);
    stepAttackMove(this);
    stepIdleDefense(this);
    stepWindups(ctx);
    stepAutoAttacks(ctx, this.nav);
    stepDashes(ctx, DT);

    for (const u of this.units.values()) {
      if (u.path.length === 0 || u.dead || this.dead.has(u.id)) continue;
      // Winding up a cast plants the caster; a dash in flight owns the body.
      if (u.pendingSpell || u.activeDash) continue;
      const speed = effectiveMoveSpeed(u, this.time);
      if (speed > 0) {
        // Stale paths can cross a wall raised after they were computed;
        // clamp the step at the wall face instead of walking through.
        if (this.walls.size > 0) {
          const from = { x: u.pos.x, z: u.pos.z };
          stepMovement(u, DT, speed);
          clampThroughWalls(this.nav, from, u);
        } else {
          stepMovement(u, DT, speed);
        }
      }
    }

    stepSeparation(ctx, this.nav);
    stepProjectiles(ctx, DT);
    stepZones(ctx);

    for (const id of this.dead) {
      const u = this.units.get(id);
      if (!u) continue;
      const killerId = this.killers.get(id) ?? 0;
      grantKillRewards(ctx, u, killerId);
      if (u.kind === 'champion') {
        const killer = this.units.get(killerId);
        if (killer && killer.kind === 'champion' && killer.team !== u.team) {
          killer.kills += 1;
          killer.killStreak += 1;
          passiveOf(killer)?.onTakedown?.(ctx, killer, u);
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
        u.respawnAt = this.time + respawnDelay(u.level, this.time);
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
        // respawn clock starts.
        if (u.kind === 'warden') {
          const killer = this.units.get(killerId);
          if (killer && killer.kind === 'champion') {
            this.teamBuffs.grantBoon(killer.team, this.time);
          }
          onWardenSlain(this.objectives, this.time);
        }
        if (u.kind === 'camp') {
          onCampSlain(this.campStates, id, this.units.get(killerId), this.time);
        }
        if (u.moveSpeed <= 0) this.nav.unblockCircle(u.pos.x, u.pos.z, staticFootprint(u));
        this.units.delete(id);
        if (u.kind === 'sanctum' && this.winner === null) {
          this.winner = (1 - u.team) as TeamId;
          this.events.push({ type: 'victory', team: this.winner });
        }
      }
    }
    this.dead.clear();
    this.killers.clear();

    for (const u of this.units.values()) {
      if (this.winner !== null) break;
      if (u.kind !== 'champion' || !u.dead || this.time < u.respawnAt) continue;
      const fountain = this.map.fountains.find((f) => f.team === u.team)!;
      // Slot by teammate order so two teammates can never share an exact
      // respawn coordinate; cooldowns persist through death (review F.2:
      // dying was a free ultimate refresh).
      let teammateIndex = 0;
      for (const o of this.units.values()) {
        if (o.kind === 'champion' && o.team === u.team && o.id < u.id) teammateIndex++;
      }
      const slot = SPAWN_SLOTS[teammateIndex % SPAWN_SLOTS.length]!;
      u.dead = false;
      u.pos = { x: fountain.x + slot.x, z: fountain.z + slot.z };
      u.hp = u.maxHp;
      u.mana = u.maxMana;
      u.statuses = [];
    }

    this.visibility = computeVisibility(this.map, this.units, this.time, this.zones);

    // Refresh each team's memory of the enemy champions it can see right
    // now; a dead champion is forgotten (its corpse spot means nothing).
    for (const u of this.units.values()) {
      if (u.kind !== 'champion' || u.neutral) continue;
      const observer = (1 - u.team) as TeamId;
      if (u.dead) {
        this.lastSeen[observer].delete(u.id);
        continue;
      }
      if (this.visibility[observer].has(u.id)) {
        this.lastSeen[observer].set(u.id, {
          x: u.pos.x,
          z: u.pos.z,
          at: this.time,
          hpFrac: u.maxHp > 0 ? u.hp / u.maxHp : 0,
        });
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
