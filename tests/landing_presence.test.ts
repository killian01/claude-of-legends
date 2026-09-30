// The landing's presence line (src/ui/landing_presence.ts, ADR 0025): what
// it says when people are on, and that it says nothing when nobody is.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetchPresence, PRESENCE_ROUTE, presenceLine } from '../src/ui/landing_presence';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  it('is really gone when nobody is on, not an empty box', () => {
    // The landing styles the line with display: flex, which beats the
    // browser's own [hidden]; the page must hide it again explicitly.
    const landing = readFileSync(path.join(ROOT, 'src/ui/landing.ts'), 'utf8');
    expect(landing).toContain('.pg.land .pg-presence[hidden] { display: none; }');
  });
});
