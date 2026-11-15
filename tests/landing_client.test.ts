// The landing's one request on the client (src/net/landing.ts, ADR 0033):
// a POST with the cookie riding it and no body, read field by field, and
// null whenever there is no answer to trust, so the landing stands as it
// did without the ladder and the own panel. With an invite code (ADR 0036)
// the code rides in a JSON body, never in the address, and the answer's
// invitation is read field by field too.

import { describe, expect, it, vi } from 'vitest';
import {
  asLandingPage,
  LANDING_ROUTE,
  LANDING_WAIT_MS,
  loadLanding,
  untilLanded,
} from '../src/net/landing';

const LADDER = {
  total: 2,
  rows: [
    { rank: 1, name: 'Quillon', points: 352, guest: false },
    { rank: 2, name: 'Thornwick', points: 340, guest: true },
  ],
  me: { rank: 2, points: 340, name: 'Thornwick', guest: true, named: true },
};

const OWN = {
  name: 'Thornwick',
  named: true,
  account: false,
  rank: 2,
  points: 340,
  level: { level: 4, from: 225, to: 350 },
  best: 9,
  above: { rank: 1, name: 'Quillon', points: 352, gap: 13 },
  since: 1_759_700_000_000,
};

const WEEK = {
  rotation: ['korrath', 'vesk', 'maera'],
  starters: ['torv', 'fenn', 'ashvyn', 'sylra'],
  turnsAt: 1_760_572_800_000,
};

const GOOD = { ladder: LADDER, own: OWN, week: WEEK };

function answer(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe("the landing's one request", () => {
  it('posts to the route with the cookie riding it and no body', async () => {
    let asked = '';
    let init: RequestInit | undefined;
    const post = (async (input: RequestInfo | URL, given?: RequestInit) => {
      asked = String(input);
      init = given;
      return new Response(JSON.stringify(GOOD), { status: 200 });
    }) as typeof fetch;
    const page = await loadLanding(post);
    expect(asked).toBe(LANDING_ROUTE);
    expect(LANDING_ROUTE).toBe('/api/public/landing');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBeUndefined();
    expect(page).toEqual(GOOD);
  });

  it('with an invite code, posts { join } as JSON, never in the address', async () => {
    let asked = '';
    let init: RequestInit | undefined;
    const invite = { open: true, host: 'Marrow', players: 3, seats: 10 };
    const post = (async (input: RequestInfo | URL, given?: RequestInit) => {
      asked = String(input);
      init = given;
      return new Response(JSON.stringify({ ...GOOD, invite }), { status: 200 });
    }) as typeof fetch;
    const page = await loadLanding(post, 'KMNPQR');
    expect(asked).toBe(LANDING_ROUTE);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ join: 'KMNPQR' });
    expect(page).toEqual({ ...GOOD, invite });
  });

  it('answers null on a refusal, a throw or junk', async () => {
    expect(await loadLanding(answer(500, GOOD))).toBeNull();
    expect(await loadLanding(answer(405, { error: 'use POST' }))).toBeNull();
    expect(await loadLanding(answer(200, { nope: 1 }))).toBeNull();
    const gone = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await loadLanding(gone)).toBeNull();
    const notJson = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
    expect(await loadLanding(notJson)).toBeNull();
  });
});

