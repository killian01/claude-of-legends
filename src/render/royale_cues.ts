// Between the battle royale's HUD and the renderer (the loud moments): the
// HUD decides a moment (ui/royale_moments.ts) and the renderer shows its
// part of it in the world (a takedown's punch and heal, a cache flipping
// open, an opening broken); the renderer projects the planet's points so
// the HUD can point at what is off the screen and hear what is behind.
// Neither holds the other: the match's presentation builds both apart
// (game/boot.ts), so they meet here. One renderer at a time draws a match.

import type { Vec3 } from '../sim/geo';

// What the HUD asks the world to show.
export type RoyaleCue =
  // The viewer took a champion down: the camera punches in, and the heal
  // the takedown gave floats green over the champion.
  | { kind: 'takedown'; heal: number }
  // A cache opened (the viewer's, or one they saw): it goes at once, its
  // lid flips in gold sparks under a short column.
  | { kind: 'cache_open'; cacheId: number }
  // The viewer's opening was broken: a red ring at the cache.
  | { kind: 'cache_crack'; cacheId: number }
  // A seed crashed down: a shockwave and dust at its point, a flash up its
  // column, and the camera shaken by `shake` (by the viewer's distance).
  | { kind: 'seedfall_land'; at: Vec3; shake: number };

// A planet point as the screen has it, in the stage's pixels (game/
// match_stage.ts), off the screen when it is; `behind` when it stands
// behind the camera (the point is then mirrored through the middle);
// `hidden` when the planet stands between it and the camera (past the
// horizon it still projects onto the globe's disc, inside the screen).
export interface CueProjection {
  x: number;
  y: number;
  behind: boolean;
  hidden?: boolean;
}

export interface RoyaleProjector {
  // A sphere point lifted `lift` meters off its ground.
  project(p: Vec3, lift: number): CueProjection | null;
  // Radians off the camera's forward along the ground from the followed
  // champion, positive to the right: a sound's pan, and the way to point
  // at what the planet hides.
  bearing(p: Vec3): number | null;
  // Where the followed champion stands on the sphere, for distances.
  self(): Vec3 | null;
  // The screen in the stage's pixels.
  view(): { width: number; height: number };
}

const listeners = new Set<(cue: RoyaleCue) => void>();
let projector: RoyaleProjector | null = null;

export function sendRoyaleCue(cue: RoyaleCue): void {
  for (const fn of listeners) fn(cue);
}

// Listens for cues; the answer stops listening.
export function onRoyaleCue(fn: (cue: RoyaleCue) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setRoyaleProjector(p: RoyaleProjector | null): void {
  projector = p;
}

// The projector of the renderer drawing the planet, if one is.
export function royaleProjector(): RoyaleProjector | null {
  return projector;
}

// Drops a projector, only when it is still the one standing (a new match's
// renderer may have taken over first).
export function clearRoyaleProjector(p: RoyaleProjector): void {
  if (projector === p) projector = null;
}
