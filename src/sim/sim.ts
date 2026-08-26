// The sim coordinator. Stays thin: systems land as sibling modules that the
// tick calls in a fixed order (the order is load-bearing for determinism).

import { GAME_MAP, type GameMap } from './content/map';
import { createMapUnits } from './map_units';
import { stepMovement } from './movement';
import { NavGrid } from './navgrid';
import { findPath } from './pathfind';
import { Rng } from './rng';
import { DT, type TeamId } from './types';
import { createChampion, staticFootprint, type Unit } from './unit';

export interface SimEvent {
  type: string;
}

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
  time = 0;
  tickCount = 0;
  private nextId = 1;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.nav = new NavGrid(this.map.size, this.map.walls, this.map.borderMargin);
    for (const u of createMapUnits(this.map, () => this.nextId++)) {
      this.units.set(u.id, u);
      this.nav.blockCircle(u.pos.x, u.pos.z, staticFootprint(u));
    }
  }

  addChampion(team: TeamId): Unit {
    const fountain = this.map.fountains.find((f) => f.team === team);
    if (!fountain) throw new Error(`no fountain for team ${team}`);
    let count = 0;
    for (const u of this.units.values()) {
      if (u.kind === 'champion' && u.team === team) count++;
    }
    const slot = SPAWN_SLOTS[count % SPAWN_SLOTS.length]!;
    const champ = createChampion(this.nextId++, team, {
      x: fountain.x + slot.x,
      z: fountain.z + slot.z,
    });
    this.units.set(champ.id, champ);
    return champ;
  }

  orderMove(unitId: number, x: number, z: number): void {
    const u = this.units.get(unitId);
    if (!u || u.moveSpeed <= 0) return;
    u.path = findPath(this.nav, u.pos, { x, z });
  }

  tick(): SimEvent[] {
    for (const u of this.units.values()) {
      if (u.path.length > 0) stepMovement(u, DT);
    }
    this.time += DT;
    this.tickCount += 1;
    return [];
  }
}
