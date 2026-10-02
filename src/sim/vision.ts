// Team fog of war. An enemy is visible when some alive friendly unit has it
// within sight range, unless the enemy stands in brush the observer is not
// sharing, or is stealthed (no true sight yet). Blinds shrink an observer's
// sight radius. This same function will feed Policy observations: a bot sees
// its team's vision, never the global sim state (game definition). Wall
// occlusion of sight lines is a deliberate later refinement.

import { isStealthed, sightFactor } from './combat/status';
import type { GameMap } from './content/map';
import { hypot } from './exact';
import { perTeam, TWO_TEAMS } from './teams';
import type { Vec2 } from './types';
import type { Unit } from './unit';
import type { Zone } from './zones';

export function brushIndexAt(map: GameMap, p: Vec2): number {
  for (let i = 0; i < map.brush.length; i++) {
    const b = map.brush[i]!;
    if (hypot(p.x - b.x, p.z - b.z) <= b.r) return i;
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
    if (hypot(w.x - cx, w.z - cz) <= w.r) return true;
  }
  return false;
}

// For each team (one set per team, in team order, ADR 0030), the set of
// ENEMY unit ids that team can currently see. Reveal zones (kits-v2) add
// their area on top: enemies inside are seen through brush and stealth
// alike.
export function computeVisibility(
  map: GameMap,
  units: ReadonlyMap<number, Unit>,
  time: number,
  zones?: ReadonlyMap<number, Zone>,
  teamCount = TWO_TEAMS,
): Set<number>[] {
  const sets = perTeam(teamCount, () => new Set<number>());
  const brush = new Map<number, number>();
  for (const u of units.values()) {
    if (!u.dead) brush.set(u.id, brushIndexAt(map, u.pos));
  }
  for (const target of units.values()) {
    if (target.dead || isStealthed(target, time)) continue;
    // A team's own units need no visibility entry; a NEUTRAL unit (jungle
    // camps) sits in the fog for EVERY team and must be sighted by each.
    // Every other team looks once: the first of its units to see the
    // target settles it, so the sets are the same whatever the order the
    // teams are asked in.
    let looking = target.neutral ? teamCount : teamCount - 1;
    const targetBrush = brush.get(target.id) ?? -1;
    for (const src of units.values()) {
      if (looking <= 0) break;
      if (src.neutral || src.dead) continue;
      if (!target.neutral && src.team === target.team) continue;
      const seen = sets[src.team];
      if (!seen || seen.has(target.id)) continue;
      const d = hypot(src.pos.x - target.pos.x, src.pos.z - target.pos.z);
      if (d > src.sightRange * sightFactor(src, time)) continue;
      if (targetBrush !== -1 && brush.get(src.id) !== targetBrush) continue;
      if (sightBlocked(map, src.pos, target.pos)) continue;
      seen.add(target.id);
      looking -= 1;
    }
  }
  if (zones) {
    for (const z of zones.values()) {
      if (!z.reveal || z.until <= time) continue;
      const seen = sets[z.team];
      if (!seen) continue;
      for (const target of units.values()) {
        if (target.dead) continue;
        if (!target.neutral && target.team === z.team) continue;
        const d = hypot(target.pos.x - z.pos.x, target.pos.z - z.pos.z);
        if (d <= z.radius + target.radius) seen.add(target.id);
      }
    }
  }
  return sets;
}
