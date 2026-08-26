// The sim coordinator. Stays thin: systems live in sibling modules driven
// through CombatCtx, and the tick calls them in a FIXED order (the order is
// load-bearing for determinism):
//   statuses -> regen -> auto-attacks -> movement -> projectiles -> zones ->
//   death cleanup -> clock.

import { stepAutoAttacks } from './combat/auto_attack';
import { castAbility } from './combat/casting';
import { effectiveMoveSpeed, expireStatuses } from './combat/status';
import { CHAMPIONS, DEFAULT_CHAMPION_ID } from './content/champions';
import { GAME_MAP, type GameMap } from './content/map';
import { createMapUnits } from './map_units';
import { stepMovement } from './movement';
import { NavGrid } from './navgrid';
import { findPath } from './pathfind';
import type { Projectile } from './projectiles';
import { stepProjectiles } from './projectiles';
import { Rng } from './rng';
import type { CombatCtx } from './sim_context';
import { type AbilityKey, type DamageType, DT, type TeamId, type Vec2 } from './types';
import { createChampion, staticFootprint, type Unit } from './unit';
import type { Zone } from './zones';
import { stepZones } from './zones';

export type SimEvent =
  | { type: 'damage'; sourceId: number; targetId: number; amount: number; dtype: DamageType }
  | { type: 'death'; unitId: number; killerId: number }
  | { type: 'cast'; unitId: number; key: AbilityKey };

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
  private nextId = 1;
  private events: SimEvent[] = [];
  private readonly dead = new Set<number>();

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.nav = new NavGrid(this.map.size, this.map.walls, this.map.borderMargin);
    for (const u of createMapUnits(this.map, () => this.nextId++)) {
      this.units.set(u.id, u);
      this.nav.blockCircle(u.pos.x, u.pos.z, staticFootprint(u));
    }
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

  orderMove(unitId: number, x: number, z: number): void {
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0 || this.dead.has(unitId)) return;
    u.attackTargetId = null;
    u.path = findPath(this.nav, u.pos, { x, z });
  }

  orderAttack(unitId: number, targetId: number): void {
    const u = this.units.get(unitId);
    const target = this.units.get(targetId);
    if (!u || !target || this.dead.has(unitId) || this.dead.has(targetId)) return;
    if (target.team === u.team) return;
    u.attackTargetId = targetId;
  }

  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean {
    const u = this.units.get(unitId);
    if (!u || u.championId === null) return false;
    const def = CHAMPIONS[u.championId]?.abilities[key];
    if (!def) return false;
    return castAbility(this.ctx(), u, key, def, aim);
  }

  tick(): SimEvent[] {
    const ctx = this.ctx();

    for (const u of this.units.values()) expireStatuses(u, this.time);

    for (const u of this.units.values()) {
      if (this.dead.has(u.id)) continue;
      if (u.stats.hpRegen > 0) u.hp = Math.min(u.maxHp, u.hp + u.stats.hpRegen * DT);
      if (u.stats.manaRegen > 0) u.mana = Math.min(u.maxMana, u.mana + u.stats.manaRegen * DT);
    }

    stepAutoAttacks(ctx, this.nav);

    for (const u of this.units.values()) {
      if (u.path.length === 0 || this.dead.has(u.id)) continue;
      const speed = effectiveMoveSpeed(u, this.time);
      if (speed > 0) stepMovement(u, DT, speed);
    }

    stepProjectiles(ctx, DT);
    stepZones(ctx);

    for (const id of this.dead) {
      const u = this.units.get(id);
      if (u) {
        if (u.moveSpeed <= 0) this.nav.unblockCircle(u.pos.x, u.pos.z, staticFootprint(u));
        this.units.delete(id);
      }
    }
    this.dead.clear();

    this.time += DT;
    this.tickCount += 1;
    const out = this.events;
    this.events = [];
    return out;
  }
}
