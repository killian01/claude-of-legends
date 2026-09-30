// The tower's reach on the ground (presentation only): when the viewer's
// own champion comes near an enemy tower, the ring where that tower's fire
// starts is drawn around it, stronger as the champion closes in, and it
// flashes each time the tower shoots that champion. Nothing tells a
// newcomer where a tower bites until it has. This module is the decision,
// pure so tests/tower_reach.test.ts pins it; vfx/tower_reach_fx.ts draws
// it, and nothing here reaches the sim.

import { TOWER_ATTACK_RANGE, TOWER_RADIUS } from '../sim/unit';

// How far outside the reach the ring starts to show, fading in over it.
export const REACH_SHOW_MARGIN = 6;
// How long a flash lasts after a shot at the champion (a tower fires about
// every 1.2 s, so a champion under fire sees it pulse).
export const REACH_FLASH_MS = 700;

export interface ReachTower {
  id: number;
  kind: string;
  team: number;
  pos: { x: number; z: number };
  radius: number;
  dead: boolean;
  stats: { attackRange: number };
}

export interface ReachSelf {
  team: number;
  radius: number;
  dead: boolean;
}

export interface ReachRing {
  towerId: number;
  x: number;
  z: number;
  // From the tower's center to where the champion's center enters its fire.
  radius: number;
  // 0 to 1: how near the champion stands to the reach.
  strength: number;
  // 0 to 1: the flash of a shot at the champion, fading.
  flash: number;
}

// Where a champion's center enters a tower's fire: the tower's body, its
// attack range and the champion's own body, edge to edge as the tower
// measures it (src/sim/tower_ai.ts). The tower's own numbers when the
// world carries them, the sim's otherwise.
export function reachRadius(
  tower: Pick<ReachTower, 'radius' | 'stats'>,
  selfRadius: number,
): number {
  const body = tower.radius > 0 ? tower.radius : TOWER_RADIUS;
  const range = tower.stats.attackRange > 0 ? tower.stats.attackRange : TOWER_ATTACK_RANGE;
  return body + range + selfRadius;
}

// Nothing past the margin, rising to full at the reach, full inside it.
export function reachStrength(distance: number, reach: number): number {
  if (distance <= reach) return 1;
  if (distance >= reach + REACH_SHOW_MARGIN) return 0;
  return (reach + REACH_SHOW_MARGIN - distance) / REACH_SHOW_MARGIN;
}

// 1 at the shot, fading to 0 over REACH_FLASH_MS; 0 with no shot.
export function flashLevel(sinceMs: number | null): number {
  if (sinceMs === null || sinceMs < 0 || sinceMs >= REACH_FLASH_MS) return 0;
  return 1 - sinceMs / REACH_FLASH_MS;
}

// The rings to draw this frame: every live enemy tower the champion is
// near, at `at` (its drawn position). None for a dead champion or none.
export function reachRings(
  self: ReachSelf | null,
  at: { x: number; z: number } | null,
  units: Iterable<ReachTower>,
  shotAt: ReadonlyMap<number, number>,
  nowMs: number,
): ReachRing[] {
  if (!self || self.dead || !at) return [];
  const out: ReachRing[] = [];
  for (const u of units) {
    if (u.kind !== 'tower' || u.dead || u.team === self.team) continue;
    const radius = reachRadius(u, self.radius);
    const strength = reachStrength(Math.hypot(at.x - u.pos.x, at.z - u.pos.z), radius);
    if (strength <= 0) continue;
    const shot = shotAt.get(u.id);
    out.push({
      towerId: u.id,
      x: u.pos.x,
      z: u.pos.z,
      radius,
      strength,
      flash: flashLevel(shot === undefined ? null : nowMs - shot),
    });
  }
  return out;
}
