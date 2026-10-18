// The way to a first cache (ui/royale_cache_arrow.ts): until the own
// champion opens one, the nearest cache standing in the light is pointed
// at, after every other arrow (ui/royale_edges.ts), its line naming it.

import { describe, expect, it } from 'vitest';
import type { SnapCache, SnapDusk } from '../src/net/royale_wire';
import { cacheTarget } from '../src/ui/royale_cache_arrow';
import { EDGE_PRIORITY, type EdgeTarget, type EdgeView, edgeArrows } from '../src/ui/royale_edges';

const R = 80;
// A point of the sphere `deg` degrees from the north pole toward +x.
function onPlanet(deg: number): { x: number; y: number; z: number } {
  const a = (deg * Math.PI) / 180;
  return { x: R * Math.sin(a), y: R * Math.cos(a), z: 0 };
}
function cache(id: number, deg: number, kind: 0 | 1 | 2 = 0): SnapCache {
  const p = onPlanet(deg);
  return [id, p.x, p.y, p.z, kind];
}
// Lit everywhere (the calm), or a cap round the north pole of chord `r`.
const CALM = { p: 0, c: [0, R, 0], r: 500 } as unknown as SnapDusk;
const CAP = { p: 2, c: [0, R, 0], r: 30 } as unknown as SnapDusk;
const me = onPlanet(10);

function view(caches: SnapCache[], dusk = CALM, st: 'play' | 'drop' = 'play') {
  return { st, dusk, caches };
}

describe('the way to a first cache', () => {
  it('points at the nearest standing cache', () => {
    const t = cacheTarget(view([cache(1, 40), cache(2, 14), cache(3, -20)]), me, false);
    expect(t?.cacheId).toBe(2);
    expect(t?.kind).toBe('cache');
    expect(t?.at.x).toBeCloseTo(onPlanet(14).x);
  });

  it('stops once the champion opened a cache this match', () => {
    expect(cacheTarget(view([cache(1, 14)]), me, true)).toBeNull();
  });

  it('points nowhere during the drop, nor with no cache standing', () => {
    expect(cacheTarget(view([cache(1, 14)], CALM, 'drop'), me, false)).toBeNull();
    expect(cacheTarget(view([]), me, false)).toBeNull();
    expect(cacheTarget(null, me, false)).toBeNull();
  });

  it("leaves out a Seedfall's cache, which has its own arrow", () => {
    expect(cacheTarget(view([cache(1, 12, 2), cache(2, 30)]), me, false)?.cacheId).toBe(2);
  });

  it('never points into the Dusk', () => {
    // 14 degrees out stands inside the cap's 30 m chord, -40 outside it.
    const caches = [cache(1, -40), cache(2, 14)];
    expect(cacheTarget(view(caches, CAP), onPlanet(-30), false)?.cacheId).toBe(2);
    expect(cacheTarget(view([cache(1, -40)], CAP), me, false)).toBeNull();
  });
});

describe("the cache's arrow", () => {
  const VIEW: EdgeView = { width: 1280, height: 720, top: 14, right: 26, bottom: 38, left: 26 };
  const off = (key: string, kind: EdgeTarget['kind'], distance: number): EdgeTarget => ({
    key,
    kind,
    x: -400,
    y: 300,
    behind: false,
    distance,
  });

  it('ranks after every other arrow', () => {
    expect(EDGE_PRIORITY.at(-1)).toBe('cache');
    const arrows = edgeArrows(
      [off('cache', 'cache', 5), off('ri', 'rising', 80), off('ab', 'ablaze', 60)],
      VIEW,
    );
    expect(arrows.map((a) => a.key)).toEqual(['ri', 'ab', 'cache']);
  });

  it('names what it points at beside the distance', () => {
    const [a] = edgeArrows([off('cache', 'cache', 23.4)], VIEW);
    expect(a?.label).toBe('Cache 23 m');
  });

  it('stands down while the cache is on the screen', () => {
    const seen: EdgeTarget = { ...off('cache', 'cache', 8), x: 700, y: 400 };
    expect(edgeArrows([seen], VIEW)).toEqual([]);
  });
});
