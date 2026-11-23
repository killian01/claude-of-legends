// Emberstray's goal (CONTEXT.md: Emberstray, Glow; docs/design/emberstray.md):
// the glow, one 'circle' primitive that rests and drifts across the heart
// of the Thornyard. Its whole route is drawn at landing on the bout's
// stream and kept in the goal's slot (plain numbers the checkpoint
// carries): the Thornyard's heart first (unless a pole's landmark stands
// there), then GLOW_STOPS stops, each drawn within GLOW_ROAM_M of the
// heart, away from the poles, and GLOW_MIN_LEG_M to GLOW_MAX_LEG_M from the
// stop before. It rests GLOW_REST_S at a stop,
// then drifts to the next at GLOW_DRIFT_MPS, slower than any champion
// walks, so a champion inside it can stay inside it. Where it stands is a
// function of the seconds since landing alone. The roam is held inside
// every light the bout's one closing can leave (40 m to 34 m, its center
// sliding at most 0.8 of the shrink, 4.8 m: a ring of GLOW_RADIUS_M whose
// heart stands within 23.2 m of the Thornyard's stays lit to the clock, and
// GLOW_ROAM_M is 20; tests/thornfray_bout_emberstray.test.ts holds it
// on every region). The count is the shared held-time scorer
// (count.ts heldTimeScorer): every champion standing in the glow counts
// its seconds. Its holder, for the color it is drawn in, is the champion
// standing in it nearest its heart (ties to the lower seat), null when
// none stands in it.

import type { BoutGoal, BoutView, GoalPrimitive } from '../../content/bouts/types';
import { dist, dist2, lerp, settle, type Vec3 } from '../../geo';
import type { Rng } from '../../rng';
import { along, nearPole, randomHeading } from '../layout';

export const GLOW_GOAL_ID = 'glow';
export const GLOW_RADIUS_M = 6;
export const GLOW_ROAM_M = 20;
export const GLOW_STOPS = 8;
export const GLOW_MIN_LEG_M = 14;
export const GLOW_MAX_LEG_M = 26;
export const GLOW_REST_S = 12;
export const GLOW_DRIFT_MPS = 2;
// The poles' landmarks: a stop stands this far off them, its ring's inner
// edge 8 m off.
const POLE_KEEP_M = 14;
const DRAWS = 12;

// The route's stops from the slot's numbers (x, y, z by stop).
export function glowRoute(nums: readonly number[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < nums.length; i += 3) {
    out.push({ x: nums[i]!, y: nums[i + 1]!, z: nums[i + 2]! });
  }
  return out;
}

// A stop drawn within the roam of the heart, away from the poles, and,
// after a stop, GLOW_MIN_LEG_M to GLOW_MAX_LEG_M from it: the first of
// DRAWS draws that is, else the draw off the poles nearest the legs'
// bounds, else the stop before (or the heart).
function drawStop(rng: Rng, heart: Vec3, R: number, before: Vec3 | null): Vec3 {
  let fallback: Vec3 | null = null;
  let fallbackMiss = Number.POSITIVE_INFINITY;
  for (let t = 0; t < DRAWS; t++) {
    const s = GLOW_ROAM_M * Math.max(rng.next(), rng.next());
    const p = along(heart, randomHeading(rng, heart), s, R);
    if (nearPole(p, R, POLE_KEEP_M)) continue;
    if (!before) return p;
    const leg = dist(before, p);
    const miss = Math.max(0, GLOW_MIN_LEG_M - leg, leg - GLOW_MAX_LEG_M);
    if (miss === 0) return p;
    if (miss < fallbackMiss) {
      fallback = p;
      fallbackMiss = miss;
    }
  }
  return fallback ?? { ...(before ?? heart) };
}

// The route drawn at landing: the Thornyard's heart first (a stop drawn in
// its place when the heart stands on a pole's landmark, as the Sanctuary's
// and the Open ground's do), then GLOW_STOPS stops (drawStop).
export function drawGlowRoute(bout: BoutView, rng: Rng): Vec3[] {
  const heart = bout.thornyard.center;
  const R = dist(heart, { x: 0, y: 0, z: 0 });
  const first = nearPole(heart, R, POLE_KEEP_M) ? drawStop(rng, heart, R, null) : { ...heart };
  const route: Vec3[] = [first];
  for (let k = 0; k < GLOW_STOPS; k++) {
    route.push(drawStop(rng, heart, R, route[route.length - 1]!));
  }
  return route;
}

// Where the glow stands `s` seconds after landing on its route: resting
// at a stop, or drifting along the leg to the next; at the last stop once
// the route is walked.
export function glowAt(route: readonly Vec3[], s: number): Vec3 {
  const R = dist(route[0]!, { x: 0, y: 0, z: 0 });
  let t = Math.max(0, s);
  for (let i = 0; i < route.length - 1; i++) {
    if (t < GLOW_REST_S) return { ...route[i]! };
    t -= GLOW_REST_S;
    const a = route[i]!;
    const b = route[i + 1]!;
    const legS = dist(a, b) / GLOW_DRIFT_MPS;
    if (t < legS) return settle(lerp(a, b, legS > 0 ? t / legS : 1), R) as Vec3;
    t -= legS;
  }
  return { ...route[route.length - 1]! };
}

// Whether the glow is drifting `s` seconds after landing (the bots step
// along with it).
export function glowDrifting(route: readonly Vec3[], s: number): boolean {
  let t = Math.max(0, s);
  for (let i = 0; i < route.length - 1; i++) {
    if (t < GLOW_REST_S) return false;
    t -= GLOW_REST_S;
    const legS = dist(route[i]!, route[i + 1]!) / GLOW_DRIFT_MPS;
    if (t < legS) return true;
    t -= legS;
  }
  return false;
}

function holderOf(bout: BoutView, p: GoalPrimitive): number | null {
  const r2 = p.radius * p.radius;
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let seat = 0; seat < bout.seatCount; seat++) {
    const s = bout.seat(seat);
    if (!s || s.dead || !s.pos) continue;
    const d = dist2(s.pos, p.at);
    if (d > r2 || d >= bestD) continue;
    best = seat;
    bestD = d;
  }
  return best;
}

function place(bout: BoutView): void {
  const slot = bout.goal(GLOW_GOAL_ID);
  const route = glowRoute(slot.nums);
  if (route.length === 0) return;
  const at = glowAt(route, bout.time - bout.landAt);
  const prim: GoalPrimitive = { shape: 'circle', at, radius: GLOW_RADIUS_M, holder: null };
  prim.holder = holderOf(bout, prim);
  slot.prims = [prim];
}

export const glowGoal: BoutGoal = {
  id: GLOW_GOAL_ID,
  start(bout, rng) {
    const slot = bout.goal(GLOW_GOAL_ID);
    slot.nums = [];
    for (const p of drawGlowRoute(bout, rng)) slot.nums.push(p.x, p.y, p.z);
    place(bout);
  },
  step(bout) {
    place(bout);
  },
  primitives: (bout) => bout.goal(GLOW_GOAL_ID).prims,
};
