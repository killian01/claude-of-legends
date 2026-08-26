// The shared unit model. Champions, towers, and Sanctums are all units; what
// varies is data (stats, kind), not the entity shape. Minions join in phase 4.

import type { TeamId, Vec2 } from './types';

export type UnitKind = 'champion' | 'tower' | 'sanctum';

export interface Unit {
  id: number;
  team: TeamId;
  kind: UnitKind;
  pos: Vec2;
  radius: number;
  moveSpeed: number;
  hp: number;
  maxHp: number;
  // Remaining waypoints toward the current move order; empty when idle.
  path: Vec2[];
}

export function createChampion(id: number, team: TeamId, pos: Vec2): Unit {
  return {
    id,
    team,
    kind: 'champion',
    pos: { x: pos.x, z: pos.z },
    radius: 0.65,
    moveSpeed: 3.5,
    hp: 600,
    maxHp: 600,
    path: [],
  };
}

export function createTower(id: number, team: TeamId, pos: Vec2): Unit {
  return {
    id,
    team,
    kind: 'tower',
    pos: { x: pos.x, z: pos.z },
    radius: 1.4,
    moveSpeed: 0,
    hp: 2500,
    maxHp: 2500,
    path: [],
  };
}

export function createSanctum(id: number, team: TeamId, pos: Vec2): Unit {
  return {
    id,
    team,
    kind: 'sanctum',
    pos: { x: pos.x, z: pos.z },
    radius: 2.2,
    moveSpeed: 0,
    hp: 3000,
    maxHp: 3000,
    path: [],
  };
}
