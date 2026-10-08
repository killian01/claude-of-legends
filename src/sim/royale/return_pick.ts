// Where a Respawn champion comes back when it picked (CONTEXT.md:
// Respawn). A dead seat taps the globe during its wait (Sim.pickDrop: the
// 'drop' action and command, taken while dead, the same pick the drop
// takes; the last pick wins), and its return is set down at that pick
// rather than at the edge of the light: the pick brought inside the light
// it comes back to (score.ts returnCap) at an Arrival's depth (drop.ts
// deepInLight), snapped to walkable ground away from the poles, and at
// least RETURN_CLEAR_M from every champion standing, so a return is never
// set down in someone's reach. When the pick itself is not such a point,
// the rings around it are searched, RETURN_RING_M apart out to
// RETURN_RINGS of them, RETURN_HEADINGS fixed headings each, and the
// nearest ring holding one gives the point farthest from every champion
// (the first heading on a tie); with none, the edge of the light as
// without a pick (score.ts edgeOfLight). No draw from the match's stream.
// The 5 s wait held nothing but a count: it now holds a choice.

import { dist2, dot, heading, unit, type Vec3 } from '../geo';
import { arrivalDepth, deepInLight, snapLanding } from './drop';
import { along, nearPole, type RoyaleGround, type RoyaleLayout } from './layout';
import type { DuskCap, RoyaleStage, RoyaleVariant } from './types';

export const RETURN_CLEAR_M = 10;
export const RETURN_RING_M = 3;
export const RETURN_RINGS = 8;
export const RETURN_HEADINGS = 12;
// How much deeper than an Arrival's depth a pick outside it is brought,
// so the rounding of the way in never leaves it a hair short.
export const INTO_MARGIN_M = 0.5;

// Whether a seat may pick where it comes back now: its champion dead in
// Respawn's play. One life's fall is final, and the drop has its own pick.
export function takesReturnPick(
  variant: RoyaleVariant,
  stage: RoyaleStage,
  dead: boolean,
): boolean {
  return variant === 'respawn' && stage === 'play' && dead;
}

// The point on the great circle from `center` toward `p`, `d` meters of
// chord from the center, on the sphere of `radius`. With p at the center
// or its antipode (no way toward it), the center.
export function towardOnCircle(center: Vec3, p: Vec3, d: number, radius: number): Vec3 {
  const r2 = dot(center, center);
  if (r2 <= 0) return center;
  const r = Math.sqrt(r2);
  const n = { x: center.x / r, y: center.y / r, z: center.z / r };
  const along0 = dot(p, n);
  const v = { x: p.x - along0 * n.x, y: p.y - along0 * n.y, z: p.z - along0 * n.z };
  // Less than a micrometer across: the pick is the center (or its antipode).
  if (dot(v, v) < 1e-12) return center;
  const t = unit(v);
  if (!t || t.y === undefined) return center;
  // Chord d subtends the angle whose cosine is 1 - d^2 / (2 R^2).
  const c = Math.max(-1, Math.min(1, 1 - (d * d) / (2 * radius * radius)));
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  return {
    x: radius * (c * n.x + s * t.x),
    y: radius * (c * n.y + s * t.y),
    z: radius * (c * n.z + s * t.z),
  };
}

// A pick brought into the light at an Arrival's depth: the pick itself
// when it stands there, else the point toward it from the light's center
// just past that depth from the edge (what the globe shows the person
// too, render/planet_stage.ts).
export function intoLight(pick: Vec3, cap: DuskCap, radius: number): Vec3 {
  if (deepInLight(cap, pick, radius)) return pick;
  const depth = arrivalDepth(cap, radius) + INTO_MARGIN_M;
  return towardOnCircle(cap.center, pick, Math.max(0, cap.radius - depth), radius);
}

// The return at a pick (see above): null when no point near it will do.
export function returnSpot(
  pick: Vec3,
  cap: DuskCap,
  champions: readonly Vec3[],
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Vec3 | null {
  const R = layout.radius;
  const clear2 = RETURN_CLEAR_M * RETURN_CLEAR_M;
  const nearest = (q: Vec3): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const c of champions) {
      const d = dist2(q, c);
      if (d < best) best = d;
    }
    return best;
  };
  const fits = (q: Vec3 | null): q is Vec3 =>
    q !== null && !nearPole(q, R) && deepInLight(cap, q, R) && nearest(q) >= clear2;
  const base = intoLight(pick, cap, R);
  const at = snapLanding(base, layout, ground);
  if (fits(at)) return at;
  for (let ring = 1; ring <= RETURN_RINGS; ring++) {
    const s = ring * RETURN_RING_M;
    let best: Vec3 | null = null;
    let bestD = -1;
    for (let k = 0; k < RETURN_HEADINGS; k++) {
      const dir = heading(base, (k * 2 * Math.PI) / RETURN_HEADINGS) as Vec3;
      const q = snapLanding(along(base, dir, s, R), layout, ground);
      if (!fits(q)) continue;
      const d = nearest(q);
      if (d > bestD) {
        best = q;
        bestD = d;
      }
    }
    if (best) return best;
  }
  return null;
}
