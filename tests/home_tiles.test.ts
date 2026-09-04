// The home's play tiles (ui/home_tiles.ts): the five ways to get into a
// match in their order, what each one does, and the painting each wears.

import { describe, expect, it } from 'vitest';
import { PLAY_TILES, type PlayMode, tileArtUrl } from '../src/ui/home_tiles';

describe('the play tiles', () => {
  it('stand in order, Ranked the one hero', () => {
    expect(PLAY_TILES.map((t) => t.id)).toEqual(['ranked', 'bots', 'forge', 'lobby', 'practice']);
    expect(PLAY_TILES.map((t) => t.title)).toEqual([
      'Ranked',
      'Bots',
      'Forge queue',
      'Private lobby',
      'Practice',
    ]);
    expect(PLAY_TILES.filter((t) => t.hero).map((t) => t.id)).toEqual(['ranked']);
  });

  it('covers every play mode once, and sends Bots to the Academy', () => {
    const modes = PLAY_TILES.flatMap((t) => (t.goes.to === 'mode' ? [t.goes.mode] : []));
    const expected: PlayMode[] = ['queue', 'forge-queue', 'create', 'practice'];
    expect(modes.sort()).toEqual([...expected].sort());
    const bots = PLAY_TILES.find((t) => t.id === 'bots');
    expect(bots?.goes).toEqual({ to: 'section', key: 'academy' });
  });

  it('gives the two modes nothing else has the banner billing', () => {
    expect(PLAY_TILES.filter((t) => t.banner).map((t) => t.id)).toEqual(['bots', 'forge']);
    // Hero and banner are the big shapes and never the same tile.
    expect(PLAY_TILES.every((t) => !(t.hero && t.banner))).toBe(true);
  });

  it('carries a call to action on the three big tiles only', () => {
    const withCta = PLAY_TILES.filter((t) => t.cta !== null).map((t) => t.id);
    expect(withCta).toEqual(['ranked', 'bots', 'forge']);
    expect(PLAY_TILES.every((t) => (t.cta !== null) === (t.hero || t.banner))).toBe(true);
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

  it('resolves the painting to the tile art folder', () => {
    expect(tileArtUrl('ranked')).toBe('/art/tiles/ranked.webp');
    for (const t of PLAY_TILES) expect(tileArtUrl(t.art)).toBe(`/art/tiles/${t.art}.webp`);
  });
});
