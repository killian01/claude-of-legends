// Invite links: the join code survives the round trip through a URL and
// junk never does.

import { describe, expect, it } from 'vitest';
import { inviteUrl, normalizeJoinCode, parseJoinCode } from '../src/game/invite';

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
    expect(parseJoinCode('?join=ABCDEF')).toBeNull();
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
    expect(normalizeJoinCode('abcdef')).toBeNull();
  });
});
