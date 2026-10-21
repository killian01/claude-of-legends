// Temporary ability walls (kits-v2): a straight segment of impassable
// ground raised by a cast and gone seconds later. A wall blocks pathing,
// walking, and traveling dashes exactly like map terrain, because it blocks
// the same ground cells terrain does (ground.ts); projectiles and sight pass
// over it. Every blocked sample is remembered so expiry unblocks the exact
// cells. On the planet the segment is an arc of a great circle.

import { basis, carry, copy, dist, lerp, offset, turnLeft, unit } from './geo';
import type { Ground } from './ground';
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
  // A chord of a closed ring (oathfield.ts): the ring's center and radius,
  // which a walk across it is aimed at the rim by.
  ring?: { center: Vec2; radius: number };
}

// Raises a wall centered on `center`, perpendicular to `castDir` (a heading
// or a delta taken near the center, carried onto it), shoving any unit
// standing in the footprint to the nearest walkable ground.
export function raiseWall(
  ctx: CombatCtx,
  sourceId: number,
  team: TeamId,
  center: Vec2,
  castDir: Vec2,
  length: number,
  duration: number,
): Wall {
  const dir = carry(unit(castDir) ?? basis(center).east, center, center);
  const perp = turnLeft(dir, center);
  const half = length / 2;
  const a = offset(center, perp, -half);
  const b = offset(center, perp, half);
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
  const samples = blockWall(ctx.ground, a, b);
  // Shove out anything standing in the footprint: a wall is ground, not a
  // cage, and a unit inside blocked cells could never move again.
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id) || u.moveSpeed <= 0) continue;
    if (ctx.ground.isWalkableAt(u.pos)) continue;
    const out = ctx.ground.nearestWalkable(u.pos, 6);
    if (out) {
      u.pos = copy(out);
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

// Blocks the ground a wall from a to b stands on, and returns the points
// it blocked for unblockWall to free: the sim's own walls, and the walls a
// snapshot tells the client's prediction, which walks the same ground
// (src/net/self_predict.ts).
export function blockWall(ground: Pick<Ground, 'blockCircle'>, a: Vec2, b: Vec2): Vec2[] {
  const steps = Math.max(1, Math.ceil(dist(a, b) / SAMPLE_SPACING));
  const samples: Vec2[] = [];
  for (let i = 0; i <= steps; i++) samples.push(lerp(a, b, i / steps));
  for (const s of samples) ground.blockCircle(s, SAMPLE_RADIUS);
  return samples;
}

export function unblockWall(ground: Pick<Ground, 'unblockCircle'>, samples: readonly Vec2[]): void {
  for (const s of samples) ground.unblockCircle(s, SAMPLE_RADIUS);
}

export function stepWalls(ctx: CombatCtx): void {
  for (const w of [...ctx.walls.values()]) {
    if (ctx.time < w.until) continue;
    unblockWall(ctx.ground, w.samples);
    ctx.walls.delete(w.id);
  }
}

// Movement clamp for stale paths: pathfinding routes around wall cells on
// every fresh order, but a path computed BEFORE a wall rose can cross it.
// Called after a walk step whenever walls exist; lands the unit just short
// of the first unwalkable sample and drops the stale path.
export function clampThroughWalls(
  ground: Pick<Ground, 'isWalkableAt'>,
  from: Vec2,
  u: { pos: Vec2; path: Vec2[] },
): void {
  const to = u.pos;
  const d = dist(from, to);
  if (d < 1e-9) return;
  const steps = Math.max(1, Math.ceil(d / 0.3));
  for (let i = 1; i <= steps; i++) {
    if (!ground.isWalkableAt(lerp(from, to, i / steps))) {
      u.pos = lerp(from, to, Math.max(0, (i - 1) / steps));
      u.path = [];
      return;
    }
  }
}