describe('reading the answer', () => {
  it('reads a good page as it is', () => {
    expect(asLandingPage(GOOD)).toEqual(GOOD);
    // A fresh server, a fresh visitor: no rows, no place, level 1.
    const fresh = {
      ladder: { total: 0, rows: [], me: null },
      own: {
        ...OWN,
        name: 'Wanderer 0421',
        named: false,
        rank: null,
        points: 0,
        level: { level: 1, from: 0, to: 50 },
        best: 0,
        above: null,
      },
      week: WEEK,
    };
    expect(asLandingPage(fresh)).toEqual(fresh);
  });

  it('is no page at all without a well formed ladder', () => {
    for (const junk of [null, 1, 'page', [], {}, { own: OWN, week: WEEK }]) {
      expect(asLandingPage(junk)).toBeNull();
    }
    const bad = (ladder: unknown) => asLandingPage({ ...GOOD, ladder });
    expect(bad({ ...LADDER, total: -1 })).toBeNull();
    expect(bad({ ...LADDER, total: '2' })).toBeNull();
    expect(bad({ ...LADDER, rows: 'none' })).toBeNull();
    expect(bad({ ...LADDER, rows: [{ rank: 1, name: 7, points: 1, guest: false }] })).toBeNull();
    expect(bad({ ...LADDER, me: { rank: 'two', points: 1, name: 'x' } })).toBeNull();
    const noMe = { total: 2, rows: LADDER.rows };
    expect(bad(noMe)).toBeNull();
    expect(bad({ ...LADDER, me: null })?.ladder.me).toBeNull();
  });

  it('leaves out an own panel that is not well formed, and keeps the ladder', () => {
    const own = (patch: Record<string, unknown>) =>
      asLandingPage({ ...GOOD, own: { ...OWN, ...patch } });
    expect(own({ name: 3 })?.own).toBeNull();
    expect(own({ name: '' })?.own).toBeNull();
    expect(own({ named: 'yes' })?.own).toBeNull();
    expect(own({ account: undefined })?.own).toBeNull();
    expect(own({ rank: 'first' })?.own).toBeNull();
    expect(own({ points: 1.5 })?.own).toBeNull();
    expect(own({ points: Number.NaN })?.own).toBeNull();
    expect(own({ best: -1 })?.own).toBeNull();
    expect(own({ level: { level: 4, from: 350, to: 350 } })?.own).toBeNull();
    expect(own({ level: null })?.own).toBeNull();
    expect(own({ above: { rank: 1, name: 'Quillon', points: 352 } })?.own).toBeNull();
    expect(own({ since: 'today' })?.own).toBeNull();
    expect(own({ rank: null, above: null })?.own).toEqual({ ...OWN, rank: null, above: null });
    expect(own({ name: 3 })?.ladder).toEqual(LADDER);
    expect(asLandingPage({ ...GOOD, own: null })?.own).toBeNull();
    expect(asLandingPage({ ...GOOD, own: [] })?.own).toBeNull();
  });

  it('leaves out a week that is missing or not well formed', () => {
    const { week: _week, ...noWeek } = GOOD;
    expect(asLandingPage(noWeek)?.week).toBeNull();
    expect(asLandingPage({ ...GOOD, week: { ...WEEK, rotation: 'korrath' } })?.week).toBeNull();
    expect(asLandingPage({ ...GOOD, week: { ...WEEK, rotation: [1, 2] } })?.week).toBeNull();
    expect(asLandingPage({ ...GOOD, week: { ...WEEK, turnsAt: null } })?.week).toBeNull();
    expect(asLandingPage({ ...GOOD, week: { ...WEEK, rotation: [] } })?.week).toEqual({
      ...WEEK,
      rotation: [],
    });
  });
});

describe('reading the invitation', () => {
  const invited = (invite: unknown) => asLandingPage({ ...GOOD, invite });

  it('is no field at all when the answer has none', () => {
    const page = asLandingPage(GOOD);
    expect(page).not.toBeNull();
    expect(page && 'invite' in page).toBe(false);
  });

  it('reads an open lobby: its host, how many are in, its seats and its phase', () => {
    const open = { open: true, host: 'Marrow', players: 3, seats: 10 };
    expect(invited(open)?.invite).toEqual(open);
    expect(invited({ ...open, players: 0 })?.invite).toEqual({ ...open, players: 0 });
    for (const phase of ['queue', 'select', 'match']) {
      expect(invited({ ...open, phase })?.invite).toEqual({ ...open, phase });
    }
    // Nothing the shape does not name is carried.
    expect(invited({ ...open, code: 'KMNPQR', id: 7 })?.invite).toEqual(open);
  });

  it('reads a closed lobby, and a connection over its wrong codes', () => {
    expect(invited({ open: false })?.invite).toEqual({ open: false });
    expect(invited({ open: false, limited: true })?.invite).toEqual({
      open: false,
      limited: true,
    });
    expect(invited({ open: false, limited: 'yes' })?.invite).toEqual({ open: false });
  });

  it('reads a malformed invitation as no answer, and keeps the ladder', () => {
    const open = { open: true, host: 'Marrow', players: 3, seats: 10 };
    for (const junk of [
      null,
      'open',
      [],
      {},
      { open: 'yes' },
      { ...open, host: '' },
      { ...open, host: 7 },
      { ...open, players: -1 },
      { ...open, players: 1.5 },
      { ...open, seats: 0 },
      { ...open, seats: '10' },
      { ...open, phase: 'lunch' },
    ]) {
      const page = invited(junk);
      expect(page?.invite).toBeNull();
      expect(page?.ladder).toEqual(LADDER);
      expect(page?.own).toEqual(OWN);
    }
  });
});

describe('Play after the landing', () => {
  // Play asks for its Guest with the cookie the landing's answer set, so it
  // waits for that answer, a moment at most.
  it('goes on once the answer is in, or after the wait at most', async () => {
    vi.useFakeTimers();
    try {
      let answered = (_: unknown): void => {};
      const slow = new Promise((resolve) => {
        answered = resolve;
      });
      let gone = false;
      void untilLanded(slow).then(() => {
        gone = true;
      });
      await vi.advanceTimersByTimeAsync(LANDING_WAIT_MS - 1);
      expect(gone).toBe(false);
      answered(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(gone).toBe(true);

      let late = false;
      void untilLanded(new Promise(() => {})).then(() => {
        late = true;
      });
      await vi.advanceTimersByTimeAsync(LANDING_WAIT_MS - 1);
      expect(late).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(late).toBe(true);
      expect(LANDING_WAIT_MS).toBe(2000);

      let failed = false;
      void untilLanded(Promise.reject(new Error('gone'))).then(() => {
        failed = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(failed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
