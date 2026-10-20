// The Dusk's schedule (CONTEXT.md: Dusk; content/dusk.ts): drawn once from
// the match's stream at the start, then read at any time. A final point on
// walkable ground away from the poles' landmarks, five caps each inside
// the one before and all holding the final point, built backwards from it
// so every containment holds by construction (chords obey the triangle
// inequality: a cap whose center lies within r - r' of a bigger cap's
// center, r' its own radius, lies inside it). The light starts as the whole
// planet (chord radius 2R), closes toward each cap with its center sliding
// along the great circle and its radius shrinking, and holds; the last
// light goes out at PLAY_S. Every test is a squared chord against a
// squared radius (src/sim/geo.ts), no angle anywhere.
//
// A bout (ADR 0035) reads its own plan (DuskPlan): its closings, its first
// cap (the Thornyard instead of the whole planet), its edge speed, the
// burn outside that first cap before the first closing, and when the light
// goes out (lightOutS, in place of PLAY_S). Its closings are numbered from
// the end, the last always phase 5 and the dark always 6, so every reader
// of the phase number reads how near the end the light is. Its caps are
// drawn forward from the first cap's center toward a final point drawn
// inside it, each closing's slide within what its edge speed allows. With
// no plan every rule reads the planet's table (PLANET_DUSK) exactly as
// before.

import {
  DARK_BURN,
  DARK_ESCALATE_S,
  DUSK_EDGE_SPEED,
  DUSK_MAX_SHIFT,
  DUSK_PHASES,
  type DuskPhaseDef,
  FINAL_RING_M,
  FINAL_RING_MIN,
} from '../content/dusk';
import { dist, dist2, dot, heading, lerp, settle, type Vec3 } from '../geo';
import type { Rng } from '../rng';
import {
  along,
  nearPole,
  type RoyaleGround,
  type RoyaleLayout,
  randomAround,
  randomHeading,
  randomSpherePoint,
} from './layout';
import { type DuskCap, type DuskState, PLAY_S } from './types';

// The phase of the last closing, whatever the number of closings, and the
// dark's after it.
export const LAST_CLOSING_PHASE = DUSK_PHASES.length;
export const DARK_PHASE = LAST_CLOSING_PHASE + 1;

// A Dusk's plan: its closings, first to last (one to LAST_CLOSING_PHASE);
// its first cap, null for the whole planet; its edge speed; the share of
// maximum health burned outside the first cap before the first closing;
// when the last light goes out, seconds from landing.
export interface DuskPlan {
  phases: readonly DuskPhaseDef[];
  first: DuskCap | null;
  edgeSpeed: number;
  burnBefore: number;
  lightOutS: number;
}

// The planet's own plan: the battle royale's Dusk, as content/dusk.ts
// tables it.
export const PLANET_DUSK: DuskPlan = {
  phases: DUSK_PHASES,
  first: null,
  edgeSpeed: DUSK_EDGE_SPEED,
  burnBefore: 0,
  lightOutS: PLAY_S,
};

export interface DuskSchedule {
  // Sim time of landing: every phase time is counted from it.
  landAt: number;
  radius: number;
  // Where the last light stands.
  final: Vec3;
  // caps[0] the first cap (the whole planet centered on caps[1], or a
  // bout's Thornyard), then one per closing.
  caps: DuskCap[];
  // The plan the caps were drawn for.
  plan: DuskPlan;
}

// The phase number of a plan's closing k (1 for its first): numbered from
// the end, so its last is LAST_CLOSING_PHASE.
export function phaseOf(plan: DuskPlan, k: number): number {
  return LAST_CLOSING_PHASE - plan.phases.length + k;
}

function ringRoom(p: Vec3, ground: RoyaleGround, radius: number): number {
  let n = 0;
  for (let k = 0; k < 8; k++) {
    const q = along(p, heading(p, (k * Math.PI) / 4) as Vec3, FINAL_RING_M, radius);
    if (ground.walkable(q)) n++;
  }
  return n;
}

// The final point: drawn over the sphere until one lands on walkable
// ground, away from the poles, with room around it. A planet with no such
// point (a test's tiny one) falls back to the first region's heart that is
// not a pole's.
export function drawFinalPoint(rng: Rng, layout: RoyaleLayout, ground: RoyaleGround): Vec3 {
  const R = layout.radius;
  for (let i = 0; i < 400; i++) {
    const p = randomSpherePoint(rng, R);
    if (nearPole(p, R, 2 * FINAL_RING_M + 10)) continue;
    if (!ground.walkable(p)) continue;
    if (ringRoom(p, ground, R) < FINAL_RING_MIN) continue;
    return p;
  }
  const heart = layout.regions.find((r) => !nearPole(r.heart, R))?.heart;
  return heart ?? { x: R, y: 0, z: 0 };
}

