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

// Whether a cap is the whole planet's light (the calm's).
function wholeLight(cap: DuskCap, radius: number): boolean {
  return cap.radius >= 2 * radius - 1e-6;
}

// How deep inside the light an Arrival comes down, and a fair first foe
// stands: ARRIVAL_DEPTH_M, a share of a small light's radius, none in the
// whole planet's.
export function arrivalDepth(cap: DuskCap, radius: number): number {
  return wholeLight(cap, radius) ? 0 : Math.min(ARRIVAL_DEPTH_M, cap.radius * 0.4);
}

// Inside the light at an Arrival's depth.
export function deepInLight(cap: DuskCap, p: Vec3, radius: number): boolean {
  if (!insideCap(cap, p)) return false;
  return wholeLight(cap, radius) || depthInside(cap, p) >= arrivalDepth(cap, radius);
}

export function arrivalSpot(
  rng: Rng,
  cap: DuskCap,
  others: readonly Vec3[],
  layout: RoyaleLayout,
  ground: RoyaleGround,
): Vec3 {
  const R = layout.radius;
  const whole = wholeLight(cap, R);
  const depth = arrivalDepth(cap, R);
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

// A Respawn Arrival's fair first fight (grace.ts arrive): a few steps from
// one bot, inside its sight (a champion's 12 m, unit.ts), with nobody else
// near either of them. 16 of 18 visitors dropped into the standing Respawn
// match, where no escort lands, 25 m from everyone (arrivalSpot): their
// first damage came 12 to 35 s after landing and 12 of the 13 with no
// takedown left by 75 s; the two who stayed to the end had a takedown
// about 10 s after first contact (the seat reports, 2026-10-08). The foes
// are weighed softest first (the skill the bot plays now, 0 gentle to 2
// strong, then its health share, its level, the lower id); one with any
// other champion within FOE_CLEAR_M is passed over, and each of the first
// FOE_MAX left gets FOE_TRIES draws from the match's stream, FOE_MIN_M to
// FOE_MAX_M away in a drawn heading, snapped to walkable ground. A draw is
// kept inside the light at an Arrival's depth, its chord to the foe within
// a meter of the band, and with nobody but the foe within FOE_CLEAR_M:
// the first kept wins; null when none is (the quiet spot then).
export const FOE_MIN_M = 9;
export const FOE_MAX_M = 11;
export const FOE_CLEAR_M = 12;
export const FOE_TRIES = 8;
export const FOE_MAX = 6;

// A bot an Arrival may come down beside, as the mode weighs it.
export interface FoeCandidate {
  id: number;
  pos: Vec3;
  // The skill it plays now (content/bots/royale_skills.ts
  // ROYALE_SKILL_RANK): 0 gentle, 1 normal, 2 strong.
  soft: number;
  hpShare: number;
  level: number;
}

export function fairFoeSpot(
  rng: Rng,
  cap: DuskCap,
  foes: readonly FoeCandidate[],
  others: readonly { id: number; pos: Vec3 }[],
  layout: RoyaleLayout,
  ground: RoyaleGround,
): { at: Vec3; foeId: number } | null {
  const R = layout.radius;
  const clear2 = FOE_CLEAR_M * FOE_CLEAR_M;
  const lo = FOE_MIN_M - 1;
  const hi = FOE_MAX_M + 1;
  const crowded = (p: Vec3, foeId: number): boolean =>
    others.some((o) => o.id !== foeId && dist2(p, o.pos) <= clear2);
  const order = [...foes].sort(
    (a, b) => a.soft - b.soft || a.hpShare - b.hpShare || a.level - b.level || a.id - b.id,
  );
  let weighed = 0;
  for (const foe of order) {
    if (weighed >= FOE_MAX) break;
    if (crowded(foe.pos, foe.id)) continue;
    weighed++;
    for (let i = 0; i < FOE_TRIES; i++) {
      const dir = randomHeading(rng, foe.pos);
      const reach = FOE_MIN_M + (FOE_MAX_M - FOE_MIN_M) * rng.next();
      const p = snapLanding(along(foe.pos, dir, reach, R), layout, ground);
      if (!p || !deepInLight(cap, p, R)) continue;
      const d2 = dist2(p, foe.pos);
      if (d2 < lo * lo || d2 > hi * hi || crowded(p, foe.id)) continue;
      return { at: p, foeId: foe.id };
    }
  }
  return null;
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
