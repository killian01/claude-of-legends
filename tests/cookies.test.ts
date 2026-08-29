// Reading the Cookie header and writing Set-Cookie. The parser must never
// throw on anything a browser or a proxy can send: an unreadable header
// means "not logged in", not a 500.

import { describe, expect, it } from 'vitest';
import { clearCookie, parseCookies, serializeCookie } from '../server/cookies';

describe('cookie header parsing', () => {
  it('reads one cookie and several', () => {
    expect(parseCookies('loc=abc')).toEqual(new Map([['loc', 'abc']]));
    expect(parseCookies('a=1; b=2; c=3')).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2'],
        ['c', '3'],
      ]),
    );
  });

  it('tolerates spacing, quoting and percent escapes', () => {
    expect(parseCookies('  a = 1  ;b=2')).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ]),
    );
    expect(parseCookies('a="quoted value"').get('a')).toBe('quoted value');
    expect(parseCookies('a=one%20two').get('a')).toBe('one two');
  });

  it('returns nothing rather than throwing on junk', () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies('').size).toBe(0);
    expect(parseCookies(';;;').size).toBe(0);
    expect(parseCookies('novalue').size).toBe(0);
    expect(parseCookies('=novalue').size).toBe(0);
    // A broken percent escape keeps the raw text; the session lookup misses.
    expect(parseCookies('a=%E0%A4%A').get('a')).toBe('%E0%A4%A');
  });

  it('keeps the first of a repeated name', () => {
    expect(parseCookies('a=first; a=second').get('a')).toBe('first');
  });

  it('writes a session cookie a browser will send back and script cannot read', () => {
    const set = serializeCookie('loc_session', 'tok en', { maxAgeS: 60, secure: true });
    expect(set).toContain('loc_session=tok%20en');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).toContain('Path=/');
    expect(set).toContain('Max-Age=60');
    expect(set).toContain('Secure');
  });

  it('leaves Secure off when the origin is plain http', () => {
    expect(serializeCookie('loc_session', 'x', { maxAgeS: 60, secure: false })).not.toContain(
      'Secure',
    );
  });

  it('round-trips a written cookie back through the parser', () => {
    const value = 'a value; with separators';
    const set = serializeCookie('loc_session', value, { maxAgeS: 60, secure: true });
    const pair = set.split(';')[0] ?? '';
    expect(parseCookies(pair).get('loc_session')).toBe(value);
  });

  it('clears by expiring the same cookie', () => {
    const cleared = clearCookie('loc_session', { secure: true });
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('Path=/');
  });
});