// The most the center of a plan's closing k (1 for its first) may slide
// while it closes: what the edge speed allows past the shrink, and never
// more than a share of the shrink.
export function maxShift(k: number, radius: number, plan: DuskPlan = PLANET_DUSK): number {
  const def = plan.phases[k - 1]!;
  const before =
    k === 1 ? (plan.first ? plan.first.radius : 2 * radius) : plan.phases[k - 2]!.radius;
  const shrink = before - def.radius;
  const allowance = plan.edgeSpeed * (def.closeTo - def.closeFrom) - shrink;
  return Math.max(0, Math.min(DUSK_MAX_SHIFT * shrink, allowance));
}

export function drawDusk(
  rng: Rng,
  layout: RoyaleLayout,
  ground: RoyaleGround,
  landAt: number,
  plan: DuskPlan = PLANET_DUSK,
): DuskSchedule {
  if (plan.first) return drawPlannedDusk(rng, layout, ground, landAt, plan, plan.first);
  const R = layout.radius;
  const final = drawFinalPoint(rng, layout, ground);
  const n = DUSK_PHASES.length;
  const centers: Vec3[] = new Array(n + 1);
  // The last cap holds the final point within half its radius.
  const last = DUSK_PHASES[n - 1]!.radius;
  centers[n] = randomAround(rng, final, rng.next() * 0.5 * last, R);
  // Each earlier center a slide away, within what that phase allows; the
  // first phase only shrinks, so the whole planet shares its center.
  for (let k = n - 1; k >= 1; k--) {
    const shift = maxShift(k + 1, R) * (0.3 + 0.7 * rng.next());
    centers[k] = randomAround(rng, centers[k + 1]!, shift, R);
  }
  centers[0] = centers[1]!;
  const caps: DuskCap[] = centers.map((center, k) => ({
    center,
    radius: k === 0 ? 2 * R : DUSK_PHASES[k - 1]!.radius,
  }));
  return { landAt, radius: R, final, caps, plan };
}

// How much of a bout's slide budget the line toward the final point takes;
// the rest is the jitter drawn around it, so every slide stays within its
// closing's allowance (and a hair of the sphere's curve).
const PLANNED_LINE_SHARE = 0.85;
// Points drawn for a bout's final point before the fallback.
const PLANNED_FINAL_TRIES = 96;

// A bout's final point: walkable, away from the poles, with room around it,
// drawn uniformly over the disk of tangent radius `reach` around the first
// cap's center and inside it; the first cap's center itself after
// PLANNED_FINAL_TRIES misses.
function drawPlannedFinal(
  rng: Rng,
  first: DuskCap,
  reach: number,
  layout: RoyaleLayout,
  ground: RoyaleGround,
): { final: Vec3; dir: Vec3 | null; s: number } {
  const R = layout.radius;
  for (let i = 0; i < PLANNED_FINAL_TRIES; i++) {
    const s = reach * Math.max(rng.next(), rng.next());
    const dir = randomHeading(rng, first.center);
    const p = along(first.center, dir, s, R);
    if (nearPole(p, R) || !ground.walkable(p) || !insideCap(first, p)) continue;
    if (ringRoom(p, ground, R) < FINAL_RING_MIN) continue;
    return { final: p, dir, s };
  }
  return { final: { ...first.center }, dir: null, s: 0 };
}

