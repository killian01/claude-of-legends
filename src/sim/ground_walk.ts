// Where a unit may be put down (ADR 0029), for the systems that place a
// unit rather than walk it: a knockback, a pull, a blink and its return, a
// leap's line, a camp or a creature rising. On the plane the navigation
// grid answers, by the very calls the sim always made, so the 5v5 rounds
// as it did. On the sphere the match's ground answers when the context
// carries one (the ground seam over the planet's grid); a sphere context
// without a ground stands on open ground, since the plane's grid cannot
// speak for a point on the sphere.

import { onSphere } from './geo';
import type { CombatCtx } from './sim_context';
import type { Vec2 } from './types';

// The ground seam as these systems ask it, by its shape alone: a context
// with a `ground` of this shape answers through it. The radius of a search
// counts the ground's cells, as the plane's grid does.
export interface GroundQueries {
  isWalkableAt(p: Vec2): boolean;
  nearestWalkable(p: Vec2, maxCells?: number): Vec2 | null;
  lineOfWalk(a: Vec2, b: Vec2): boolean;
}

function groundOf(ctx: CombatCtx): GroundQueries | undefined {
  return (ctx as CombatCtx & { readonly ground?: GroundQueries }).ground;
}

export function walkableAt(ctx: CombatCtx, p: Vec2): boolean {
  if (!onSphere(p)) return ctx.nav.isWalkableAt(p.x, p.z);
  const ground = groundOf(ctx);
  return ground ? ground.isWalkableAt(p) : true;
}

// p itself when it is walkable, else the nearest walkable point within
// maxCells (the grid's own default when absent), null when there is none.
export function landingAt(ctx: CombatCtx, p: Vec2, maxCells?: number): Vec2 | null {
  if (!onSphere(p)) {
    return ctx.nav.isWalkableAt(p.x, p.z) ? p : ctx.nav.nearestWalkable(p.x, p.z, maxCells);
  }
  const ground = groundOf(ctx);
  if (!ground) return p;
  return ground.isWalkableAt(p) ? p : ground.nearestWalkable(p, maxCells);
}

// The straight walk from a to b stays on walkable ground.
export function walkLine(ctx: CombatCtx, a: Vec2, b: Vec2): boolean {
  if (!onSphere(a) || !onSphere(b)) return ctx.nav.lineOfWalk(a, b);
  const ground = groundOf(ctx);
  return ground ? ground.lineOfWalk(a, b) : true;
}
