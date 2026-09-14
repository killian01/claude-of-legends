// A building stands still. The renderer's combat presentation was written
// for bodies: an attacker snaps round to face its victim and hops at it,
// and its bolt leaves from its center at flight height. A tower given the
// same read as a statue twitching on its plinth and shooting from its
// waist. These are the rules that keep a structure a structure, pure so
// tests/structure_fire.test.ts can pin them; renderer.ts reads them.

import type { Vec2 } from '../sim/types';

// The kinds that never turn and never move: the towers and the Sanctum.
export const STILL_KINDS: readonly string[] = ['tower', 'sanctum'];

export function isStill(kind: string): boolean {
  return STILL_KINDS.includes(kind);
}

// Where on a structure's height its bolt is born: just under the very
// top, which is a spire or a banner on the painted towers, at the crown.
export const CROWN = 0.82;

export function crownHeight(topY: number): number {
  return topY * CROWN;
}

// How far along its flight a bolt is, by distance and not by time: from
// the structure it left to the edge of the body it will strike, which is
// where the sim ends a homing bolt. Measured on the positions the mesh is
// drawn at, so the line from the crown to the victim is straight on
// screen whatever the frame rate, the sim's catch-up, or the victim's
// own movement; a descent timed against an estimated flight reached the
// ground early and flew the last stretch flat.
export function flightProgress(from: Vec2, at: Vec2, target: Vec2, reach: number): number {
  const traveled = Math.hypot(at.x - from.x, at.z - from.z);
  const remaining = Math.max(0, Math.hypot(target.x - at.x, target.z - at.z) - reach);
  const total = traveled + remaining;
  if (total <= 0) return 1;
  return Math.min(1, traveled / total);
}

// The bolt's height above the flight line at that progress: the crown at
// birth, the line itself at the strike, never below it.
export function crownLift(topY: number, flightY: number, progress: number): number {
  const k = Math.min(1, Math.max(0, progress));
  return Math.max(0, crownHeight(topY) - flightY) * (1 - k);
}