// A bout's caps: the first cap fixed (the Thornyard), a final point drawn
// inside it within the closings' whole slide budget, and each closing's
// center on the way from the first cap's center to the final point, its
// share of the way its share of the budget, jittered within what is left:
// every slide stays within maxShift, so every cap lies inside the one
// before (chords obey the triangle inequality) and holds the final point.
function drawPlannedDusk(
  rng: Rng,
  layout: RoyaleLayout,
  ground: RoyaleGround,
  landAt: number,
  plan: DuskPlan,
  first: DuskCap,
): DuskSchedule {
  const R = layout.radius;
  const n = plan.phases.length;
  // Each step's allowance: the closings' slides, then the final point's
  // reach from the last center (half its radius, as on the planet).
  const steps: number[] = [];
  for (let k = 1; k <= n; k++) steps.push(maxShift(k, R, plan));
  steps.push(0.5 * plan.phases[n - 1]!.radius);
  let budget = 0;
  for (const g of steps) budget += g;
  const drawn = drawPlannedFinal(rng, first, PLANNED_LINE_SHARE * budget, layout, ground);
  const jitter = (1 - PLANNED_LINE_SHARE) / 2;
  const caps: DuskCap[] = [{ center: { ...first.center }, radius: first.radius }];
  let walked = 0;
  for (let k = 1; k <= n; k++) {
    walked += steps[k - 1]!;
    const on =
      drawn.dir && budget > 0
        ? along(first.center, drawn.dir, (drawn.s * walked) / budget, R)
        : { ...first.center };
    const room = jitter * Math.min(steps[k - 1]!, steps[k]!);
    const center = randomAround(rng, on, rng.next() * room, R);
    caps.push({ center, radius: plan.phases[k - 1]!.radius });
  }
  return { landAt, radius: R, final: drawn.final, caps, plan };
}

function copyCap(c: DuskCap): DuskCap {
  return { center: { ...c.center }, radius: c.radius };
}

// The cap a closing phase stands at, a fraction f of the way.
function closingCap(from: DuskCap, to: DuskCap, f: number, R: number): DuskCap {
  const center = settle(lerp(from.center, to.center, f), R) as Vec3;
  return { center, radius: from.radius + (to.radius - from.radius) * f };
}

// The Dusk at a sim time. Before landing and through the calm, phase 0 and
// the whole planet lit; phases 1 to 5 close then hold; phase 6 dark. The
// phase's end is the next change: the closing's end while it closes, the
// next closing's start while it holds.
export function duskAt(s: DuskSchedule, time: number): DuskState {
  const t = time - s.landAt;
  const R = s.radius;
  const plan = s.plan;
  const phases = plan.phases;
  const first = phases[0]!;
  if (t < first.closeFrom) {
    return {
      phase: 0,
      now: copyCap(s.caps[0]!),
      next: copyCap(s.caps[1]!),
      phaseEndsAt: s.landAt + first.closeFrom,
      shrinking: false,
      burn: plan.burnBefore,
    };
  }
  for (let k = 1; k <= phases.length; k++) {
    const def = phases[k - 1]!;
    if (t < def.closeTo) {
      const f = (t - def.closeFrom) / (def.closeTo - def.closeFrom);
      return {
        phase: phaseOf(plan, k),
        now: closingCap(s.caps[k - 1]!, s.caps[k]!, f < 0 ? 0 : f, R),
        next: copyCap(s.caps[k]!),
        phaseEndsAt: s.landAt + def.closeTo,
        shrinking: true,
        burn: def.burn,
      };
    }
    if (t < def.holdTo) {
      const after = s.caps[k + 1];
      return {
        phase: phaseOf(plan, k),
        now: copyCap(s.caps[k]!),
        next: after ? copyCap(after) : null,
        phaseEndsAt: s.landAt + def.holdTo,
        shrinking: false,
        burn: def.burn,
      };
    }
  }
  return {
    phase: DARK_PHASE,
    now: { center: { ...s.final }, radius: 0 },
    next: null,
    phaseEndsAt: s.landAt + plan.lightOutS,
    shrinking: false,
    burn: darkBurn(t - plan.lightOutS),
  };
}

// The burn once the last light is out, growing every DARK_ESCALATE_S.
export function darkBurn(pastEnd: number): number {
  const steps = pastEnd > 0 ? Math.floor(pastEnd / DARK_ESCALATE_S) : 0;
  return DARK_BURN * (1 + steps);
}

// Inside the light: within the cap's chord radius. A cap of radius zero
// (the dark) holds nothing.
export function insideCap(cap: DuskCap, p: Vec3): boolean {
  if (cap.radius <= 0) return false;
  // A cap as wide as the planet (the calm's) holds every point, its own
  // antipode too, whatever the last bit of the arithmetic says.
  if (cap.radius * cap.radius >= 4 * dot(cap.center, cap.center)) return true;
  return dist2(cap.center, p) <= cap.radius * cap.radius;
}

// How far inside the light a point stands, meters of chord to the edge
// (negative outside): what a bot reads to stay ahead of it.
export function depthInside(cap: DuskCap, p: Vec3): number {
  return cap.radius - dist(cap.center, p);
}
