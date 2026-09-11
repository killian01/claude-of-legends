// The bucket a referrer falls in (src/net/pulse_source.ts). This is the
// counter that says whether an announcement reached anybody, so what is
// pinned here is that it answers with a word off the list and never with
// anything that could be read back as a link.

import { describe, expect, it } from 'vitest';
import { isVisitSource, sourceOf, sourceOfLink, VISIT_SOURCES } from '../src/net/pulse_source';

const SELF = 'https://claudeoflegends.com';

describe('the bucket a visitor arrives in', () => {
  it('is direct when there is no referrer at all', () => {
    // Typed, bookmarked, or followed from an app that sends none. A large
    // direct is not an absence of news.
    expect(sourceOf('', SELF)).toBe('direct');
  });

  it('is direct when the referrer is this site', () => {
    // A page here linking to a page here is not somewhere a visitor came
    // from, however it lands on a first load of the day.
    expect(sourceOf(`${SELF}/reset`, SELF)).toBe('direct');
  });

  it('names the places a link is likely to come from', () => {
    expect(sourceOf('https://www.reddit.com/r/gamedev/', SELF)).toBe('reddit');
    expect(sourceOf('https://discord.com/channels/1/2', SELF)).toBe('discord');
    expect(sourceOf('https://news.ycombinator.com/item?id=1', SELF)).toBe('hn');
    expect(sourceOf('https://x.com/', SELF)).toBe('x');
    expect(sourceOf('https://t.co/abcd', SELF)).toBe('x');
    expect(sourceOf('https://www.google.com/', SELF)).toBe('search');
    expect(sourceOf('https://duckduckgo.com/', SELF)).toBe('search');
    expect(sourceOf('https://github.com/someone/repo', SELF)).toBe('github');
    expect(sourceOf('https://youtu.be/abcd', SELF)).toBe('youtube');
  });

  it('follows a host onto its subdomains and not onto its lookalikes', () => {
    expect(sourceOf('https://old.reddit.com/r/x/', SELF)).toBe('reddit');
    // The suffix match is on a label boundary: notreddit.com is somebody
    // else, and counting it as reddit would be inventing a number.
    expect(sourceOf('https://notreddit.com/', SELF)).toBe('other');
  });

  it('is other for anywhere the list has never heard of', () => {
    // The bucket to watch: a day it leads is a day somebody wrote about
    // the game somewhere new.
    expect(sourceOf('https://some.blog.example/post', SELF)).toBe('other');
  });

  it('is other for something that is not a URL at all', () => {
    // Nothing to read. Inventing a bucket for a shape we cannot parse
    // would be inventing a number.
    expect(sourceOf('not a url', SELF)).toBe('other');
  });

  it('is always one of the words the server will accept', () => {
    // The two sides share this file, so this can only fail if a bucket is
    // returned that the list does not contain.
    const referrers = ['', SELF, 'https://x.com/', 'https://nowhere.example/', 'rubbish'];
    for (const r of referrers) expect(isVisitSource(sourceOf(r, SELF))).toBe(true);
  });
});

describe('the word the link itself carries', () => {
  it('wins over the referrer, and over having none', () => {
    // An announcement posted as ?from=reddit is opened from the Reddit
    // app's own browser, which sends no referrer: without the word, the
    // whole day would read as direct.
    expect(sourceOf('', SELF, '?from=reddit')).toBe('reddit');
    expect(sourceOf('https://www.google.com/', SELF, '?from=discord')).toBe('discord');
    expect(sourceOfLink('?from=hn&pulse=on')).toBe('hn');
  });

  it('is ignored unless it is a word off the list, and the referrer decides', () => {
    // A link can carry anything; only the nine names are counted, and a
    // URL on the parameter is never read as a bucket.
    expect(sourceOf('https://www.reddit.com/r/x/', SELF, '?from=newsletter')).toBe('reddit');
    expect(sourceOf('', SELF, '?from=https%3A%2F%2Freddit.com')).toBe('direct');
    expect(sourceOf('', SELF, '?from=Reddit')).toBe('direct');
    expect(sourceOfLink('')).toBeNull();
    expect(sourceOfLink('?pulse=off')).toBeNull();
  });
});

describe('the word that arrives over the wire', () => {
  it('is refused unless it is on the list', () => {
    // A query is a thing a client can forge, and an unrecognised word must
    // not be able to write a row nothing can render.
    expect(isVisitSource('reddit')).toBe(true);
    expect(isVisitSource('Reddit')).toBe(false);
    expect(isVisitSource('https://reddit.com')).toBe(false);
    expect(isVisitSource('')).toBe(false);
    expect(isVisitSource('__proto__')).toBe(false);
  });

  it('is one of nine, and direct is the one a missing referrer picks', () => {
    expect(VISIT_SOURCES).toContain('direct');
    expect(VISIT_SOURCES).toContain('other');
    expect(new Set(VISIT_SOURCES).size).toBe(VISIT_SOURCES.length);
  });
});
