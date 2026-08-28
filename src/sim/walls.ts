// Temporary ability walls (kits-v2): a straight segment of impassable
// ground raised by a cast and gone seconds later. A wall blocks pathing,
// walking, and traveling dashes exactly like map terrain, because it blocks
// the same NavGrid cells terrain does; projectiles and sight pass over it.
// Every blocked sample is remembered so expiry unblocks the exact cells.

import type { NavGrid } from './navgrid';
import type { CombatCtx } from './sim_context';
import type { TeamId, Vec2 } from './types';

// Cell-blocking radius per sample and spacing between samples along the
// segment; padded so a 1-unit NavGrid cell row always closes.
const SAMPLE_RADIUS = 0.7;
const SAMPLE_SPACING = 0.5;

export interface Wall {
  id: number;
  sourceId: number;
  team: TeamId;
  a: Vec2;
  b: Vec2;
  until: number;
  // The exact points blocked at creation, replayed by the unblock.
  samples: readonly Vec2[];
}

// Raises a wall centered on `center`, perpendicular to `castDir`, shoving
// any unit standing in the footprint to the nearest walkable ground.
export function raiseWall(
  ctx: CombatCtx,
  sourceId: number,
  team: TeamId,
  center: Vec2,
  castDir: Vec2,
  length: number,
  duration: number,
): Wall {
  const len = Math.hypot(castDir.x, castDir.z);
  const dir = len > 0 ? { x: castDir.x / len, z: castDir.z / len } : { x: 1, z: 0 };
  const perp = { x: -dir.z, z: dir.x };
  const half = length / 2;
  const a = { x: center.x - perp.x * half, z: center.z - perp.z * half };
  const b = { x: center.x + perp.x * half, z: center.z + perp.z * half };
  const wall = createWallSegment(ctx, sourceId, team, a, b, duration);
  return wall;
}

// Raises a wall along an arbitrary segment (a fissure left by a skillshot).
export function createWallSegment(
  ctx: CombatCtx,
  sourceId: number,
  team: TeamId,
  a: Vec2,
  b: Vec2,
  duration: number,
): Wall {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / SAMPLE_SPACING));
  const samples: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  for (const s of samples) ctx.nav.blockCircle(s.x, s.z, SAMPLE_RADIUS);
  // Shove out anything standing in the footprint: a wall is ground, not a
  // cage, and a unit inside blocked cells could never move again.
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id) || u.moveSpeed <= 0) continue;
    if (ctx.nav.isWalkableAt(u.pos.x, u.pos.z)) continue;
    const out = ctx.nav.nearestWalkable(u.pos.x, u.pos.z, 6);
    if (out) {
      u.pos = { x: out.x, z: out.z };
      u.path = [];
    }
  }
  const wall: Wall = {
    id: ctx.allocId(),
    sourceId,
    team,
    a,
    b,
    until: ctx.time + duration,
    samples,
  };
  ctx.walls.set(wall.id, wall);
  return wall;
}

export function stepWalls(ctx: CombatCtx): void {
  for (const w of [...ctx.walls.values()]) {
    if (ctx.time < w.until) continue;
    for (const s of w.samples) ctx.nav.unblockCircle(s.x, s.z, SAMPLE_RADIUS);
    ctx.walls.delete(w.id);
  }
}

// Movement clamp for stale paths: pathfinding routes around wall cells on
// every fresh order, but a path computed BEFORE a wall rose can cross it.
// Called after a walk step whenever walls exist; lands the unit just short
// of the first unwalkable sample and drops the stale path.
export function clampThroughWalls(nav: NavGrid, from: Vec2, u: { pos: Vec2; path: Vec2[] }): void {
  const dx = u.pos.x - from.x;
  const dz = u.pos.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-9) return;
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    if (!nav.isWalkableAt(x, z)) {
      const back = Math.max(0, (i - 1) / steps);
      u.pos = { x: from.x + dx * back, z: from.z + dz * back };
      u.path = [];
      return;
    }
  }
}
