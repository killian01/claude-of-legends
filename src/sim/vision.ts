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

// True when the sight line from a to b passes through a jungle wall blob:
// rock blocks sight, not just movement (player review: units were visible
// straight through terrain).
export function sightBlocked(map: GameMap, a: Vec2, b: Vec2): boolean {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  for (const w of map.walls) {
    const t =
      len2 > 0 ? Math.max(0, Math.min(1, ((w.x - a.x) * abx + (w.z - a.z) * abz) / len2)) : 0;
    const cx = a.x + abx * t;
    const cz = a.z + abz * t;
    if (Math.hypot(w.x - cx, w.z - cz) <= w.r) return true;
  }
  return false;
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
    // A team's own units need no visibility entry; a NEUTRAL unit (jungle
    // camps) sits in the fog for BOTH teams and must be sighted by each.
    const observers: readonly TeamId[] = target.neutral ? [0, 1] : [(1 - target.team) as TeamId];
    const targetBrush = brush.get(target.id) ?? -1;
    for (const observer of observers) {
      for (const src of units.values()) {
        if (src.team !== observer || src.neutral || src.dead) continue;
        const d = Math.hypot(src.pos.x - target.pos.x, src.pos.z - target.pos.z);
        if (d > src.sightRange * sightFactor(src, time)) continue;
        if (targetBrush !== -1 && brush.get(src.id) !== targetBrush) continue;
        if (sightBlocked(map, src.pos, target.pos)) continue;
        sets[observer].add(target.id);
        break;
      }
    }
  }
  return sets;
}
