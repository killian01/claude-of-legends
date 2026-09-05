// The scene of a death (CONTEXT.md: Death card; playtest round 3's next
// step): what stood around a champion the moment it died, read from the
// sim right after the tick that killed it, so a Match sheet can say "alone,
// three enemies within twenty, under their tower" and draw it, without
// replaying twenty minutes to find out. Pure over the sim; deterministic,
// so a replayed match yields the same scenes.

import type { Sim } from '../sim';
import type { TeamId } from '../types';
import { hostile, type Unit, type UnitKind } from '../unit';

// How far around the death counts as "around".
export const SCENE_RADIUS = 20;
// At most this many units in a scene (champions and structures only).
export const SCENE_CAP = 12;

export interface SceneUnit {
  id: number;
  team: TeamId;
  kind: UnitKind;
  x: number;
  z: number;
  // Health as a fraction, two decimals; 0 for a structure already down.
  hp: number;
}

export interface DeathScene {
  x: number;
  z: number;
  // A hostile tower or Sanctum had the champion in its reach.
  underTower: boolean;
  allies: number;
  enemies: number;
  around: SceneUnit[];
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function inTowerReach(tower: Unit, u: Unit): boolean {
  const d = Math.hypot(tower.pos.x - u.pos.x, tower.pos.z - u.pos.z);
  return d <= tower.stats.attackRange + tower.radius + u.radius;
}

export function deathScene(sim: Sim, unitId: number, radius = SCENE_RADIUS): DeathScene | null {
  const u = sim.units.get(unitId);
  if (u?.kind !== 'champion') return null;
  const around: SceneUnit[] = [];
  let allies = 0;
  let enemies = 0;
  let underTower = false;
  for (const o of sim.units.values()) {
    if (o.id === u.id) continue;
    if (o.kind !== 'champion' && o.kind !== 'tower' && o.kind !== 'sanctum') continue;
    const d = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z);
    if (d > radius) continue;
    const foe = hostile(u, o);
    if (o.kind === 'champion' && !o.dead) {
      if (foe) enemies++;
      else allies++;
    } else if (foe && !o.dead && inTowerReach(o, u)) underTower = true;
    around.push({
      id: o.id,
      team: o.team,
      kind: o.kind,
      x: round1(o.pos.x),
      z: round1(o.pos.z),
      hp: o.dead ? 0 : Math.round((o.hp / Math.max(1, o.maxHp)) * 100) / 100,
    });
  }
  around.sort((a, b) => a.id - b.id);
  return {
    x: round1(u.pos.x),
    z: round1(u.pos.z),
    underTower,
    allies,
    enemies,
    around: around.slice(0, SCENE_CAP),
  };
}
