// The battle royale on the page (ADR 0031): the Wanderseed's own pictures
// (src/ui/royale_modes.ts), the landing's New banner over the gold button
// (src/ui/landing_modes.ts, src/ui/landing.ts), and the news that
// announces it (src/ui/news_entries.ts).

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NEW_LINE, NEW_TAG, NEW_TITLE, PLAY_NOW, PLAY_NOW_CALL } from '../src/ui/landing_modes';
import { newestOf } from '../src/ui/news';
import { NEWS } from '../src/ui/news_entries';
import { globeArt, ROYALE_ART, royaleArtUrl, viewArt } from '../src/ui/royale_modes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe("the Wanderseed's pictures", () => {
  it('ship under public/art/royale, small, at a versioned address', () => {
    for (const art of ROYALE_ART) {
      expect(royaleArtUrl(art)).toBe(`/art/royale/${art}.webp`);
      const file = path.join(ROOT, 'public', 'art', 'royale', `${art}.webp`);
      const size = statSync(file).size;
      // A landing that waits on a picture is a landing a phone leaves.
      expect(`${art}: ${size < 60_000}`).toBe(`${art}: true`);
      expect(readFileSync(file).subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
  });

  it('wear the globe in daylight for Respawn and fallen into the Dusk for One life', () => {
    expect(globeArt('respawn')).toBe('globe');
    expect(globeArt('one_life')).toBe('globe_dusk');
    expect(viewArt('respawn')).toBe('view');
    expect(viewArt('one_life')).toBe('view_dusk');
  });

  it('stand where the drawn orbs stood, the drawn one kept only behind the picture', () => {
    const emblem = readFileSync(path.join(ROOT, 'src/ui/planet_emblem.ts'), 'utf8');
    expect(emblem).toContain('royaleArtUrl(globeArt(variant))');
    const tiles = readFileSync(path.join(ROOT, 'src/ui/royale_tiles.ts'), 'utf8');
    expect(tiles).toContain('royaleArtUrl(viewArt(mode.variant))');
  });
});

describe("the landing's New banner", () => {
  it('names the planet and says what one does there, in one line', () => {
    expect(NEW_TAG).toBe('New');
    expect(NEW_TITLE).toBe('The Wanderseed');
    expect(NEW_LINE).toBe(
      'Fifty champions on a small planet you can walk all the way round. Land where you like, ' +
        'loot, stay in the light.',
    );
  });

  it('stands at the top of the Play now card, right over the gold button that plays it', () => {
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    expect(landing).toContain('playCard.append(banner, presence, playBtn, wayList);');
    // No fine print under the button: the banner and the three ways say it
    // (the maintainer, 2026-10-03).
    expect(landing).not.toContain('bots in every empty seat');
    // The gold button still plays Respawn, and still says where it plays.
    expect(PLAY_NOW.play).toEqual({ to: 'royale', variant: 'respawn' });
    expect(PLAY_NOW_CALL).toBe('Play in the browser now');
  });
});

describe('the news of the battle royale', () => {
  const entry = NEWS.find((e) => e.day === '2026-10-03');

  it('is the newest entry, so the landing shows it', () => {
    expect(entry).toBeDefined();
    expect(newestOf(NEWS, Date.parse('2026-10-03T12:00:00Z'))).toBe(entry);
    expect(entry?.image).toBe('wanderseed.webp');
    expect(entry?.link?.to).toBe('play');
  });

  it('says the bots are named and marked, never hidden', () => {
    const text = (entry?.body ?? []).join(' ');
    expect(text).toMatch(/bot mark/);
    expect(text).toMatch(/Respawn/);
    expect(text).toMatch(/One life/);
    expect(text).not.toMatch(/invisible|indistinguishable|cannot tell|can't tell/i);
  });
});
