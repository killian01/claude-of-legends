// Team fog of war. An enemy is visible when some alive friendly unit has it
// within sight range, unless the enemy stands in brush the observer is not
// sharing, or is stealthed (no true sight yet). Blinds shrink an observer's
// sight radius. This same function will feed Policy observations: a bot sees
// its team's vision, never the global sim state (game definition). Wall
// occlusion of sight lines is a deliberate later refinement. Ranges and
// sight lines are measured on the ground the match stands on (geo.ts).

import { isStealthed, sightFactor } from './combat/status';
import type { GameMap } from './content/map';
import { dist } from './geo';
import { perTeam, TWO_TEAMS } from './teams';
import type { Vec2 } from './types';
import type { Unit } from './unit';
import { anyWallOnLine } from './wall_index';
import type { Zone } from './zones';

export function brushIndexAt(map: GameMap, p: Vec2): number {
  for (let i = 0; i < map.brush.length; i++) {
    const b = map.brush[i]!;
    if (dist(p, b) <= b.r) return i;
  }
  return -1;
}

// True when the sight line from a to b passes through a jungle wall blob:
// rock blocks sight, not just movement (player review: units were visible
// straight through terrain).
// A map of many walls (the planet's) asks a spatial index for the walls
// near the line first (wall_index.ts); the answer is the same.
export function sightBlocked(map: GameMap, a: Vec2, b: Vec2): boolean {
  return anyWallOnLine(map.walls, a, b);
}

// Whether two champions standing at a and b see each other, sight range
// and status aside, by computeVisibility's rules both ways: within the
// map's close sight always; past it, both out of brush or in the same
// bush, and no wall on the line between them. What a Respawn Arrival's
// fair first fight asks of its spot (royale/grace.ts).
export function inMutualSight(map: GameMap, a: Vec2, b: Vec2): boolean {
  if (map.closeSight !== undefined && dist(a, b) <= map.closeSight) return true;
  if (brushIndexAt(map, a) !== brushIndexAt(map, b)) return false;
  return !sightBlocked(map, a, b);
}

// Whether a reveal zone shows a disc at p of radius r right now: a live
// reveal zone's area, through brush and stealth alike, to the zone's own
// team. The one rule an enemy unit and a hidden pod (traps.ts) are shown by.
export function revealShows(z: Zone, time: number, p: Vec2, r: number): boolean {
  return z.reveal && z.until > time && dist(p, z.pos) <= z.radius + r;
}

// For each team (one set per team, in team order, ADR 0030), the set of
// ENEMY unit ids that team can currently see. Reveal zones (kits-v2) add
// their area on top: enemies inside are seen through brush and stealth
// alike (revealShows).
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
      const d = dist(src.pos, target.pos);
      if (d > src.sightRange * sightFactor(src, time)) continue;
      const close = map.closeSight !== undefined && d <= map.closeSight;
      if (!close && targetBrush !== -1 && brush.get(src.id) !== targetBrush) continue;
      if (!close && sightBlocked(map, src.pos, target.pos)) continue;
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
        if (revealShows(z, time, target.pos, target.radius)) seen.add(target.id);
      }
    }
  }
  return sets;
}
