// The shared unit model. Champions, towers, and Sanctums are all units; what
// varies is data (stats, kind), not the entity shape. Minions join in phase 4.

import type { Status } from './combat/status';
import type { ChampionDef } from './content/champions';
import type { AbilityKey, TeamId, Vec2 } from './types';

export type UnitKind = 'champion' | 'tower' | 'sanctum';

export interface UnitStats {
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  attackRange: number;
  attackSpeed: number;
  hpRegen: number;
  manaRegen: number;
}

export interface Unit {
  id: number;
  team: TeamId;
  kind: UnitKind;
  championId: string | null;
  pos: Vec2;
  radius: number;
  moveSpeed: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  stats: UnitStats;
  statuses: Status[];
  // Ready-at sim times per ability key.
  cooldowns: Partial<Record<AbilityKey, number>>;
  attackTargetId: number | null;
  attackReadyAt: number;
  // Remaining waypoints toward the current move order; empty when idle.
  path: Vec2[];
}

// Ground a static unit (tower, Sanctum) blocks in the NavGrid while it
// stands, slightly padded so champions keep visual separation from it.
// Blocked at spawn, unblocked at death, with this exact same value.
export function staticFootprint(u: Unit): number {
  return u.radius + 0.4;
}

export function createChampion(id: number, team: TeamId, pos: Vec2, def: ChampionDef): Unit {
  const b = def.base;
  return {
    id,
    team,
    kind: 'champion',
    championId: def.id,
    pos: { x: pos.x, z: pos.z },
    radius: b.radius,
    moveSpeed: b.moveSpeed,
    hp: b.hp,
    maxHp: b.hp,
    mana: b.mana,
    maxMana: b.mana,
    stats: {
      ad: b.ad,
      ap: b.ap,
      armor: b.armor,
      mr: b.mr,
      attackRange: b.attackRange,
      attackSpeed: b.attackSpeed,
      hpRegen: b.hpRegen,
      manaRegen: b.manaRegen,
    },
    statuses: [],
    cooldowns: {},
    attackTargetId: null,
    attackReadyAt: 0,
    path: [],
  };
}

function createStatic(
  id: number,
  team: TeamId,
  kind: UnitKind,
  pos: Vec2,
  radius: number,
  hp: number,
): Unit {
  return {
    id,
    team,
    kind,
    championId: null,
    pos: { x: pos.x, z: pos.z },
    radius,
    moveSpeed: 0,
    hp,
    maxHp: hp,
    mana: 0,
    maxMana: 0,
    stats: {
      ad: 0,
      ap: 0,
      armor: 40,
      mr: 40,
      attackRange: 0,
      attackSpeed: 0,
      hpRegen: 0,
      manaRegen: 0,
    },
    statuses: [],
    cooldowns: {},
    attackTargetId: null,
    attackReadyAt: 0,
    path: [],
  };
}

export function createTower(id: number, team: TeamId, pos: Vec2): Unit {
  return createStatic(id, team, 'tower', pos, 1.4, 2500);
}

export function createSanctum(id: number, team: TeamId, pos: Vec2): Unit {
  return createStatic(id, team, 'sanctum', pos, 2.2, 3000);
}
