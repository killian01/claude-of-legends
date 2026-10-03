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

import {
  DARK_BURN,
  DARK_ESCALATE_S,
  DUSK_EDGE_SPEED,
  DUSK_MAX_SHIFT,
  DUSK_PHASES,
  FINAL_RING_M,
  FINAL_RING_MIN,
} from '../content/dusk';
import { dist, dist2, heading, lerp, settle, type Vec3 } from '../geo';
import type { Rng } from '../rng';
import {
  along,
  nearPole,
  type RoyaleGround,
  type RoyaleLayout,
  randomAround,
  randomSpherePoint,
} from './layout';
import { type DuskCap, type DuskState, PLAY_S } from './types';

export interface DuskSchedule {
  // Sim time of landing: every phase time is counted from it.
  landAt: number;
  radius: number;
  // Where the last light stands.
  final: Vec3;
  // caps[0] the whole planet (centered on caps[1]), caps[1..5] the phases'.
  caps: DuskCap[];
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

// The most a phase's center may slide while it closes: what the edge
// speed allows past the shrink, and never more than a share of the shrink.
export function maxShift(phase: number, radius: number): number {
  const def = DUSK_PHASES[phase - 1]!;
  const before = phase === 1 ? 2 * radius : DUSK_PHASES[phase - 2]!.radius;
  const shrink = before - def.radius;
  const allowance = DUSK_EDGE_SPEED * (def.closeTo - def.closeFrom) - shrink;
  return Math.max(0, Math.min(DUSK_MAX_SHIFT * shrink, allowance));
}

export function drawDusk(
  rng: Rng,
  layout: RoyaleLayout,
  ground: RoyaleGround,
  landAt: number,
): DuskSchedule {
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
  return { landAt, radius: R, final, caps };
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
  const first = DUSK_PHASES[0]!;
  if (t < first.closeFrom) {
    return {
      phase: 0,
      now: copyCap(s.caps[0]!),
      next: copyCap(s.caps[1]!),
      phaseEndsAt: s.landAt + first.closeFrom,
      shrinking: false,
      burn: 0,
    };
  }
  for (let k = 1; k <= DUSK_PHASES.length; k++) {
    const def = DUSK_PHASES[k - 1]!;
    if (t < def.closeTo) {
      const f = (t - def.closeFrom) / (def.closeTo - def.closeFrom);
      return {
        phase: k,
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
        phase: k,
        now: copyCap(s.caps[k]!),
        next: after ? copyCap(after) : null,
        phaseEndsAt: s.landAt + def.holdTo,
        shrinking: false,
        burn: def.burn,
      };
    }
  }
  return {
    phase: DUSK_PHASES.length + 1,
    now: { center: { ...s.final }, radius: 0 },
    next: null,
    phaseEndsAt: s.landAt + PLAY_S,
    shrinking: false,
    burn: darkBurn(t - PLAY_S),
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
  return dist2(cap.center, p) <= cap.radius * cap.radius;
}

// How far inside the light a point stands, meters of chord to the edge
// (negative outside): what a bot reads to stay ahead of it.
export function depthInside(cap: DuskCap, p: Vec3): number {
  return cap.radius - dist(cap.center, p);
}
