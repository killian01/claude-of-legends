// The drop (CONTEXT.md: Drop; ADR 0031): DROP_S seconds over the globe to
// pick a landing point, a person through Sim.pickDrop, a bot through its
// policy. When the drop ends every champion lands: at its pick, snapped to
// the nearest walkable ground, or, with no pick, somewhere quiet: the
// walkable point farthest from every pick and every landing already
// placed, among a sample drawn from the match's stream. Then a house bot
// or two comes down beside each person (escortLandings).

import { dist2, norm, settle, type Vec3 } from '../geo';
import type { Rng } from '../rng';
import { depthInside, insideCap } from './dusk';
import {
  along,
  nearPole,
  type RoyaleGround,
  type RoyaleLayout,
  randomHeading,
  randomWalkable,
} from './layout';
import type { DuskCap, RoyaleVariant } from './types';

// How many candidate points a quiet landing weighs.
export const QUIET_SAMPLE = 48;

// A pick as the drop keeps it: on the sphere, away from the poles' spires
// (a pick there is pushed off along the meridian by the snap below).
export function normalizePick(p: Vec3, radius: number): Vec3 | null {
  if (![p.x, p.y, p.z].every(Number.isFinite)) return null;
  if (norm(p) < 1e-3) return null;
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

// An Arrival's spot (grace.ts arrive): somewhere quiet inside the light. A
// drop-in comes down at least ARRIVAL_QUIET_M (chord) from every other
// champion standing, at least ARRIVAL_DEPTH_M inside the light's edge (a
// share of a small light's radius), on walkable ground away from the
// poles: the first such point of ARRIVAL_SAMPLE drawn uniformly inside the
// light from the match's stream, else the farthest from everyone of them
// all (fifty seats on the planet can leave no room), else the light's
// center.
export const ARRIVAL_QUIET_M = 25;
export const ARRIVAL_DEPTH_M = 6;
export const ARRIVAL_SAMPLE = 64;

export function arrivalSpot(
  rng: Rng,
  cap: DuskCap,
  others: readonly Vec3[],
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Vec3 {
  const R = layout.radius;
  const whole = cap.radius >= 2 * R - 1e-6;
  const depth = whole ? 0 : Math.min(ARRIVAL_DEPTH_M, cap.radius * 0.4);
  const reach = Math.max(0, cap.radius - depth);
  const quiet2 = ARRIVAL_QUIET_M * ARRIVAL_QUIET_M;
  let best: Vec3 | null = null;
  let bestD = -1;
  for (let i = 0; i < ARRIVAL_SAMPLE; i++) {
    let p: Vec3 | null;
    if (whole) p = randomWalkable(rng, layout, ground, 20);
    else {
      // Uniform over the disk the light covers: the larger of two draws
      // spreads them out to its rim as the square root of one would.
      const s = reach * Math.max(rng.next(), rng.next());
      p = snapLanding(along(cap.center, randomHeading(rng, cap.center), s, R), layout, ground);
    }
    if (!p || !insideCap(cap, p) || (!whole && depthInside(cap, p) < depth)) continue;
    const d = others.length === 0 ? Number.POSITIVE_INFINITY : nearestTo(p, others);
    if (d >= quiet2) return p;
    if (d > bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best) return best;
  return snapLanding(cap.center, layout, ground) ?? cap.center;
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

// Company at the landing: ESCORTS[variant] house bots come down
// ESCORT_MIN_M to ESCORT_MAX_M from each person, so a person's first fight
// finds them within seconds, the genre's own way with its newcomers (their
// first champions come to them). Fifty seats on the planet left a person
// who landed a minute with nobody in sight, one who picked no point in the
// quietest spot there is, and the visitors of the first days closed the
// tab inside two minutes (the seat reports, 2026-10-03). One in One life,
// where a fall is final; two in Respawn. The mode deals a normal bot
// first, one that also fights the other escort, so the first fight is a
// three-way and not two victims waiting in line; gentle ones only on a
// person's very first royale (mode.ts).
export const ESCORTS: Readonly<Record<RoyaleVariant, number>> = { one_life: 1, respawn: 2 };
export const ESCORT_MIN_M = 8;
export const ESCORT_MAX_M = 13;

// One person's company: the person's seat and the bots that come down
// beside it, in order.
export interface EscortGroup {
  person: number;
  bots: readonly number[];
}

// Deals each person `count` bots from `pool`, in turn, each person taking
// the first bots of the pool as `order(person)` sorts it; a bot is dealt
// once.
export function dealEscorts(
  people: readonly number[],
  pool: readonly number[],
  count: number,
  order: (person: number) => (a: number, b: number) => number,
): EscortGroup[] {
  const left = [...pool];
  const out: EscortGroup[] = [];
  for (const person of people) {
    left.sort(order(person));
    out.push({ person, bots: left.splice(0, count) });
  }
  return out;
}

// Moves the landings of each group's bots beside its person, each at a
// heading and a reach drawn from the match's stream, snapped to walkable
// ground.
export function escortLandings(
  groups: readonly EscortGroup[],
  landings: Map<number, Vec3>,
  rng: Rng,
  layout: RoyaleLayout,
  ground: RoyaleGround,
): void {
  for (const { person, bots } of groups) {
    const at = landings.get(person);
    if (!at) continue;
    for (const bot of bots) {
      const reach = ESCORT_MIN_M + (ESCORT_MAX_M - ESCORT_MIN_M) * rng.next();
      const spot = along(at, randomHeading(rng, at), reach, layout.radius);
      const p = snapLanding(spot, layout, ground);
      if (p) landings.set(bot, p);
    }
  }
}
