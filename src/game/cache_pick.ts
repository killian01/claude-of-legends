// A walk ordered onto or beside a standing cache (CONTEXT.md: Cache) ends
// at the cache's middle, inside its reach, so the champion stands there and
// opens it: the point a bot walks to (sim/royale/bot/travel.ts lootCache).
// A click on the chest itself lands on the ground behind it (the lid and
// the glow stand above the feet), and a tap "beside" it easily lands past
// the reach, where standing opens nothing. Pure: the mode's caches as the
// last snapshot told them and the ground point the pointer gave.

import type { SnapCache } from '../net/royale_wire';
import { dist } from '../sim/geo';
import type { Vec2 } from '../sim/types';

// How near the ground point must be to a cache's middle, by the cache's
// kind on the wire (0 plain, 1 golden, 2 a Seedfall's): the bigger chests
// (render/planet_marks.ts CACHE_LOOKS) catch from farther.
export const CACHE_PICK_M: readonly [number, number, number] = [3, 3.4, 3.8];

export function cacheGoal(p: Vec2, caches: readonly SnapCache[] | null | undefined): Vec2 | null {
  if (!caches) return null;
  let best: Vec2 | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of caches) {
    const at = { x: c[1], y: c[2], z: c[3] };
    const d = dist(p, at);
    if (d > CACHE_PICK_M[c[4]] || d >= bestD) continue;
    best = at;
    bestD = d;
  }
  return best;
}
