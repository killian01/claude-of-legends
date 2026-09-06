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

  it('call the visitor to a verb, in a few words', () => {
    // What the landing actually draws under each name. A third of a band
    // is a narrow column: anything longer than a handful of words wraps
    // past the two lines the foot scrim has room for.
    for (const mode of LANDING_MODES) {
      expect(mode.call.length).toBeGreaterThan(8);
      expect(mode.call.length).toBeLessThan(24);
      expect(mode.call.split(' ').length).toBeLessThanOrEqual(4);
    }
  });

  // The line is what the mode IS, at a length only the home's tile has
  // room for. The landing draws the call instead, but the line stays in
  // the data: it is what pins each mode to the tile it stands for.
  it('say more than a name, and less than the tile does', () => {
    for (const mode of LANDING_MODES) {
      const tile = PLAY_TILES.find((t) => t.id === mode.id);
      expect(mode.title.length).toBeGreaterThan(0);
      expect(mode.line.length).toBeGreaterThan(40);
      expect(mode.line.length).toBeLessThan(tile?.line.length ?? 0);
    }
  });
});
