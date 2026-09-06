// Signing in starts the page over: what the address bar has to say on
// the other side, and that nothing a link carried in is dropped on the way.

import { describe, expect, it } from 'vitest';
import { parseJoinCode } from '../src/game/invite';
import { reenterAsAccount, signedInUrl } from '../src/game/reentry';

const NOTHING = { joinCode: null, confirmed: null } as const;

describe('re-entry after signing in', () => {
  it('comes back to the same page with a clean address bar', () => {
    expect(signedInUrl('https://example.test/', NOTHING)).toBe('https://example.test/');
    // Boot consumed both of these before the landing was ever drawn;
    // carrying them back would replay their messages a second time.
    expect(signedInUrl('https://example.test/?confirmed=1#x', NOTHING)).toBe(
      'https://example.test/',
    );
  });

  it('puts a pending invite code back so the friend still lands in the lobby', () => {
    const url = signedInUrl('https://example.test/', { joinCode: 'KMNPQ', confirmed: null });
    expect(parseJoinCode(new URL(url).search)).toBe('KMNPQ');
  });

  it('carries the confirmation result across in the shape the home reads', () => {
    const ok = new URL(signedInUrl('https://example.test/', { joinCode: null, confirmed: 'ok' }));
    expect(ok.searchParams.get('confirmed')).toBe('1');
    const bad = new URL(
      signedInUrl('https://example.test/', { joinCode: null, confirmed: 'failed' }),
    );
    expect(bad.searchParams.get('confirmed')).toBe('0');
  });

  it('reloads when there is nothing to carry, and navigates when there is', () => {
    const calls: string[] = [];
    const fake = (href: string): Location =>
      ({
        href,
        reload: () => calls.push('reload'),
        assign: (to: string) => calls.push(`assign ${to}`),
      }) as unknown as Location;

    reenterAsAccount(NOTHING, fake('https://example.test/'));
    expect(calls).toEqual(['reload']);

    calls.length = 0;
    reenterAsAccount({ joinCode: 'KMNPQ', confirmed: null }, fake('https://example.test/'));
    expect(calls).toEqual(['assign https://example.test/?join=KMNPQ']);
  });
});
