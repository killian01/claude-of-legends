// The sim coordinator. Stays thin: systems live in sibling modules driven
// through CombatCtx, and the tick calls them in a FIXED order (the order is
// load-bearing for determinism):
//   statuses -> income and regen -> waves -> minion AI -> tower AI ->
//   auto-attacks -> movement -> projectiles -> zones -> deaths -> respawns ->
//   vision -> clock.

import { stepAttackMove } from './attack_move';
import { runBotDecisions } from './bot_driver';
import { stepAutoAttacks } from './combat/auto_attack';
import { castAbility, executeCast } from './combat/casting';
import { stepDots } from './combat/dots';
import {
  breakStealth,
  cancelRecall,
  effectiveMoveSpeed,
  expireStatuses,
  isStunned,
} from './combat/status';
import { CHAMPIONS, DEFAULT_CHAMPION_ID } from './content/champions';
import { ITEMS } from './content/items';
import { GAME_MAP, type GameMap } from './content/map';
import { SIGILS } from './content/sigils';
import { hasDecisionToken, spendDecisionToken } from './decision_budget';
import { applyFountainRegen } from './fountain';
import { createMapUnits } from './map_units';
import { stepMinionAi } from './minion_ai';
import { stepMovement } from './movement';
import { NavGrid } from './navgrid';
import { findPath } from './pathfind';
import type { Policy } from './policy';
import type { Projectile } from './projectiles';
import { stepProjectiles } from './projectiles';
import { startRecall, stepRecalls } from './recall';
import { grantKillRewards, grantPassiveGold } from './rewards';
import { Rng } from './rng';
import type { CombatCtx } from './sim_context';
import { recalcChampion } from './stats';
import { stepTowerAi } from './tower_ai';
import {
  type AbilityKey,
  type DamageType,
  DT,
  type ScoreRow,
  type TeamId,
  ULT_LEVEL,
  type Vec2,
} from './types';
import { createChampion, staticFootprint, type Unit } from './unit';
import { computeVisibility } from './vision';
import { FIRST_WAVE_AT, spawnWave, WAVE_EVERY } from './waves';
import type { Zone } from './zones';
import { stepZones } from './zones';

export type SimEvent =
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; dtype: DamageType }
  | { type: 'death'; unitId: number; killerId: number }
  | { type: 'cast'; unitId: number; key: AbilityKey }
  | { type: 'sigil'; unitId: number; slot: number }
  | { type: 'gold'; unitId: number; amount: number }
  | { type: 'victory'; team: TeamId };

