// What the landing says an account opens (ui/landing_modes.ts): which
// three they are, and that each one is still the play tile it stands
// for, so the door and the room behind it wear the same paintings.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAY_TILES, tileArtUrl } from '../src/ui/home_tiles';
import { JOIN_CALL, LADDER_HEADING, ladderLead } from '../src/ui/landing_ladder';
import {
  ACCOUNT_LINE,
  CLASSIC_ART,
  HERO_RANKED_LINE,
  LANDING_MODES,
  LANDING_WAYS,
  PLAY_NOW,
  PLAY_NOW_CALL,
  PLAY_NOW_LINE,
} from '../src/ui/landing_modes';
import { CLASSIC_TITLE, ONE_LIFE_LINE, RESPAWN_LINE } from '../src/ui/royale_modes';

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

  it('leave the practice match out, and paint the 5v5 as a match against people', () => {
    // The free door is not one of the three: nobody makes an account for
    // a Guest's match. Among its ways in, the 5v5 wears the ranked tile's
    // painting, a match against people, and not the offline practice
    // field's (2026-10-02).
    expect(LANDING_MODES.some((m) => m.id === 'practice')).toBe(false);
    const tile = PLAY_TILES.find((t) => t.id === 'ranked');
    expect(tile).toBeDefined();
    expect(CLASSIC_ART).toBe(tileArtUrl(tile?.art ?? ''));
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
  // Play now launches Respawn (ADR 0031): the gold button is the battle
  // royale as a Guest, no longer the 5v5's public queue.
  it("sends the gold button to the battle royale's Respawn, as a Guest", () => {
    expect(PLAY_NOW).toEqual({
      call: PLAY_NOW_CALL,
      kind: 'guest',
      play: { to: 'royale', variant: 'respawn' },
    });
  });

  it('offers the two rule sets of the battle royale and the 5v5, a row each', () => {
    expect(LANDING_WAYS.map((w) => w.id)).toEqual(['respawn', 'one_life', 'classic']);
    expect(LANDING_WAYS.map((w) => w.title)).toEqual(['Respawn', 'One life', CLASSIC_TITLE]);
    expect(CLASSIC_TITLE).toBe('Classic 5v5');
    // Respawn's row is the gold button's own door, so the two cannot differ.
    expect(LANDING_WAYS[0]?.door).toBe(PLAY_NOW);
    expect(LANDING_WAYS.map((w) => w.door.play)).toEqual([
      { to: 'royale', variant: 'respawn' },
      { to: 'royale', variant: 'one_life' },
      { to: 'classic' },
    ]);
    for (const way of LANDING_WAYS) expect(way.door.kind).toBe('guest');
  });

  it('says the rules of each in a line, the same words the home uses', () => {
    expect(RESPAWN_LINE).toBe(
      'Fifty champions on a small planet. Come back five seconds after a death; the most ' +
        'takedowns when the last light goes out wins.',
    );
    expect(ONE_LIFE_LINE).toBe('Fifty champions, one life each. The last one standing wins.');
    expect(LANDING_WAYS[0]?.line).toBe(RESPAWN_LINE);
    expect(LANDING_WAYS[1]?.line).toBe(ONE_LIFE_LINE);
    expect(LANDING_WAYS[2]?.line).toMatch(/Star Orchard/);
  });

  it('shows the way to play once, in the Play now card, and asks for no star', () => {
    // Read off the page module rather than a browser. A copy of the card's
    // gold button in the hero, right above the card, read as the same
    // button twice (2026-09-30): the door is built once. The star the hero
    // asked for beside it nobody gave (2026-10-02): the hero asks for
    // nothing but the match, and the bar names GitHub like any link.
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    const count = (needle: string): number => landing.split(needle).length - 1;
    expect(count('doorButton(PLAY_NOW,')).toBe(1);
    expect(landing).not.toMatch(/star on github/i);
    expect(count('buildRepoLink(')).toBe(1);
    expect(landing).toContain("navLink('GitHub', REPO)");
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

  // Said once, in the hero: the Play now card and the ladder each said it
  // again in their own words, until the page read as one promise three
  // times (the maintainer, 2026-10-02).
  it('says no account and the ladder from the first match once, in the hero', () => {
    const said = [
      HERO_RANKED_LINE,
      PLAY_NOW_CALL,
      PLAY_NOW_LINE,
      ...LANDING_WAYS.map((w) => w.line),
      ACCOUNT_LINE,
      LADDER_HEADING,
      JOIN_CALL,
      ladderLead({ total: 21 }),
    ];
    const times = (re: RegExp): number => said.filter((s) => re.test(s)).length;
    expect(times(/no account/i)).toBe(1);
    expect(times(/every match/i)).toBe(1);
    expect(times(/install/i)).toBe(0);
    expect(PLAY_NOW_LINE).not.toMatch(/unranked/i);
  });

  it('says an account keeps the points on every device and opens the rest', () => {
    expect(ACCOUNT_LINE).toMatch(/points on every device/i);
    for (const mode of ['ranked', 'bots', 'forge']) {
      expect(ACCOUNT_LINE.toLowerCase()).toContain(mode);
    }
  });
});
