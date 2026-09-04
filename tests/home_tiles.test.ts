// The home's play tiles (ui/home_tiles.ts): the four ways into a match in
// their order, the Ranked tile the only hero, and the champion it wears
// moving on every visit without ever doubling a small tile's face.

import { describe, expect, it } from 'vitest';
import { nextVisit, playTiles, RANKED_ART, rankedArt } from '../src/ui/home_tiles';

describe('the play tiles', () => {
  it('stand in order, Ranked the one hero with its call to action', () => {
    const tiles = playTiles(0);
    expect(tiles.map((t) => t.mode)).toEqual(['queue', 'forge-queue', 'create', 'practice']);
    expect(tiles.map((t) => t.title)).toEqual([
      'Ranked',
      'Forge queue',
      'Private lobby',
      'Practice',
    ]);
    expect(tiles.filter((t) => t.hero).map((t) => t.mode)).toEqual(['queue']);
    expect(tiles[0]?.cta).toBe('Play online');
    expect(tiles.slice(1).every((t) => t.cta === null)).toBe(true);
    for (const t of tiles) expect(t.art.length).toBeGreaterThan(0);
  });

  it('cycles the Ranked face through the roster, one per visit, and wraps', () => {
    const n = RANKED_ART.length;
    for (let visit = 0; visit < n; visit++) {
      expect(rankedArt(visit)).toBe(RANKED_ART[visit]);
      expect(playTiles(visit)[0]?.art).toEqual([RANKED_ART[visit]]);
    }
    expect(rankedArt(n)).toBe(RANKED_ART[0]);
    expect(rankedArt(2 * n + 3)).toBe(RANKED_ART[3]);
    expect(rankedArt(-1)).toBe(RANKED_ART[n - 1]);
    expect(rankedArt(Number.NaN)).toBe(RANKED_ART[0]);
    expect(rankedArt(1.9)).toBe(RANKED_ART[1]);
  });

  it('never shows one champion twice in the row', () => {
    for (let visit = 0; visit < RANKED_ART.length; visit++) {
      const faces = playTiles(visit).flatMap((t) => t.art);
      expect(new Set(faces).size).toBe(faces.length);
    }
  });
});

describe('the visit counter', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
      store,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
  }

  it('counts from zero and moves on each call', () => {
    const s = fakeStorage();
    expect(nextVisit(s)).toBe(0);
    expect(nextVisit(s)).toBe(1);
    expect(nextVisit(s)).toBe(2);
  });

  it('treats junk, a refusal, or no storage at all as the first visit', () => {
    expect(nextVisit(fakeStorage({ 'loc:home-visits': 'many' }))).toBe(0);
    expect(nextVisit(fakeStorage({ 'loc:home-visits': '-4' }))).toBe(0);
    expect(nextVisit(null)).toBe(0);
    const refused = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(nextVisit(refused)).toBe(0);
  });

  it('rounds a fractional count down and still moves on', () => {
    const s = fakeStorage({ 'loc:home-visits': '2.7' });
    expect(nextVisit(s)).toBe(2);
    expect(s.store.get('loc:home-visits')).toBe('3');
  });
});
