// Where each seat of a bout has looked (ADR 0035; docs/design/thornfray.md,
// How a bot plays a bout): the Thornyard's lookouts, fixed at the start
// from its heart and its radius (every bush inside it, then rings
// SWEEP_STEP_M apart, each point on walkable ground), and for every seat
// the sim time each lookout was last in its own sight, as a champion
// standing there would be (vision.ts seesSpot: a bush hides it past the
// close sight, a rock past its line). What a person remembers of where
// they have been and what they saw: the observation shows each seat its
// own (ObsBout.sweep), and Lastwick's hunt (royale/bot/bout_calls.ts
// huntCall) walks toward the light it has not seen. Plain data on
// RoyaleState.bout, carried by the checkpoint; stepped every
// SWEEP_EVERY_TICKS once the seats land. Draws nothing from any stream.

import { dist, heading, type Vec3 } from '../../geo';
import type { ObsSweep } from '../../policy';
import type { Sim } from '../../sim';
import { brushIndexAt, seesSpot } from '../../vision';
import { insideCap } from '../dusk';
import { along, type RoyaleGround, type RoyaleLayout } from '../layout';
import type { RoyaleMode } from '../mode';
import type { DuskCap } from '../types';

// How far apart the lookouts' rings stand, and their points along each:
// under a champion's twelve meters of sight, so a walk past a ring sees
// its points on both sides.
export const SWEEP_STEP_M = 8;
// How often each seat's memory is written: every quarter second.
export const SWEEP_EVERY_TICKS = 5;
// A lookout's memory before the seat ever saw it.
export const NEVER_SEEN = -1;

// The Thornyard's lookouts: the bushes standing inside it first, then the
// rings around its heart, each point snapped to walkable ground within
// half a step and still inside, none within half a step of one kept.
export function boutLookouts(yard: DuskCap, layout: RoyaleLayout, ground: RoyaleGround): Vec3[] {
  const R = layout.radius;
  const half = SWEEP_STEP_M / 2;
  const out: Vec3[] = [];
  const keep = (p: Vec3): void => {
    const q = ground.nearestWalkable(p);
    if (!q || dist(q, p) > half || !insideCap(yard, q)) return;
    for (const o of out) if (dist(o, q) < half) return;
    out.push(q);
  };
  for (const b of layout.bushes ?? []) if (insideCap(yard, b.at)) keep(b.at);
  for (let k = 0; k * SWEEP_STEP_M <= yard.radius; k++) {
    const d = k * SWEEP_STEP_M;
    if (k === 0) {
      keep(yard.center);
      continue;
    }
    const n = Math.round((2 * Math.PI * d) / SWEEP_STEP_M);
    for (let j = 0; j < n; j++) {
      // Each ring turned half a point from the one inside it.
      const angle = (2 * Math.PI * (j + (k % 2) / 2)) / n;
      keep(along(yard.center, heading(yard.center, angle) as Vec3, d, R));
    }
  }
  return out;
}

// A fresh seat's memory: every lookout never seen.
export function unseen(mode: RoyaleMode): number[] {
  return new Array<number>(mode.lookouts.length).fill(NEVER_SEEN);
}

// Each lookout's bush on the bout's map (brushIndexAt), worked out once.
const brushes = new WeakMap<readonly Vec3[], number[]>();
function lookoutBrush(mode: RoyaleMode, sim: Sim): number[] {
  let out = brushes.get(mode.lookouts);
  if (!out) {
    out = mode.lookouts.map((p) => brushIndexAt(sim.map, p));
    brushes.set(mode.lookouts, out);
  }
  return out;
}

// Every SWEEP_EVERY_TICKS of the play: each standing seat's memory of the
// lookouts in its sight, set to now.
export function stepSweep(mode: RoyaleMode, sim: Sim): void {
  const b = mode.state.bout;
  if (!b?.started || mode.state.stage !== 'play') return;
  if (sim.tickCount % SWEEP_EVERY_TICKS !== 0) return;
  const at = mode.lookouts;
  if (at.length === 0) return;
  const brush = lookoutBrush(mode, sim);
  b.seats.forEach((id, seat) => {
    const u = sim.units.get(id);
    const seen = b.swept[seat];
    if (!u || u.dead || !seen || u.pos.y === undefined) return;
    const mine = brushIndexAt(sim.map, u.pos);
    for (let i = 0; i < at.length; i++) {
      if (seesSpot(sim.map, u, mine, at[i]!, brush[i]!, sim.time)) seen[i] = sim.time;
    }
  });
}

// A seat's lookouts as its observation shows them: where each stands and
// when the seat last saw it (null never).
export function observeSweep(mode: RoyaleMode, seat: number): ObsSweep[] {
  const seen = mode.state.bout?.swept[seat];
  return mode.lookouts.map((p, i) => {
    const t = seen?.[i] ?? NEVER_SEEN;
    return { x: p.x, y: p.y, z: p.z, seen: t === NEVER_SEEN ? null : t };
  });
}
