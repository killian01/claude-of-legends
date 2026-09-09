// The home's play tiles (ui/home_tiles.ts): the six ways to get into a
// match in their order, what each one does, and the painting each wears.

import { describe, expect, it } from 'vitest';
import { PLAY_TILES, type PlayMode, tileArtUrl } from '../src/ui/home_tiles';

describe('the play tiles', () => {
  it('stand in order, Ranked the one hero', () => {
    expect(PLAY_TILES.map((t) => t.id)).toEqual([
      'ranked',
      'bots',
      'forge',
      'lobby',
      'practice',
      'orchard',
    ]);
    expect(PLAY_TILES.map((t) => t.title)).toEqual([
      'Ranked',
      'Bots',
      'Forge queue',
      'Private lobby',
      'Practice',
      'Star Orchard',
    ]);
    expect(PLAY_TILES.filter((t) => t.hero).map((t) => t.id)).toEqual(['ranked']);
  });

  it('covers every play mode once, and sends Bots to the Academy', () => {
    const modes = PLAY_TILES.flatMap((t) => (t.goes.to === 'mode' ? [t.goes.mode] : []));
    const expected: PlayMode[] = ['queue', 'forge-queue', 'create', 'practice', 'orchard'];
    expect(modes.sort()).toEqual([...expected].sort());
    const bots = PLAY_TILES.find((t) => t.id === 'bots');
    expect(bots?.goes).toEqual({ to: 'section', key: 'academy' });
  });

  it("stands every mode at Ranked's own height", () => {
    // The private lobby and the practice match used to be two small
    // squares stacked beside the others. A mode is either offered or it is
    // not, so all five stand at the hero's height now and the row is six
    // upright scenes.
    expect(PLAY_TILES.filter((t) => t.tall).map((t) => t.id)).toEqual([
      'bots',
      'forge',
      'lobby',
      'practice',
      'orchard',
    ]);
    // Hero and tall are the big shapes and never the same tile.
    expect(PLAY_TILES.every((t) => !(t.hero && t.tall))).toBe(true);
  });

  it('carries a call to action on every tile, since every tile is big now', () => {
    // The rule has not moved: a tile standing at full height carries a
    // button. What moved is which tiles stand at full height, and a tall
    // scene with no button beside four that have one reads as unfinished
    // rather than as restrained.
    const withCta = PLAY_TILES.filter((t) => t.cta !== null).map((t) => t.id);
    expect(withCta).toEqual(['ranked', 'bots', 'forge', 'lobby', 'practice', 'orchard']);
    expect(PLAY_TILES.every((t) => (t.cta !== null) === (t.hero || t.tall))).toBe(true);
    expect(PLAY_TILES.find((t) => t.id === 'ranked')?.cta).toBe('Play online');
  });

  it('wears one painting and one accent each, none shared', () => {
    const art = PLAY_TILES.map((t) => t.art);
    expect(new Set(art).size).toBe(art.length);
    expect(new Set(PLAY_TILES.map((t) => t.accent)).size).toBe(PLAY_TILES.length);
    for (const t of PLAY_TILES) {
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.line.length).toBeGreaterThan(0);
    }
  });

  it('says on the tile itself that the Star Orchard is a test', () => {
    const orchard = PLAY_TILES.find((t) => t.id === 'orchard')!;
    expect(orchard.goes).toEqual({ to: 'mode', mode: 'orchard' });
    expect(orchard.line.toLowerCase()).toContain('test');
    expect(orchard.line.toLowerCase()).toContain('offline');
  });

  it('resolves the painting to the tile art folder', () => {
    expect(tileArtUrl('ranked')).toBe('/art/tiles/ranked.webp');
    for (const t of PLAY_TILES) expect(tileArtUrl(t.art)).toBe(`/art/tiles/${t.art}.webp`);
  });
});
