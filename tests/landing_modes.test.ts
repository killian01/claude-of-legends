// What the landing says about the two modes behind the door
// (ui/landing_modes.ts): which two they are, and that each one is still
// the play tile it stands for.

import { describe, expect, it } from 'vitest';
import { PLAY_TILES, tileArtUrl } from '../src/ui/home_tiles';
import { LANDING_MODES } from '../src/ui/landing_modes';

describe('the landing modes', () => {
  it('are the two modes the home stands at full height', () => {
    // The tall tiles are the two modes nothing else in the genre has
    // (ui/home_tiles.ts), which is exactly why the front door names them.
    expect(LANDING_MODES.map((m) => m.id)).toEqual(
      PLAY_TILES.filter((t) => t.tall).map((t) => t.id),
    );
  });

  it('wear the painting their tile wears', () => {
    for (const mode of LANDING_MODES) {
      const tile = PLAY_TILES.find((t) => t.id === mode.id);
      expect(tile).toBeDefined();
      expect(mode.art).toBe(tileArtUrl(tile?.art ?? ''));
    }
  });

  it('say more than a name, and less than the tile does', () => {
    for (const mode of LANDING_MODES) {
      const tile = PLAY_TILES.find((t) => t.id === mode.id);
      expect(mode.title.length).toBeGreaterThan(0);
      expect(mode.line.length).toBeGreaterThan(40);
      expect(mode.line.length).toBeLessThan(tile?.line.length ?? 0);
    }
  });
});
