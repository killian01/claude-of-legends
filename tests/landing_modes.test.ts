// What the landing says an account opens (ui/landing_modes.ts): which
// three they are, and that each one is still the play tile it stands
// for, so the door and the room behind it wear the same paintings.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAY_TILES, tileArtUrl } from '../src/ui/home_tiles';
import {
  HERO_PLAY,
  HERO_QUIET,
  HERO_STAR_CALL,
  LANDING_MODES,
  PLAY_NOW,
  PLAY_NOW_CALL,
  PRACTICE_ALONE,
  PRACTICE_ALONE_CALL,
  PRACTICE_ART,
} from '../src/ui/landing_modes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the landing modes', () => {
  it('are the three an account opens, and each is a play tile', () => {
    // Named rather than filtered off a layout flag: every tile stands at
    // full height on the home now, so the shape of the row no longer says
    // which modes the front door should name. These three do, because a
    // private lobby and the practice match are not why anybody signs up.
    expect(LANDING_MODES.map((m) => m.id)).toEqual(['ranked', 'bots', 'forge']);
    for (const mode of LANDING_MODES) {
      expect(PLAY_TILES.some((t) => t.id === mode.id)).toBe(true);
    }
  });

  it('leave the practice match out, and give it its own painting', () => {
    // The free door is not one of the three: nobody makes an account for
    // the offline match. It wears a painting all the same, and the tile's
    // own, or the landing reads as one offer and one footnote under it.
    expect(LANDING_MODES.some((m) => m.id === 'practice')).toBe(false);
    const tile = PLAY_TILES.find((t) => t.id === 'practice');
    expect(tile).toBeDefined();
    expect(PRACTICE_ART).toBe(tileArtUrl(tile?.art ?? ''));
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

  // The door that needs nothing says where the match is, not what it
  // lacks: "offline" read as a lesser game to a visitor who came to play.
  it('call the free match a match in the browser, never offline', () => {
    expect(PLAY_NOW_CALL).toMatch(/browser/i);
    expect(PLAY_NOW_CALL).not.toMatch(/offline/i);
  });
});

describe("the landing hero's row", () => {
  // The first screen on every device carries the way to play: the card's
  // gold button sat under the fold on a laptop and a phone held sideways,
  // and the only gold thing above it was the repository's star.
  it('makes its gold button the Play now card button, to the Guest queue', () => {
    expect(HERO_PLAY).toBe(PLAY_NOW);
    expect(PLAY_NOW).toEqual({ call: PLAY_NOW_CALL, kind: 'guest' });
  });

  it('keeps the offline match one quiet line under it', () => {
    expect(HERO_QUIET).toBe(PRACTICE_ALONE);
    expect(PRACTICE_ALONE).toEqual({ call: PRACTICE_ALONE_CALL, kind: 'offline' });
    expect(PRACTICE_ALONE.call).toMatch(/offline/i);
  });

  it('asks for the star without naming it the way to play', () => {
    expect(HERO_STAR_CALL).toMatch(/github/i);
    expect(HERO_STAR_CALL).not.toMatch(/play/i);
  });

  it('builds both gold buttons from the one door, outlining the star', () => {
    // Read off the page module rather than a browser: the hero's button and
    // the card's are the same door, so neither can come to do something the
    // other does not, and the repository beside the hero is not gold.
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    expect(landing).toContain("doorButton(HERO_PLAY, 'menu-btn pg-play')");
    expect(landing).toContain("doorButton(PLAY_NOW, 'menu-btn pg-play')");
    expect(landing).toContain("buildRepoLink('hero', HERO_STAR_CALL, 'outline')");
    expect(landing).not.toMatch(/finish\(\{ kind: '(guest|offline)' \}\)/);
  });
});
