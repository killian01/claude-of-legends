// The Oathfield (docs/design/ostrand.md, CONTEXT.md: Oathfield): a closed
// ring of ability wall around a point, built from the wall primitive
// (walls.ts) as a polygon of chords, so it blocks walking, pathing and
// traveling dashes and lets projectiles and sight pass, like any wall.
// Before the stone rises every unit near the rim is set down on the side
// its center was on: inside stays inside, outside stays outside. The
// wall's own shove goes to the nearest walkable ground, which near a rim
// can be on the far side.

import { copy, dirTo, dist, heading, lerp, offset } from './geo';
import { landingOn } from './ground';
import type { CombatCtx } from './sim_context';
import type { TeamId, Vec2 } from './types';
import type { Unit } from './unit';
import { createWallSegment, type Wall } from './walls';

export const OATHFIELD_CHORDS = 16;
// How far past the rim a unit is set down: the wall's blocked band (its
// sample radius, 0.7) plus a body and a margin.
const RIM_CLEAR = 1.6;
const TAU = 2 * Math.PI;
// The step a walk's line is sampled at for the rim.
const RIM_STEP = 0.25;

// The ring's corners, east first and counterclockwise.
export function oathfieldCorners(center: Vec2, radius: number): Vec2[] {
  const corners: Vec2[] = [];
  for (let i = 0; i < OATHFIELD_CHORDS; i++) {
    corners.push(offset(center, heading(center, (TAU * i) / OATHFIELD_CHORDS), radius));
  }
  return corners;
}

export function raiseOathfield(
  ctx: CombatCtx,
  sourceId: number,
  team: TeamId,
  center: Vec2,
  radius: number,
  duration: number,
  guard?: number,
): Wall[] {
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id) || u.moveSpeed <= 0) continue;
    const d = dist(center, u.pos);
    if (Math.abs(d - radius) >= RIM_CLEAR + u.radius) continue;
    const inside = d < radius;
    const dir = dirTo(center, u.pos) ?? heading(center, 0);
    const goal = offset(
      center,
      dir,
      inside ? radius - RIM_CLEAR - u.radius : radius + RIM_CLEAR + u.radius,
    );
    const landed = landingOn(ctx.ground, goal, 2);
    if (!landed) continue;
    if (dist(center, landed) < radius !== inside) continue;
    u.pos = copy(landed);
    u.path = [];
  }
  const corners = oathfieldCorners(center, radius);
  const ring: NonNullable<Wall['ring']> = { center: copy(center), radius };
  if (guard !== undefined) ring.guard = guard;
  return corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length] as Vec2;
    const wall = createWallSegment(ctx, sourceId, team, a, b, duration);
    wall.ring = ring;
    return wall;
  });
}

// Where a walk from `from` toward `to` should aim while rings stand: a goal
// across a ring's rim becomes the point where the straight line to it
// meets the rim, on the walker's own side. A person's click into a ring
// and a bot's chase of someone inside it both end standing at the stone,
// instead of a path search that finds nothing and leaves the walker frozen.
export function ringGoal(walls: ReadonlyMap<number, Wall>, from: Vec2, to: Vec2): Vec2 {
  if (walls.size === 0) return to;
  let goal = to;
  const seen = new Set<object>();
  for (const w of walls.values()) {
    const ring = w.ring;
    if (!ring || seen.has(ring)) continue;
    seen.add(ring);
    const inside = insideOathfield(ring.center, ring.radius, from);
    if (inside === insideOathfield(ring.center, ring.radius, goal)) continue;
    const edge = inside ? ring.radius - RIM_CLEAR : ring.radius + RIM_CLEAR;
    const steps = Math.max(1, Math.ceil(dist(from, goal) / RIM_STEP));
    let last = from;
    for (let i = 1; i <= steps; i++) {
      const p = lerp(from, goal, i / steps);
      const d = dist(ring.center, p);
      if (inside ? d > edge : d < edge) break;
      last = p;
    }
    goal = last;
  }
  return goal;
}

// Whether a point stands inside a ring raised at `center`.
export function insideOathfield(center: Vec2, radius: number, p: Vec2): boolean {
  return dist(center, p) < radius;
}

// The share of `amount` a champion keeps taking from `source` while it
// stands inside a guarding ring it raised and `source` stands outside it:
// spells and arrows fly over the rim, and the stone takes some of the bite.
export function oathfieldGuard(
  walls: ReadonlyMap<number, Wall>,
  source: Unit,
  target: Unit,
): number {
  if (walls.size === 0 || source.kind !== 'champion' || target.kind !== 'champion') return 1;
  for (const w of walls.values()) {
    const ring = w.ring;
    if (!ring?.guard || w.sourceId !== target.id) continue;
    if (!insideOathfield(ring.center, ring.radius, target.pos)) continue;
    if (insideOathfield(ring.center, ring.radius, source.pos)) continue;
    return 1 - ring.guard;
  }
  return 1;
}
