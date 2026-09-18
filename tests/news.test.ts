// The news (src/ui/news_entries.ts, src/ui/news.ts). Two things are
// pinned: the table itself, since an entry is content a stranger reads
// and a broken date or a missing image is a broken page; and the rules
// the section and the landing read the table through.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countdownText,
  DAY_MS,
  dayText,
  FRESH_DAYS,
  isFresh,
  isPinned,
  newestOf,
  orderNews,
} from '../src/ui/news';
import { NEWS, NEWS_DESTINATIONS, type NewsEntry } from '../src/ui/news_entries';
import { newsImageUrl } from '../src/ui/news_images';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the table', () => {
  it('has entries, dated as UTC days, newest first', () => {
    expect(NEWS.length).toBeGreaterThan(0);
    let last = Number.POSITIVE_INFINITY;
    for (const e of NEWS) {
      expect(e.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const t = Date.parse(`${e.day}T00:00:00Z`);
      expect(Number.isNaN(t)).toBe(false);
      expect(t).toBeLessThanOrEqual(last);
      last = t;
    }
  });

  it('names every entry once, with something to read', () => {
    const titles = new Set<string>();
    for (const e of NEWS) {
      expect(e.title.trim().length).toBeGreaterThan(0);
      expect(titles.has(e.title)).toBe(false);
      titles.add(e.title);
      expect(e.body.length).toBeGreaterThan(0);
      for (const p of e.body) expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it('is plain text: no dash, no emoji, no URL', () => {
    // The project's own rule on dashes and emojis, and a link is a
    // destination inside the site, never a URL in the prose.
    for (const e of NEWS) {
      for (const text of [e.title, ...e.body]) {
        expect(text).not.toMatch(/[\u2013\u2014]/);
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(text).not.toMatch(/https?:\/\//);
      }
    }
  });

  it('has every image it names in the build, hashed like an asset', () => {
    // The pictures are assets of the bundle (src/ui/news_images.ts), so a
    // replaced one reaches every browser at once; a name the build does
    // not carry would be a broken picture on the page.
    for (const e of NEWS) {
      if (e.image === undefined) continue;
      expect(e.image).toMatch(/^[a-z0-9-]+\.webp$/);
      const file = path.join(ROOT, 'src', 'ui', 'news_art', e.image);
      expect(`${e.image}: ${existsSync(file)}`).toBe(`${e.image}: true`);
      expect(`${e.image}: ${newsImageUrl(e.image) !== null}`).toBe(`${e.image}: true`);
    }
  });

  it('links only where the page can go', () => {
    for (const e of NEWS) {
      if (e.link === undefined) continue;
      expect(NEWS_DESTINATIONS).toContain(e.link.to);
      expect(e.link.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives an event a time that parses', () => {
    for (const e of NEWS) {
      if (e.at === undefined) continue;
      expect(Number.isNaN(Date.parse(e.at))).toBe(false);
    }
  });
});

const entry = (day: string, title: string, over: Partial<NewsEntry> = {}): NewsEntry => ({
  day,
  title,
  body: ['x'],
  ...over,
});

const NOW = Date.parse('2026-09-13T12:00:00Z');

describe('the order', () => {
  it('is newest first', () => {
    const got = orderNews([entry('2026-09-01', 'a'), entry('2026-09-11', 'b')], NOW);
    expect(got.map((e) => e.title)).toEqual(['b', 'a']);
  });

  it('pins an event ahead of the clock at the top, the nearest first', () => {
    const got = orderNews(
      [
        entry('2026-09-11', 'update'),
        entry('2026-09-01', 'far', { at: '2026-09-20T20:00:00Z' }),
        entry('2026-09-02', 'near', { at: '2026-09-14T20:00:00Z' }),
      ],
      NOW,
    );
    expect(got.map((e) => e.title)).toEqual(['near', 'far', 'update']);
  });

  it('lets a past event take its place by day', () => {
    // Once the evening is over, the announcement is an ordinary entry
    // from the day it was posted.
    const got = orderNews(
      [entry('2026-09-11', 'update'), entry('2026-09-01', 'gone', { at: '2026-09-12T20:00:00Z' })],
      NOW,
    );
    expect(got.map((e) => e.title)).toEqual(['update', 'gone']);
    expect(isPinned(got[1]!, NOW)).toBe(false);
  });

  it('is what the landing shows first', () => {
    expect(newestOf([], NOW)).toBeNull();
    expect(
      newestOf(
        [entry('2026-09-11', 'b'), entry('2026-09-01', 'a', { at: '2026-10-01T00:00:00Z' })],
        NOW,
      )?.title,
    ).toBe('a');
  });
});

describe('the dot on the bar', () => {
  it('shows while the newest entry is under a week old', () => {
    expect(isFresh([entry('2026-09-11', 'a')], NOW)).toBe(true);
    expect(isFresh([entry('2026-09-01', 'a')], NOW)).toBe(false);
    // The boundary: seven whole days is no longer fresh.
    const edge = new Date(NOW - FRESH_DAYS * DAY_MS).toISOString().slice(0, 10);
    expect(isFresh([entry(edge, 'a')], NOW)).toBe(false);
  });

  it('shows for an event still ahead, however old its announcement', () => {
    expect(isFresh([entry('2026-08-01', 'a', { at: '2026-09-20T20:00:00Z' })], NOW)).toBe(true);
  });

  it('never shows for an empty table', () => {
    expect(isFresh([], NOW)).toBe(false);
  });
});

describe('the words', () => {
  it('spell a day in full, off the string alone', () => {
    expect(dayText('2026-09-11')).toBe('September 11, 2026');
    expect(dayText('2026-01-05')).toBe('January 5, 2026');
  });

  it('count down in the coarsest unit that is not zero', () => {
    expect(countdownText('2026-09-13T12:20:00Z', NOW)).toBe('in 20 min');
    expect(countdownText('2026-09-13T15:00:00Z', NOW)).toBe('in 3 h');
    expect(countdownText('2026-09-15T12:00:00Z', NOW)).toBe('in 2 days');
    expect(countdownText('2026-09-13T11:00:00Z', NOW)).toBe('now');
  });
});
