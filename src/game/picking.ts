// Unit picking for pointer input, generous like the genre. Two paths share
// one pickability gate: pickEnemyOnScreen compares the pointer against each
// unit's PROJECTED body in screen pixels (units are small on screen, so a
// ground-plane test alone misses bodies that rise above their feet), and
// pickEnemyAt is the sim-space fallback for hosts without a projector.
// Dead units, units hidden by the fog of war, and invulnerable structures
// are never pickable. On screen, structures lose to any champion or minion
// candidate (their silhouettes are huge, so a champion standing on a tower
// must stay clickable), direct body hits beat slop hits (a click ON a minion
// is a last-hit order, not a nearby champion's), and champions beat minions
// on overlap.

import { isInvulnerable } from '../sim/structure_rules';
import type { TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { IWorld } from '../world_api';

const CLICK_SLOP = 1.6;
const CLICK_SLOP_PX = 24;

// Projects a world point (x, y up, z) to client pixels; null when behind the
// camera. The renderer provides this.
export type ScreenProjector = (x: number, y: number, z: number) => { x: number; y: number } | null;

function pickable(world: IWorld, u: Readonly<Unit>, selfTeam: TeamId): boolean {
  if (u.dead) return false;
  // Neutral units (the Warden, the rings' creatures) are attackable by both teams.
  if (!u.neutral && u.team === selfTeam) return false;
  if (!world.isVisible(selfTeam, u.id)) return false;
  if ((u.kind === 'tower' || u.kind === 'sanctum') && isInvulnerable(world.units, u)) return false;
  return true;
}

function kindPriority(u: Readonly<Unit>): number {
  if (u.kind === 'champion') return 0;
  if (u.kind === 'minion' || u.kind === 'warden' || u.kind === 'camp' || u.kind === 'creature')
    return 1;
  return 2;
}

// The visual center height of a unit's body, so clicks land on what the
// player sees rather than the patch of ground at its feet.
function bodyHeight(u: Readonly<Unit>): number {
  if (u.kind === 'champion') return 1.2;
  if (u.kind === 'minion') return 0.6;
  if (u.kind === 'warden' || u.kind === 'creature') return 1.4;
  if (u.kind === 'camp') return 0.8;
  return 3.0;
}

// Selection picking: ANY living unit the viewer can see, allies and
// invulnerable structures included (clicking a tower to inspect it is
// legitimate even when it cannot be attacked yet).
export function pickUnitOnScreen(
  world: IWorld,
  selfTeam: TeamId,
  clientX: number,
  clientY: number,
  project: ScreenProjector,
): Readonly<Unit> | null {
  let best: Readonly<Unit> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const u of world.units.values()) {
    if (u.dead) continue;
    if (u.team !== selfTeam && !world.isVisible(selfTeam, u.id)) continue;
    const h = bodyHeight(u);
    const c = project(u.pos.x, h, u.pos.z);
    if (!c) continue;
    const edge = project(u.pos.x + u.radius, h, u.pos.z);
    const radiusPx = edge ? Math.hypot(edge.x - c.x, edge.y - c.y) : 0;
    const d = Math.hypot(c.x - clientX, c.y - clientY) - radiusPx;
    if (d > CLICK_SLOP_PX) continue;
    const score = (d <= 0 ? 0 : 100000) + kindPriority(u) * 1000 + d;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}

export function pickEnemyOnScreen(
  world: IWorld,
  selfTeam: TeamId,
  clientX: number,
  clientY: number,
  project: ScreenProjector,
): Readonly<Unit> | null {
  let best: Readonly<Unit> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const u of world.units.values()) {
    if (!pickable(world, u, selfTeam)) continue;
    const h = bodyHeight(u);
    const c = project(u.pos.x, h, u.pos.z);
    if (!c) continue;
    const edge = project(u.pos.x + u.radius, h, u.pos.z);
    const radiusPx = edge ? Math.hypot(edge.x - c.x, edge.y - c.y) : 0;
    const d = Math.hypot(c.x - clientX, c.y - clientY) - radiusPx;
    if (d > CLICK_SLOP_PX) continue;
    const structure = u.kind === 'tower' || u.kind === 'sanctum' ? 1 : 0;
    const score = structure * 1e6 + (d <= 0 ? 0 : 100000) + kindPriority(u) * 1000 + d;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}

export function pickEnemyAt(world: IWorld, p: Vec2, selfTeam: TeamId): Readonly<Unit> | null {
  let best: Readonly<Unit> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const u of world.units.values()) {
    if (!pickable(world, u, selfTeam)) continue;
    const d = Math.hypot(u.pos.x - p.x, u.pos.z - p.z) - u.radius;
    if (d > CLICK_SLOP) continue;
    // Sim-space keeps the original genre rule: champions beat everything
    // under the cursor, then closest wins.
    const score = (u.kind === 'champion' ? 0 : 1) * 100 + d;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best;
}
