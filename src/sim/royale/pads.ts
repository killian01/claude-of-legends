// Launch pads (CONTEXT.md: Launch pad; ADR 0031): about ten on the
// Wanderseed, at the crossroads, each throwing a champion PAD_THROW_M along
// a fixed great circle to its `to` point. A champion standing within
// PAD_REACH_M of a pad, its walk ending there (it stopped on the pad, or
// was sent onto it), is thrown: a flight over PAD_FLIGHT_S along the great
// circle, untargetable and unable to act, landing exactly at `to`. Walking
// across a pad toward somewhere else does not throw: a path a person
// cannot see must not fling them. A champion just landed is not thrown
// again before it has moved off.

import { dist2, lerp, type Vec3 } from '../geo';
import type { Vec2 } from '../types';
import { PAD_FLIGHT_S, PAD_REACH_M, type PadSite } from './types';

export interface PadFlight {
  unitId: number;
  padId: number;
  from: Vec3;
  to: Vec3;
  startAt: number;
  endAt: number;
}

// The pads of a match, ids in layout order.
export function padSites(spots: readonly { at: Vec3; to: Vec3 }[]): PadSite[] {
  return spots.map((s, id) => ({ id, at: { ...s.at }, to: { ...s.to } }));
}

function withinReach(pad: PadSite, p: Vec2): boolean {
  return dist2(pad.at, p) <= PAD_REACH_M * PAD_REACH_M;
}

// The pad that throws a champion standing at `pos` whose walk ends at
// `dest` (null when it stands still), or null: the lowest id among the pads
// in reach of both.
export function padUnder(pads: readonly PadSite[], pos: Vec2, dest: Vec2 | null): PadSite | null {
  for (const pad of pads) {
    if (!withinReach(pad, pos)) continue;
    if (dest !== null && !withinReach(pad, dest)) continue;
    return pad;
  }
  return null;
}

export function startFlight(unitId: number, pad: PadSite, from: Vec3, time: number): PadFlight {
  return {
    unitId,
    padId: pad.id,
    from: { ...from },
    to: { ...pad.to },
    startAt: time,
    endAt: time + PAD_FLIGHT_S,
  };
}

// Where a flight stands at a time: along the great circle, exactly at `to`
// once it is over.
export function flightPos(f: PadFlight, time: number): Vec3 {
  if (time >= f.endAt) return { ...f.to };
  const t = (time - f.startAt) / (f.endAt - f.startAt);
  return lerp(f.from, f.to, t < 0 ? 0 : t) as Vec3;
}

export function flightOver(f: PadFlight, time: number): boolean {
  return time >= f.endAt;
}

// The trip a pad saves: from `from` to `goal`, walking straight against
// walking to the pad and riding it. Positive when the pad is shorter.
export function padSaving(pad: PadSite, from: Vec2, goal: Vec2, walkSpeed: number): number {
  const walk = Math.sqrt(dist2(from, goal)) / walkSpeed;
  const ride =
    Math.sqrt(dist2(from, pad.at)) / walkSpeed +
    PAD_FLIGHT_S +
    Math.sqrt(dist2(pad.to, goal)) / walkSpeed;
  return walk - ride;
}