const RESPAWN_BASE = 8;
const RESPAWN_PER_LEVEL = 1.5;
const SHOP_RANGE_PAD = 2;
const INVENTORY_SLOTS = 6;

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
  readonly units = new Map<number, Unit>();
  readonly projectiles = new Map<number, Projectile>();
  readonly zones = new Map<number, Zone>();
  // Bots: sim entities driven in-tick by an attached Policy (ADR 0002).
  readonly policies = new Map<number, Policy>();
  time = 0;
  tickCount = 0;
  winner: TeamId | null = null;
  private visibility: [Set<number>, Set<number>] = [new Set(), new Set()];
  private nextWaveAt = FIRST_WAVE_AT;
  private waveCount = 0;
  private nextId = 1;
  private events: SimEvent[] = [];
  private readonly dead = new Set<number>();
  private readonly killers = new Map<number, number>();

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
      events: this.events,
      dead: this.dead,
      killers: this.killers,
      allocId: () => this.nextId++,
    };
  }

  addChampion(team: TeamId, at?: Vec2, championId: string = DEFAULT_CHAMPION_ID): Unit {
    const def = CHAMPIONS[championId];
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
    this.units.set(champ.id, champ);
    return champ;
  }

  championDef(championId: string): (typeof CHAMPIONS)[string] | null {
    return CHAMPIONS[championId] ?? null;
  }

  attachPolicy(unitId: number, policy: Policy): void {
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion') return;
    this.policies.set(unitId, policy);
  }

  // One row per champion; position-free, so it crosses the fog safely.
  scoreboard(): readonly ScoreRow[] {
    const rows: ScoreRow[] = [];
    for (const u of this.units.values()) {
      if (u.kind !== 'champion' || u.championId === null) continue;
      const def = CHAMPIONS[u.championId];
      rows.push({
        unitId: u.id,
        name: def ? (def.name.split(',')[0] ?? def.name) : u.championId,
        championId: u.championId,
        team: u.team,
        level: u.level,
        kills: u.kills,
        deaths: u.deaths,
      });
    }
    return rows;
  }

  isVisible(team: TeamId, unitId: number): boolean {
    const u = this.units.get(unitId);
    if (!u) return false;
    // Your own team always sees its units, DEAD INCLUDED: review finding
    // F.1/F.3, a dead champion vanishing from its own snapshot froze the
    // online HUD and killed the death screen.
    if (u.team === team) return true;
    if (u.dead) return false;
    // Structures are always revealed, like the genre.
    if (u.kind === 'tower' || u.kind === 'sanctum') return true;
    return this.visibility[team].has(unitId);
  }

  orderMove(unitId: number, x: number, z: number): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0 || u.dead || this.dead.has(unitId)) return;
    cancelRecall(u);
    u.attackTargetId = null;
    u.attackMoveTarget = null;
    u.path = findPath(this.nav, u.pos, { x, z });
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
    if (target.team === u.team) return;
    cancelRecall(u);
    u.attackMoveTarget = null;
    u.attackTargetId = targetId;
  }

  orderAttackMove(unitId: number, x: number, z: number): void {
    if (this.winner !== null) return;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.dead || this.dead.has(unitId)) return;
    cancelRecall(u);
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
    if (key === 'R' && u.level < ULT_LEVEL) return false;
    const def = CHAMPIONS[u.championId]?.abilities[key];
    if (!def) return false;
    if (!hasDecisionToken(u, this.time)) return false;
    const ok = castAbility(this.ctx(), u, key, def, aim);
    if (ok) {
      spendDecisionToken(u, this.time);
      cancelRecall(u);
    }
    return ok;
  }

  castSigil(unitId: number, slot: number, aim: Vec2): boolean {
    if (this.winner !== null) return false;
    const u = this.units.get(unitId);
    if (!u || u.kind !== 'champion' || u.dead || this.dead.has(unitId)) return false;
    if (isStunned(u, this.time)) return false;
    const sigilId = u.sigils[slot];
    const def = sigilId ? SIGILS[sigilId] : undefined;
    if (!def) return false;
    if ((u.sigilCooldowns[slot] ?? 0) > this.time) return false;
    if (!hasDecisionToken(u, this.time)) return false;
    const ok = executeCast(this.ctx(), u, def.spec, def.castRange, aim, {
      ad: u.stats.ad,
      ap: u.stats.ap,
    });
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
    if (!u || !def || u.kind !== 'champion' || u.dead) return false;
    const fountain = this.map.fountains.find((f) => f.team === u.team);
    if (!fountain) return false;
    const d = Math.hypot(u.pos.x - fountain.x, u.pos.z - fountain.z);
    if (d > fountain.r + SHOP_RANGE_PAD) return false;

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
    const cost = def.cost - discount;
    if (u.gold < cost) return false;
    if (u.items.length - consumedIndices.length >= INVENTORY_SLOTS) return false;

    u.gold -= cost;
    u.items = u.items.filter((_, i) => !consumedIndices.includes(i));
    u.items.push(itemId);
    recalcChampion(u);
    return true;
  }

  tick(): SimEvent[] {
    const ctx = this.ctx();

    stepRecalls(ctx, this.map);
    for (const u of this.units.values()) expireStatuses(u, this.time);

    stepDots(ctx);
    if (this.winner === null) grantPassiveGold(ctx);
    for (const u of this.units.values()) {
      if (u.dead) continue;
      if (u.stats.hpRegen > 0) u.hp = Math.min(u.maxHp, u.hp + u.stats.hpRegen * DT);
      if (u.stats.manaRegen > 0) u.mana = Math.min(u.maxMana, u.mana + u.stats.manaRegen * DT);
    }
    applyFountainRegen(ctx, this.map);

    runBotDecisions(this, this.policies);

    if (this.winner === null && this.time >= this.nextWaveAt) {
      spawnWave(ctx, this.map, this.waveCount++);
      this.nextWaveAt += WAVE_EVERY;
    }

    stepMinionAi(ctx, this.nav, this.map, this.tickCount);
    stepTowerAi(ctx);
    stepAttackMove(this);
    stepAutoAttacks(ctx, this.nav);

    for (const u of this.units.values()) {
      if (u.path.length === 0 || u.dead || this.dead.has(u.id)) continue;
      const speed = effectiveMoveSpeed(u, this.time);
      if (speed > 0) stepMovement(u, DT, speed);
    }

    stepProjectiles(ctx, DT);
    stepZones(ctx);

    for (const id of this.dead) {
      const u = this.units.get(id);
      if (!u) continue;
      grantKillRewards(ctx, u, this.killers.get(id) ?? 0);
      if (u.kind === 'champion') {
        const killer = this.units.get(this.killers.get(id) ?? 0);
        if (killer && killer.kind === 'champion' && killer.team !== u.team) killer.kills += 1;
        u.deaths += 1;
        u.dead = true;
        u.hp = 0;
        u.respawnAt = this.time + RESPAWN_BASE + RESPAWN_PER_LEVEL * u.level;
        u.path = [];
        u.attackTargetId = null;
        u.statuses = [];
      } else {
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
      const slot = SPAWN_SLOTS[u.id % SPAWN_SLOTS.length]!;
      u.dead = false;
      u.pos = { x: fountain.x + slot.x, z: fountain.z + slot.z };
      u.hp = u.maxHp;
      u.mana = u.maxMana;
      u.statuses = [];
      u.cooldowns = {};
    }

    this.visibility = computeVisibility(this.map, this.units, this.time);

    this.time += DT;
    this.tickCount += 1;
    const out = this.events;
    this.events = [];
    return out;
  }
}
