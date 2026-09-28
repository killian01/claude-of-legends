// The landing's presence line (src/ui/landing_presence.ts, ADR 0025): what
// it says when people are on, and that it says nothing when nobody is.

import { describe, expect, it } from 'vitest';
import { fetchPresence, PRESENCE_ROUTE, presenceLine } from '../src/ui/landing_presence';

describe('the presence line', () => {
  it('says so when a match someone can join has people in it', () => {
    expect(presenceLine({ playing: 1, queued: 0, joinable: true })).toMatch(/Someone.*Jump in/);
    expect(presenceLine({ playing: 3, queued: 0, joinable: true })).toMatch(/^3 people/);
  });

  it('falls back to the queue, and says nothing when nobody is on', () => {
    expect(presenceLine({ playing: 2, queued: 1, joinable: false })).toMatch(/waiting/);
    expect(presenceLine({ playing: 0, queued: 2, joinable: false })).toMatch(
      /^2 people are waiting/,
    );
    expect(presenceLine({ playing: 2, queued: 0, joinable: false })).toBeNull();
    expect(presenceLine({ playing: 0, queued: 0, joinable: false })).toBeNull();
  });

  it('reads the route, and answers null for anything it cannot trust', async () => {
    let asked = '';
    const ok = (async (input: RequestInfo | URL) => {
      asked = String(input);
      return new Response(JSON.stringify({ playing: 2, queued: 0, joinable: true }));
    }) as typeof fetch;
    expect(await fetchPresence(ok)).toEqual({ playing: 2, queued: 0, joinable: true });
    expect(asked).toBe(PRESENCE_ROUTE);
    const bad = (async () => new Response(JSON.stringify({ playing: 'x' }))) as typeof fetch;
    expect(await fetchPresence(bad)).toBeNull();
    const gone = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await fetchPresence(gone)).toBeNull();
  });
});
