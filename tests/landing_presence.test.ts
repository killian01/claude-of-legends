// The landing's presence line (src/ui/landing_presence.ts, ADR 0025): what
// it says when people are on, and that it says nothing when nobody is.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  fetchPresence,
  PRESENCE_ROUTE,
  presenceAfter,
  presenceLine,
} from '../src/ui/landing_presence';

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

  it('says a battle royale is on and the time it has left, counting people only', () => {
    // Respawn always has a match running to drop into: the line says so
    // and how long it runs, and never counts the house bots as people.
    const none = { playing: 0, queued: 0, joinable: false };
    const on = { ...none, royale: { playing: 0, joinable: true, endsInS: 372 } };
    expect(presenceLine(on)).toBe('A battle royale is on right now, 6:12 left. Jump in.');
    const someone = { ...none, royale: { playing: 1, joinable: true, endsInS: 372 } };
    expect(presenceLine(someone)).toBe('Someone is on the Wanderseed right now. Jump in.');
    const two = { ...none, royale: { playing: 2, joinable: true, endsInS: 372 } };
    expect(presenceLine(two)).toMatch(/^2 people are on the Wanderseed/);
    // Nothing to drop into: the 5v5's line, or nothing.
    const shut = { ...none, royale: { playing: 0, joinable: false, endsInS: null } };
    expect(presenceLine(shut)).toBeNull();
    // The clock runs down between two reads, and stops at the end.
    expect(presenceLine(presenceAfter(on, 12_400))).toMatch(/, 6:00 left/);
    expect(presenceLine(presenceAfter(on, 400_000))).toBeNull();
  });

  it('reads the route, and answers null for anything it cannot trust', async () => {
    let asked = '';
    const ok = (async (input: RequestInfo | URL) => {
      asked = String(input);
      return new Response(JSON.stringify({ playing: 2, queued: 0, joinable: true }));
    }) as typeof fetch;
    expect(await fetchPresence(ok)).toEqual({ playing: 2, queued: 0, joinable: true });
    const royale = (async () =>
      new Response(
        JSON.stringify({
          playing: 0,
          queued: 0,
          joinable: false,
          royale: { playing: 0, joinable: true, endsInS: 300 },
        }),
      )) as typeof fetch;
    expect((await fetchPresence(royale))?.royale).toEqual({
      playing: 0,
      joinable: true,
      endsInS: 300,
    });
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
