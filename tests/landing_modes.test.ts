// What the landing says an account opens (ui/landing_modes.ts): which
// three they are, and that each one is still the play tile it stands
// for, so the door and the room behind it wear the same paintings.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAY_TILES, tileArtUrl } from '../src/ui/home_tiles';
import {
  ACCOUNT_LINE,
  HERO_RANKED_LINE,
  HERO_STAR_CALL,
  LANDING_MODES,
  PLAY_NOW,
  PLAY_NOW_CALL,
  PLAY_NOW_FINE,
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

describe("the landing's ways to play", () => {
  it('sends the gold button to the Guest queue', () => {
    expect(PLAY_NOW).toEqual({ call: PLAY_NOW_CALL, kind: 'guest' });
  });

  it('asks for the star in the hero without naming it the way to play', () => {
    expect(HERO_STAR_CALL).toMatch(/github/i);
    expect(HERO_STAR_CALL).not.toMatch(/play/i);
  });

  it('shows the way to play once, in the Play now card, the star outlined above', () => {
    // Read off the page module rather than a browser. A copy of the card's
    // gold button in the hero, right above the card, read as the same
    // button twice (2026-09-30): the door is built once.
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    const count = (needle: string): number => landing.split(needle).length - 1;
    expect(count('doorButton(PLAY_NOW,')).toBe(1);
    expect(landing).toContain("buildRepoLink('hero', HERO_STAR_CALL, 'outline')");
    expect(landing).not.toMatch(/finish\(\{ kind: 'guest' \}\)/);
  });

  it('has no offline practice link: visitors play online (ADR 0027)', () => {
    // The practice match stays for accounts on the home's tile, and the
    // boot still falls back to it when no Guest can be opened; the landing
    // offers it nowhere.
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    const modes = readFileSync(path.join(ROOT, 'src/ui/landing_modes.ts'), 'utf8');
    expect(landing).not.toContain('PRACTICE_ALONE');
    expect(modes).not.toContain('PRACTICE_ALONE');
    expect(landing).not.toMatch(/kind: 'offline'/);
    expect(landing).not.toMatch(/practice alone/i);
  });
});

describe('what the landing says at once (ADR 0027)', () => {
  it('says right under the tagline that every match is ranked, with no account', () => {
    expect(HERO_RANKED_LINE).toMatch(/ranked/i);
    expect(HERO_RANKED_LINE).toMatch(/ladder/i);
    expect(HERO_RANKED_LINE).toMatch(/no account/i);
    // Drawn in the hero, straight after the sentence that says it runs in
    // the browser.
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    const tagAt = landing.indexOf("'pg-tag'");
    const rankedAt = landing.indexOf("el('p', 'pg-ranked', HERO_RANKED_LINE)");
    expect(tagAt).toBeGreaterThan(0);
    expect(rankedAt).toBeGreaterThan(tagAt);
    expect(landing.slice(tagAt, rankedAt)).toMatch(/browser tab/);
  });

  it('no longer calls the free match unranked', () => {
    expect(PLAY_NOW_FINE).not.toMatch(/unranked/i);
    expect(PLAY_NOW_FINE).toMatch(/ladder/i);
    expect(PLAY_NOW_FINE).toMatch(/no account/i);
  });

  it('says an account keeps the points on every device and opens the rest', () => {
    expect(ACCOUNT_LINE).toMatch(/points on every device/i);
    for (const mode of ['ranked', 'bots', 'forge']) {
      expect(ACCOUNT_LINE.toLowerCase()).toContain(mode);
    }
  });
});
