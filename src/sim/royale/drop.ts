// The drop (CONTEXT.md: Drop; ADR 0031): DROP_S seconds over the globe to
// pick a landing point, a person through Sim.pickDrop, a bot through its
// policy. When the drop ends every champion lands: at its pick, snapped to
// the nearest walkable ground, or, with no pick, somewhere quiet: the
// walkable point farthest from every pick and every landing already
// placed, among a sample drawn from the match's stream.

import { dist2, settle, type Vec3 } from '../geo';
import type { Rng } from '../rng';
import { nearPole, type RoyaleGround, type RoyaleLayout, randomWalkable } from './layout';

// How many candidate points a quiet landing weighs.
export const QUIET_SAMPLE = 48;

// A pick as the drop keeps it: on the sphere, away from the poles' spires
// (a pick there is pushed off along the meridian by the snap below).
export function normalizePick(p: Vec3, radius: number): Vec3 | null {
  if (![p.x, p.y, p.z].every(Number.isFinite)) return null;
  if (p.x * p.x + p.y * p.y + p.z * p.z < 1e-6) return null;
  return settle(p, radius) as Vec3;
}

// The walkable ground point a pick lands on.
export function snapLanding(p: Vec3, layout: RoyaleLayout, ground: RoyaleGround): Vec3 | null {
  if (ground.walkable(p) && !nearPole(p, layout.radius)) return p;
  return ground.nearestWalkable(p);
}

function nearestTo(p: Vec3, others: readonly Vec3[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const o of others) {
    const d = dist2(p, o);
    if (d < best) best = d;
  }
  return best;
}

// The quiet spot: the sampled walkable point farthest from `taken`.
export function quietSpot(
  rng: Rng,
  layout: RoyaleLayout,
  ground: RoyaleGround,
  taken: readonly Vec3[],
  sample = QUIET_SAMPLE,
): Vec3 {
  let best: Vec3 | null = null;
  let bestD = -1;
  for (let i = 0; i < sample; i++) {
    const p = randomWalkable(rng, layout, ground, 20);
    if (!p) continue;
    const d = taken.length === 0 ? 0 : nearestTo(p, taken);
    if (d > bestD) {
      best = p;
      bestD = d;
    }
    if (taken.length === 0) break;
  }
  return best ?? layout.regions[0]?.heart ?? { x: layout.radius, y: 0, z: 0 };
}

// Every seat's landing, in the order given (the sim passes unit ids
// ascending): the picks first, each snapped, then the quiet spots for the
// seats that picked nothing, each away from everything placed before it.
export function resolveLandings(
  seats: readonly number[],
  picks: ReadonlyMap<number, Vec3>,
  rng: Rng,
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Map<number, Vec3> {
  const out = new Map<number, Vec3>();
  const taken: Vec3[] = [];
  const unpicked: number[] = [];
  for (const id of seats) {
    const pick = picks.get(id);
    const at = pick ? snapLanding(pick, layout, ground) : null;
    if (at) {
      out.set(id, at);
      taken.push(at);
    } else unpicked.push(id);
  }
  for (const id of unpicked) {
    const at = quietSpot(rng, layout, ground, taken);
    out.set(id, at);
    taken.push(at);
  }
  return out;
}
