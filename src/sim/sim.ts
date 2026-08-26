// The sim coordinator. Stays thin: systems live in sibling modules driven
// through CombatCtx, and the tick calls them in a FIXED order (the order is
// load-bearing for determinism):
//   statuses -> income and regen -> waves -> minion AI -> tower AI ->
//   auto-attacks -> movement -> projectiles -> zones -> deaths -> respawns ->
//   vision -> clock.

import { stepAutoAttacks } from './combat/auto_attack';
import { castAbility } from './combat/casting';
import { effectiveMoveSpeed, expireStatuses } from './combat/status';
import { CHAMPIONS, DEFAULT_CHAMPION_ID } from './content/champions';
import { ITEMS } from './content/items';
import { GAME_MAP, type GameMap } from './content/map';
import { createMapUnits } from './map_units';
import { stepMinionAi } from './minion_ai';
import { stepMovement } from './movement';
import { NavGrid } from './navgrid';
import { findPath } from './pathfind';
import type { Projectile } from './projectiles';
import { stepProjectiles } from './projectiles';
import { grantKillRewards, grantPassiveGold } from './rewards';
import { Rng } from './rng';
import type { CombatCtx } from './sim_context';
import { recalcChampion } from './stats';
import { stepTowerAi } from './tower_ai';
import { type AbilityKey, type DamageType, DT, type TeamId, type Vec2 } from './types';
import { createChampion, staticFootprint, type Unit } from './unit';
import { computeVisibility } from './vision';
import { FIRST_WAVE_AT, spawnWave, WAVE_EVERY } from './waves';
import type { Zone } from './zones';
import { stepZones } from './zones';

export type SimEvent =
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; dtype: DamageType }
  | { type: 'death'; unitId: number; killerId: number }
  | { type: 'cast'; unitId: number; key: AbilityKey }
  | { type: 'victory'; team: TeamId };

export const ULT_LEVEL = 6;
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
  time = 0;
  tickCount = 0;
  winner: TeamId | null = null;
  private visibility: [Set<number>, Set<number>] = [new Set(), new Set()];
  private nextWaveAt = FIRST_WAVE_AT;
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
    this.visibility = computeVisibility(this.map, this.units);
  }

  private ctx(): CombatCtx {
    return {
      time: this.time,
      rng: this.rng,
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

  isVisible(team: TeamId, unitId: number): boolean {
    const u = this.units.get(unitId);
    if (!u || u.dead) return false;
    if (u.team === team) return true;
    // Structures are always revealed, like the genre.
    if (u.kind === 'tower' || u.kind === 'sanctum') return true;
    return this.visibility[team].has(unitId);
  }

  orderMove(unitId: number, x: number, z: number): void {
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0 || u.dead || this.dead.has(unitId)) return;
    u.attackTargetId = null;
    u.path = findPath(this.nav, u.pos, { x, z });
  }

  orderAttack(unitId: number, targetId: number): void {
    const u = this.units.get(unitId);
    const target = this.units.get(targetId);
    if (!u || !target || u.dead || target.dead) return;
    if (this.dead.has(unitId) || this.dead.has(targetId)) return;
    if (target.team === u.team) return;
    u.attackTargetId = targetId;
  }

  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean {
    const u = this.units.get(unitId);
    if (!u || u.championId === null || u.dead) return false;
    if (key === 'R' && u.level < ULT_LEVEL) return false;
    const def = CHAMPIONS[u.championId]?.abilities[key];
    if (!def) return false;
    return castAbility(this.ctx(), u, key, def, aim);
  }

  buyItem(unitId: number, itemId: string): boolean {
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

    for (const u of this.units.values()) expireStatuses(u, this.time);

    grantPassiveGold(ctx);
    for (const u of this.units.values()) {
      if (u.dead) continue;
      if (u.stats.hpRegen > 0) u.hp = Math.min(u.maxHp, u.hp + u.stats.hpRegen * DT);
      if (u.stats.manaRegen > 0) u.mana = Math.min(u.maxMana, u.mana + u.stats.manaRegen * DT);
    }

    if (this.winner === null && this.time >= this.nextWaveAt) {
      spawnWave(ctx, this.map);
      this.nextWaveAt += WAVE_EVERY;
    }

    stepMinionAi(ctx, this.nav, this.map, this.tickCount);
    stepTowerAi(ctx);
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

    this.visibility = computeVisibility(this.map, this.units);

    this.time += DT;
    this.tickCount += 1;
    const out = this.events;
    this.events = [];
    return out;
  }
}
