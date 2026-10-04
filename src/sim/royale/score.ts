// Scores and the end (ADR 0031). Respawn: a takedown scores one for its
// last hit, more on a mark (marks.ts markPayout); a death costs RESPAWN_S and the champion comes back
// at the edge of the light, away from enemies; when the last light goes
// out the best score wins, fewer deaths then the lower id breaking ties.
// One life: a death is final, the fallen are kept in order with their
// place, and the last standing wins; champions falling on the same tick
// are ordered by the health they had on the tick before, more health the
// better place, the lower id on a tie. Pure over plain records; the sim
// holds them in RoyaleState.

import { dist2, heading, type Vec3 } from '../geo';
import type { Rng } from '../rng';
import { insideCap } from './dusk';
import { along, type RoyaleGround, type RoyaleLayout, randomWalkable } from './layout';
import type { DuskCap } from './types';

export interface Standing {
  id: number;
  score: number;
  deaths: number;
}

// Best first: more takedowns, then fewer deaths, then the lower id.
export function compareStanding(a: Standing, b: Standing): number {
  return b.score - a.score || a.deaths - b.deaths || a.id - b.id;
}

// The score leader: the best standing with at least one takedown.
export function leaderOf(standings: readonly Standing[]): number | null {
  let best: Standing | null = null;
  for (const s of standings) {
    if (s.score <= 0) continue;
    if (best === null || compareStanding(s, best) < 0) best = s;
  }
  return best ? best.id : null;
}

export function respawnRanking(standings: readonly Standing[]): number[] {
  return [...standings].sort(compareStanding).map((s) => s.id);
}

export interface Fallen {
  id: number;
  // Health on the tick before the fall.
  hpBefore: number;
}

// The places of champions falling on one tick, worst first, with `alive`
// champions standing before the tick: the first out takes place `alive`,
// the next one better. When nobody is left the best of them is the winner
// (place 1).
export function placeFallen(
  fallen: readonly Fallen[],
  alive: number,
): { id: number; place: number }[] {
  const order = [...fallen].sort((a, b) => a.hpBefore - b.hpBefore || b.id - a.id);
  return order.map((f, i) => ({ id: f.id, place: alive - i }));
}

// The final ranking of One life: the winner, then the fallen from the last
// out to the first.
export function oneLifeRanking(winnerId: number | null, eliminated: readonly number[]): number[] {
  const out = winnerId !== null ? [winnerId] : [];
  for (let i = eliminated.length - 1; i >= 0; i--) {
    const id = eliminated[i]!;
    if (id !== winnerId) out.push(id);
  }
  return out;
}

// How far inside the edge a respawn stands, at most, and as a share of a
// small cap's radius.
export const EDGE_INSET_M = 4;
export const EDGE_SAMPLE = 16;

// Where a champion comes back: on a ring just inside the light's edge, the
// sampled walkable point farthest from every enemy. While the light is the
// whole planet, anywhere walkable. Never outside the light when any
// sampled point is inside it.
export function edgeOfLight(
  rng: Rng,
  cap: DuskCap,
  enemies: readonly Vec3[],
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Vec3 {
  const R = layout.radius;
  const whole = cap.radius >= 2 * R - 1e-6;
  const inset = Math.min(EDGE_INSET_M, cap.radius * 0.4);
  const ring = Math.max(0, cap.radius - inset);
  const start = rng.next() * 2 * Math.PI;
  let best: Vec3 | null = null;
  let bestD = -1;
  for (let k = 0; k < EDGE_SAMPLE; k++) {
    let p: Vec3 | null;
    if (whole) p = randomWalkable(rng, layout, ground, 20);
    else {
      const angle = start + (k * 2 * Math.PI) / EDGE_SAMPLE;
      const q = along(cap.center, heading(cap.center, angle) as Vec3, ring, R);
      p = ground.walkable(q) ? q : ground.nearestWalkable(q);
    }
    if (!p || !insideCap(cap, p)) continue;
    let d = Number.POSITIVE_INFINITY;
    for (const e of enemies) {
      const de = dist2(p, e);
      if (de < d) d = de;
    }
    if (d > bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best) return best;
  const center = ground.walkable(cap.center) ? cap.center : ground.nearestWalkable(cap.center);
  return center ?? cap.center;
}
