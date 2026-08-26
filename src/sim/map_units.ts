// Spawns the map's static units (towers, Sanctums) from the map record.

import type { GameMap } from './content/map';
import { createSanctum, createTower, type Unit } from './unit';

export function createMapUnits(map: GameMap, allocId: () => number): Unit[] {
  const out: Unit[] = [];
  for (const t of map.towers) {
    out.push(createTower(allocId(), t.team, { x: t.x, z: t.z }, { lane: t.lane, tier: t.tier }));
  }
  for (const s of map.sanctums) out.push(createSanctum(allocId(), s.team, { x: s.x, z: s.z }));
  return out;
}
