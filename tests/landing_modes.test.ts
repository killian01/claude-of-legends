// What the landing says an account opens (ui/landing_modes.ts): which
// three they are, and that each one is still the play tile it stands
// for, so the door and the room behind it wear the same paintings.

import { describe, expect, it } from 'vitest';
import { PLAY_TILES, tileArtUrl } from '../src/ui/home_tiles';
import { LANDING_MODES } from '../src/ui/landing_modes';

describe('the landing modes', () => {
  it('are the three modes the home stands at full height', () => {
    // The hero and the tall tiles (ui/home_tiles.ts): ranked, which a
    // visitor already knows the shape of, and the two nothing else in the
    // genre has. The home gives those three the whole height of its row,
    // and the landing names exactly them.
    expect(LANDING_MODES.map((m) => m.id)).toEqual(
      PLAY_TILES.filter((t) => t.tall || t.hero).map((t) => t.id),
    );
  });

  it('wear the painting their tile wears', () => {
    for (const mode of LANDING_MODES) {
      const tile = PLAY_TILES.find((t) => t.id === mode.id);
      expect(tile).toBeDefined();
      expect(mode.art).toBe(tileArtUrl(tile?.art ?? ''));
    }
  });

  // The landing draws the title alone: the paintings say what a bot and a
  // forge are better than a sentence under them does. The line stays in
  // the data because it is what the mode IS, and the tile still reads it.
  it('say more than a name, and less than the tile does', () => {
    for (const mode of LANDING_MODES) {
      const tile = PLAY_TILES.find((t) => t.id === mode.id);
      expect(mode.title.length).toBeGreaterThan(0);
      expect(mode.line.length).toBeGreaterThan(40);
      expect(mode.line.length).toBeLessThan(tile?.line.length ?? 0);
    }
  });
});
