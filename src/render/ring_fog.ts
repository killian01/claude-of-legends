// How open the fog of war stands over a ring's disc while its creature
// rises: the rise out of the fire column is for everybody to watch (the
// maintainer, 2026-09-30), so the whole circle clears from the rise
// through the creature's emerge and roar and a moment after, then the
// fog closes back over a short fade. Presentation only: the fog canvas
// is paint, and what either team may see of the units on the ring is
// still the sim's call (Sim.isVisible). Pure, so it is tested from node.

import { EMERGE_S, ROAR_S } from './pyrefang_rise';

// Seconds after the rise the circle stays wide open, then the fade.
export const RING_FOG_OPEN_S = EMERGE_S + ROAR_S + 2;
export const RING_FOG_FADE_S = 2;
// Meters of soft edge past the disc's own radius.
export const RING_FOG_EDGE = 3;

// 1 for a circle wide open, 0 for the fog as usual. `age` is seconds since
// the creature rose, null when none stands on the ring.
export function ringFogOpening(age: number | null): number {
  if (age === null || age < 0) return 0;
  if (age <= RING_FOG_OPEN_S) return 1;
  const t = (age - RING_FOG_OPEN_S) / RING_FOG_FADE_S;
  return t >= 1 ? 0 : 1 - t;
}
