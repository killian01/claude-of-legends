// The client's half of a Guest (src/net/guest.ts, ADR 0024): the name the
// server hands out, and null whenever there is no answer to trust, so the
// landing can fall back to the offline match.

import { describe, expect, it } from 'vitest';
import { GUEST_ROUTE, openGuest } from '../src/net/guest';

function answer(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('opening a guest', () => {
  it('posts to the route and answers with the name', async () => {
    let asked = '';
    let method = '';
    const post = (async (input: RequestInfo | URL, init?: RequestInit) => {
      asked = String(input);
      method = init?.method ?? '';
      return new Response(JSON.stringify({ name: 'Wanderer 0042' }), { status: 200 });
    }) as typeof fetch;
    expect(await openGuest(post)).toBe('Wanderer 0042');
    expect(asked).toBe(GUEST_ROUTE);
    expect(method).toBe('POST');
  });

  it('answers null when the server refuses, says nothing usable, or is gone', async () => {
    expect(await openGuest(answer(500, { name: 'x' }))).toBeNull();
    expect(await openGuest(answer(200, { nope: 1 }))).toBeNull();
    expect(await openGuest(answer(200, { name: '' }))).toBeNull();
    const gone = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await openGuest(gone)).toBeNull();
  });
});
