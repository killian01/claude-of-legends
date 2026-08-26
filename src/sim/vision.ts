// Team fog of war. An enemy is visible when some alive friendly unit has it
// within sight range, unless the enemy stands in brush the observer is not
// sharing, or is stealthed (no true sight yet). Blinds shrink an observer's
// sight radius. This same function will feed Policy observations: a bot sees
// its team's vision, never the global sim state (game definition). Wall
// occlusion of sight lines is a deliberate later refinement.

import { isStealthed, sightFactor } from './combat/status';
import type { GameMap } from './content/map';
import type { TeamId, Vec2 } from './types';
import type { Unit } from './unit';

export function brushIndexAt(map: GameMap, p: Vec2): number {
  for (let i = 0; i < map.brush.length; i++) {
    const b = map.brush[i]!;
    if (Math.hypot(p.x - b.x, p.z - b.z) <= b.r) return i;
  }
  return -1;
}

// For each team, the set of ENEMY unit ids that team can currently see.
export function computeVisibility(
  map: GameMap,
  units: ReadonlyMap<number, Unit>,
  time: number,
): [Set<number>, Set<number>] {
  const sets: [Set<number>, Set<number>] = [new Set(), new Set()];
  const brush = new Map<number, number>();
  for (const u of units.values()) {
    if (!u.dead) brush.set(u.id, brushIndexAt(map, u.pos));
  }
  for (const target of units.values()) {
    if (target.dead || isStealthed(target, time)) continue;
    const observer = (1 - target.team) as TeamId;
    const targetBrush = brush.get(target.id) ?? -1;
    for (const src of units.values()) {
      if (src.team !== observer || src.dead) continue;
      const d = Math.hypot(src.pos.x - target.pos.x, src.pos.z - target.pos.z);
      if (d > src.sightRange * sightFactor(src, time)) continue;
      if (targetBrush !== -1 && brush.get(src.id) !== targetBrush) continue;
      sets[observer].add(target.id);
      break;
    }
  }
  return sets;
}
