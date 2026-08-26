// Minion behavior: push the lane waypoint by waypoint; fight what crosses the
// aggro radius, minions first, then vulnerable structures, then champions.
// Chasing and firing ride the shared auto-attack system; this module only
// decides targets and lane movement.

import { isStealthed } from './combat/status';
import type { GameMap, LaneId } from './content/map';
import type { NavGrid } from './navgrid';
import { findPath } from './pathfind';
import type { CombatCtx } from './sim_context';
import { isInvulnerable } from './structure_rules';
import type { Vec2 } from './types';
import type { Unit } from './unit';

const AGGRO_RADIUS = 7;
const LEASH_RADIUS = 10.5;
const ACQUIRE_PERIOD_TICKS = 10;
// Must exceed the largest static footprint blocking radius (~2.12 measured
// next to a tower) or a waypoint near a structure becomes unreachable and
// the lane freezes (review finding F.0).
const WAYPOINT_REACHED = 3;

function targetRank(u: Unit): number {
  if (u.kind === 'minion') return 0;
  if (u.kind === 'tower' || u.kind === 'sanctum') return 1;
  return 2;
}

function acquire(ctx: CombatCtx, u: Unit): void {
  let best: Unit | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const o of ctx.units.values()) {
    if (o.team === u.team || o.dead || ctx.dead.has(o.id)) continue;
    if (isStealthed(o, ctx.time)) continue;
    const d = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z);
    if (d > AGGRO_RADIUS) continue;
    if ((o.kind === 'tower' || o.kind === 'sanctum') && isInvulnerable(ctx.units, o)) continue;
    const rank = targetRank(o);
    if (rank < bestRank || (rank === bestRank && d < bestDist)) {
      best = o;
      bestRank = rank;
      bestDist = d;
    }
  }
  u.attackTargetId = best ? best.id : null;
}

function currentTargetValid(ctx: CombatCtx, u: Unit): boolean {
  if (u.attackTargetId === null) return false;
  const t = ctx.units.get(u.attackTargetId);
  if (!t || t.dead || ctx.dead.has(t.id) || t.team === u.team) return false;
  if (isStealthed(t, ctx.time)) return false;
  return Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z) <= LEASH_RADIUS;
}

function laneWaypoint(map: GameMap, u: Unit): Vec2 {
  const lane = u.lane as LaneId;
  const pts = map.lanes[lane];
  const oriented = u.team === 0 ? pts : [...pts].reverse();
  const wp = oriented[u.laneProgress];
  if (wp) return wp;
  const enemySanctum = map.sanctums.find((s) => s.team !== u.team)!;
  return { x: enemySanctum.x, z: enemySanctum.z };
}

function advanceLane(ctx: CombatCtx, nav: NavGrid, map: GameMap, u: Unit): void {
  let wp = laneWaypoint(map, u);
  if (Math.hypot(wp.x - u.pos.x, wp.z - u.pos.z) < WAYPOINT_REACHED) {
    u.laneProgress += 1;
    wp = laneWaypoint(map, u);
  }
  const end = u.path[u.path.length - 1];
  if (!end || Math.hypot(end.x - wp.x, end.z - wp.z) > 3) {
    u.path = nav.lineOfWalk(u.pos, wp) ? [{ x: wp.x, z: wp.z }] : findPath(nav, u.pos, wp);
  }
}

export function stepMinionAi(ctx: CombatCtx, nav: NavGrid, map: GameMap, tickCount: number): void {
  for (const u of ctx.units.values()) {
    if (u.kind !== 'minion' || u.dead || ctx.dead.has(u.id)) continue;
    if (tickCount % ACQUIRE_PERIOD_TICKS === 0 || !currentTargetValid(ctx, u)) {
      acquire(ctx, u);
    }
    if (u.attackTargetId === null) advanceLane(ctx, nav, map, u);
  }
}
