// The way to a first cache (CONTEXT.md: Cache), decided without the DOM:
// until the own champion opens a cache this match, an edge arrow points at
// the nearest one standing in the light while none is on the screen
// (ui/royale_edges.ts places it, after every other arrow). A Seedfall's
// cache has its own arrow and is left out. Pure: the mode's block as the
// last snapshot told it, the champion's point and whether it opened one.

import type { SnapCache, SnapRoyale } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';
import { arcDistance } from './royale_moments';
import { outsideLight } from './royale_text';

// The plain cache's glow (render/planet_marks.ts CACHE_LOOKS), so the dial
// reads as the chest it points at.
export const CACHE_ARROW_COLOR = '#a8c8ff';

export interface CacheTarget {
  key: 'cache';
  kind: 'cache';
  cacheId: number;
  at: Vec3;
  // A cache counts nothing down.
  secondsLeft?: never;
}

export function cacheTarget(
  r: (Pick<SnapRoyale, 'st' | 'dusk'> & { caches: readonly SnapCache[] }) | null,
  self: { x: number; y?: number; z: number } | null,
  opened: boolean,
): CacheTarget | null {
  if (opened || !self || r?.st !== 'play') return null;
  let best: CacheTarget | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of r.caches) {
    if (c[4] === 2) continue;
    const at = { x: c[1], y: c[2], z: c[3] };
    if (outsideLight(at, r.dusk) === true) continue;
    const d = arcDistance(self, at);
    if (d < bestD) {
      bestD = d;
      best = { key: 'cache', kind: 'cache', cacheId: c[0], at };
    }
  }
  return best;
}
