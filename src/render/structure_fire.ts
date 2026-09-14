// A building stands still. The renderer's combat presentation was written
// for bodies: an attacker snaps round to face its victim and hops at it,
// and its bolt leaves from its center at flight height. A tower given the
// same read as a statue twitching on its plinth and shooting from its
// waist. These are the rules that keep a structure a structure, pure so
// tests/structure_fire.test.ts can pin them; renderer.ts reads them.

import type { SpawnOffset } from './muzzle_spawn';

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

// The offset from the sim's spawn (the structure's center, at flight
// height) to the crown: straight up, never below the flight line.
export function crownSpawnOffset(topY: number, flightY: number): SpawnOffset {
  return { x: 0, y: Math.max(0, crownHeight(topY) - flightY), z: 0 };
}

// A bolt that never comes down looks like a miss, one that drops in a beat
// looks like it fell: the descent from the crown takes the whole flight,
// so the shot reads as a line from the crown onto its victim. Never
// shorter than the beat a champion's muzzle gets, never longer than a
// bolt could plausibly be in the air.
export const MAX_DESCENT_MS = 1500;

export function descentMs(distance: number, speed: number, floorMs: number): number {
  if (!(speed > 0) || !(distance > 0)) return floorMs;
  return Math.min(MAX_DESCENT_MS, Math.max(floorMs, (distance / speed) * 1000));
}
