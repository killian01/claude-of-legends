// Invite links: the join code survives the round trip through a URL and
// junk never does.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CODE_MAX, inviteUrl, normalizeJoinCode, parseJoinCode } from '../src/game/invite';

const source = (file: string): string =>
  readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('lobby invite links', () => {
  it('parses the code case-insensitively', () => {
    expect(parseJoinCode('?join=ABCDE')).toBe('ABCDE');
    expect(parseJoinCode('?join=abcde')).toBe('ABCDE');
    expect(parseJoinCode('?foo=1&join=QWXYZ')).toBe('QWXYZ');
  });

  it('rejects junk shapes', () => {
    expect(parseJoinCode('')).toBeNull();
    expect(parseJoinCode('?join=')).toBeNull();
    expect(parseJoinCode('?join=ABC')).toBeNull();
    expect(parseJoinCode('?join=ABCDEFG')).toBeNull();
    expect(parseJoinCode('?join=AB1DE')).toBeNull();
    expect(parseJoinCode('?other=ABCDE')).toBeNull();
  });

  it('builds the link the parser accepts', () => {
    const url = inviteUrl('https://example.test', 'KMNPQ');
    expect(url).toBe('https://example.test/?join=KMNPQ');
    expect(parseJoinCode(new URL(url).search)).toBe('KMNPQ');
  });

  it('normalizes a typed code the same way', () => {
    expect(normalizeJoinCode(' abcde ')).toBe('ABCDE');
    expect(normalizeJoinCode('KMNPQ')).toBe('KMNPQ');
    expect(normalizeJoinCode('')).toBeNull();
    expect(normalizeJoinCode('abc')).toBeNull();
    expect(normalizeJoinCode('AB1DE')).toBeNull();
    expect(normalizeJoinCode('abcdefg')).toBeNull();
  });

  it('reads the six letters the server issues, and five from an older link', () => {
    expect(parseJoinCode('?join=kmnpqr')).toBe('KMNPQR');
    expect(normalizeJoinCode(' kmnpqr ')).toBe('KMNPQR');
    expect(parseJoinCode('?join=KMNPQ')).toBe('KMNPQ');
  });

  // Every field a code is typed in takes the six letters the server issues:
  // a field that stops at five cuts a pasted code to one that seats nobody.
  it('lets every code field take the six letters the server issues', () => {
    expect(CODE_MAX).toBe(6);
    expect(normalizeJoinCode('K'.repeat(CODE_MAX))).toBe('K'.repeat(CODE_MAX));
    for (const file of ['src/ui/play_tiles.ts', 'src/ui/landing.ts']) {
      const text = source(file);
      expect(text, file).toMatch(/\.maxLength = CODE_MAX;/);
      expect(text, file).not.toMatch(/\.maxLength = \d/);
    }
    expect(source('server/matchmaker.ts')).toMatch(/i < 6; i\+\+\) code \+= CODE_LETTERS/);
  });
});
