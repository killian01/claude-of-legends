// The landing's one request (server/landing_page.ts, ADR 0033): the ladder
// of every human (ADR 0027), names and numbers only; the own panel, which
// says who the reader is, their place and points, their level, their best
// and the line just above; and the week.

import { describe, expect, it } from 'vitest';
import { CodeGuard, WRONG_CODES_ALLOWED } from '../server/code_guess';
import {
  buildLandingPage,
  guardedLookup,
  type InviteLookup,
  LANDING_LADDER_ROWS,
  type LandingOwnInput,
  landingInvite,
} from '../server/landing_page';
import { rotationAt, STARTER_COLLECTION, WEEK_MS } from '../server/laurels';
import { Matchmaker } from '../server/matchmaker';
import type { PointsEntry } from '../server/points_ladder';

const NOW = 1_760_000_000_000;
const DAY = 24 * 3600_000;

const line = (key: number, points: number): PointsEntry => ({
  key,
  name: key < 0 ? `Wanderer ${-key}` : `p${key}`,
  points,
  guest: key < 0,
  since: Math.abs(key),
});

// `n` lines above everything a case puts below them, the oldest first.
const field = (n: number, floor: number): PointsEntry[] =>
  Array.from({ length: n }, (_, k) => ({
    key: 1000 + k,
    name: `Field${k}`,
    points: floor + (n - k) * 10,
    guest: false,
    since: NOW - 90 * DAY,
  }));

const guestOwn = (over: Partial<LandingOwnInput>): LandingOwnInput => ({
  key: -421,
  name: 'Wanderer 0421',
  named: false,
  account: false,
  best: 0,
  since: NOW,
  ...over,
});

describe('the landing page', () => {
  it('shows the points ladder of accounts and Guests together, ranked', () => {
    const page = buildLandingPage({
      entries: [line(1, 120), line(-2, 300), line(3, 45)],
      own: null,
      now: NOW,
    });
    expect(page.ladder.rows).toEqual([
      { rank: 1, name: 'Wanderer 2', points: 300, guest: true },
      { rank: 2, name: 'p1', points: 120, guest: false },
      { rank: 3, name: 'p3', points: 45, guest: false },
    ]);
    expect(page.ladder.total).toBe(3);
    expect(page.ladder.me).toBeNull();
    expect(page.own).toBeNull();
  });

  it('shows every line on it, up to a ceiling, and counts everyone past it', () => {
    const many = Array.from({ length: 14 }, (_, i) => line(i + 1, 10 + i));
    const page = buildLandingPage({ entries: many, own: null, now: NOW });
    expect(page.ladder.rows).toHaveLength(14);
    expect(page.ladder.total).toBe(14);
    expect(LANDING_LADDER_ROWS).toBeGreaterThanOrEqual(100);
    const two = buildLandingPage({ entries: many, own: null, now: NOW }, { rows: 2 });
    expect(two.ladder.rows).toHaveLength(2);
  });

  it("tells the ladder's reader where they stand, as before", () => {
    const page = buildLandingPage({
      entries: [line(1, 320), line(-2, 300)],
      own: guestOwn({ key: -2, name: 'Wanderer 2' }),
      now: NOW,
    });
    expect(page.ladder.me).toEqual({
      rank: 2,
      points: 300,
      name: 'Wanderer 2',
      guest: true,
      named: false,
    });
  });

  it('is empty rather than absent on a fresh server', () => {
    const page = buildLandingPage({ entries: [], own: null, now: NOW });
    expect(page.ladder).toEqual({ total: 0, rows: [], me: null });
    expect(page.own).toBeNull();
  });
});

describe('the own panel', () => {
  it('shows a new browser its handed-out Guest, off the ladder at level 1', () => {
    const page = buildLandingPage({ entries: field(5, 100), own: guestOwn({}), now: NOW });
    expect(page.own).toEqual({
      name: 'Wanderer 0421',
      named: false,
      account: false,
      rank: null,
      points: 0,
      level: { level: 1, from: 0, to: 50 },
      best: 0,
      above: null,
      since: NOW,
    });
  });

  it('shows a Guest still wearing its handed-out name its place and the line above', () => {
    const since = NOW - 3 * DAY;
    const entries = [
      ...field(29, 90),
      { key: -7710, name: 'Wanderer 7710', points: 90, guest: true, since: NOW - 5 * DAY },
      { key: -421, name: 'Wanderer 0421', points: 85, guest: true, since },
      line(-9, 40),
    ];
    const page = buildLandingPage({ entries, own: guestOwn({ best: 3, since }), now: NOW });
    expect(page.own).toEqual({
      name: 'Wanderer 0421',
      named: false,
      account: false,
      rank: 31,
      points: 85,
      level: { level: 2, from: 50, to: 125 },
      best: 3,
      above: { rank: 30, name: 'Wanderer 7710', points: 90, gap: 6 },
      since,
    });
  });

  it('shows a named Guest with points', () => {
    const since = NOW - 3 * DAY;
    const entries = [
      ...field(10, 352),
      { key: 2, name: 'Quillon', points: 352, guest: false, since: NOW - 30 * DAY },
      { key: -55, name: 'Thornwick', points: 340, guest: true, since },
    ];
    const own = guestOwn({ key: -55, name: 'Thornwick', named: true, best: 9, since });
    expect(buildLandingPage({ entries, own, now: NOW }).own).toEqual({
      name: 'Thornwick',
      named: true,
      account: false,
      rank: 12,
      points: 340,
      level: { level: 4, from: 225, to: 350 },
      best: 9,
      above: { rank: 11, name: 'Quillon', points: 352, gap: 13 },
      since,
    });
  });

  it('shows an account its own the same way', () => {
    const since = NOW - 30 * DAY;
    const entries = [
      ...field(1, 1302),
      { key: 2, name: 'Quillon', points: 1302, guest: false, since },
      { key: 1, name: 'Marrow', points: 1240, guest: false, since },
    ];
    const own: LandingOwnInput = {
      key: 1,
      name: 'Marrow',
      named: true,
      account: true,
      best: 14,
      since,
    };
    const page = buildLandingPage({ entries, own, now: NOW });
    expect(page.own).toEqual({
      name: 'Marrow',
      named: true,
      account: true,
      rank: 3,
      points: 1240,
      level: { level: 9, from: 1100, to: 1350 },
      best: 14,
      above: { rank: 2, name: 'Quillon', points: 1302, gap: 63 },
      since,
    });
    expect(page.ladder.me).toMatchObject({ rank: 3, guest: false, named: true });
  });

  it("reads the reader's own line only, a Guest and an account never the other's", () => {
    // A Guest's key is negative and an account's positive (server/guests.ts
    // isGuestId), so the same number on both sides is two lines.
    const entries = [
      { key: 421, name: 'Marrow', points: 400, guest: false, since: NOW - 30 * DAY },
      { key: -421, name: 'Wanderer 0421', points: 60, guest: true, since: NOW - DAY },
    ];
    const asGuest = buildLandingPage({ entries, own: guestOwn({}), now: NOW });
    expect(asGuest.own).toMatchObject({ name: 'Wanderer 0421', rank: 2, points: 60 });
    expect(asGuest.ladder.me).toMatchObject({ rank: 2, points: 60, guest: true });
    const asAccount = buildLandingPage({
      entries,
      own: { key: 421, name: 'Marrow', named: true, account: true, best: 3, since: NOW },
      now: NOW,
    });
    expect(asAccount.own).toMatchObject({ name: 'Marrow', rank: 1, points: 400, best: 3 });
    expect(asAccount.ladder.me).toMatchObject({ rank: 1, points: 400, guest: false });
  });

  it('counts the gap to pass the line above, ties going to the older line', () => {
    const entries = (mine: number, theirs: number, mineSince: number): PointsEntry[] => [
      { key: 5, name: 'Above', points: theirs, guest: false, since: 100 },
      { key: -1, name: 'Wanderer 0421', points: mine, guest: true, since: mineSince },
    ];
    // Equal points, the older line above: one more passes it.
    const tie = buildLandingPage({
      entries: entries(60, 60, 200),
      own: guestOwn({ key: -1 }),
      now: NOW,
    });
    expect(tie.own?.above).toEqual({ rank: 1, name: 'Above', points: 60, gap: 1 });
    // The reader's line is the older: reaching the points above passes it.
    const older = buildLandingPage({
      entries: entries(60, 75, 50),
      own: guestOwn({ key: -1 }),
      now: NOW,
    });
    expect(older.own?.above).toEqual({ rank: 1, name: 'Above', points: 75, gap: 15 });
    // The newer line: one more than the difference.
    const newer = buildLandingPage({
      entries: entries(60, 75, 200),
      own: guestOwn({ key: -1 }),
      now: NOW,
    });
    expect(newer.own?.above?.gap).toBe(16);
  });

  it('has nobody above the line at the top', () => {
    const page = buildLandingPage({
      entries: [line(-421, 500), line(2, 300)],
      own: guestOwn({}),
      now: NOW,
    });
    expect(page.own).toMatchObject({ rank: 1, points: 500, above: null });
  });

  it('reads the level off the points through the one curve', () => {
    const levelAt = (points: number) =>
      buildLandingPage({
        entries: points > 0 ? [line(-421, points)] : [],
        own: guestOwn({}),
        now: NOW,
      }).own?.level;
    expect(levelAt(0)).toEqual({ level: 1, from: 0, to: 50 });
    expect(levelAt(85)).toEqual({ level: 2, from: 50, to: 125 });
    expect(levelAt(340)).toEqual({ level: 4, from: 225, to: 350 });
    expect(levelAt(1240)).toEqual({ level: 9, from: 1100, to: 1350 });
  });

  it('shows the best as a whole number within its ceiling', () => {
    const bestOf = (best: number) =>
      buildLandingPage({ entries: [], own: guestOwn({ best }), now: NOW }).own?.best;
    expect(bestOf(7.8)).toBe(7);
    expect(bestOf(-3)).toBe(0);
    expect(bestOf(5000)).toBe(1000);
    expect(bestOf(Number.NaN)).toBe(0);
  });

  it('never carries a key or an id', () => {
    const page = buildLandingPage({
      entries: [line(-421, 50), line(3, 80)],
      own: guestOwn({ best: 2 }),
      now: NOW,
    });
    expect(JSON.stringify(page.own)).not.toMatch(/"(key|id)"/);
    expect(JSON.stringify(page)).not.toMatch(/"(key|id|accountId)"/);
  });
});

describe('the week', () => {
  it('is the rotation, the starters, and the next turn', () => {
    const page = buildLandingPage({ entries: [], own: null, now: NOW });
    expect(page.week.rotation).toEqual(rotationAt(NOW));
    expect(page.week.starters).toEqual([...STARTER_COLLECTION]);
    expect(page.week.turnsAt % WEEK_MS).toBe(0);
    expect(page.week.turnsAt).toBeGreaterThan(NOW);
    expect(page.week.turnsAt - NOW).toBeLessThanOrEqual(WEEK_MS);
    // On the turn itself, the next one is a week away.
    const onTurn = buildLandingPage({ entries: [], own: null, now: 3000 * WEEK_MS });
    expect(onTurn.week.turnsAt).toBe(3001 * WEEK_MS);
    expect(onTurn.week.rotation).toEqual(rotationAt(3000 * WEEK_MS));
  });
});

// The invitation card's lobby (ADR 0036): a code read from the request's
// body, never its address, answered with the opener's name and the seats
// taken, behind the connection's wrong-code budget.
function lookup(found: Map<string, { host: string; players: number; phase?: 'match' }>) {
  const asked: string[] = [];
  const misses: (string | null)[] = [];
  let limited = false;
  const l: InviteLookup = {
    limited: () => limited,
    find: (code) => {
      asked.push(code);
      return found.get(code) ?? null;
    },
    miss: (code) => misses.push(code),
  };
  return {
    l,
    asked,
    misses,
    limit: () => {
      limited = true;
    },
  };
}

describe('the invitation card', () => {
  it('answers no invite when none was asked, and charges nothing', () => {
    const { l, asked, misses } = lookup(new Map());
    expect(landingInvite(undefined, l)).toBeNull();
    expect(asked).toEqual([]);
    expect(misses).toEqual([]);
    const page = buildLandingPage({ entries: [], own: guestOwn({}), now: NOW, invite: null });
    expect('invite' in page).toBe(false);
    expect('invite' in buildLandingPage({ entries: [], own: null, now: NOW })).toBe(false);
  });

  it('reads a join that is not a code as none, charged as one malformed miss', () => {
    for (const join of [
      'ABCD',
      'ABCDEFG',
      'AB1DEF',
      '',
      42,
      null,
      { code: 'ABCDEF' },
      ['ABCDEF'],
    ]) {
      const { l, asked, misses } = lookup(new Map());
      expect(landingInvite(join, l)).toBeNull();
      expect(asked).toEqual([]);
      expect(misses).toEqual([null]);
    }
  });

  it("names an open lobby's opener and its seats, whatever the case typed", () => {
    const { l, asked, misses } = lookup(new Map([['QWERTY', { host: 'Mira', players: 3 }]]));
    expect(landingInvite('qwErty', l)).toEqual({ open: true, host: 'Mira', players: 3, seats: 10 });
    expect(asked).toEqual(['QWERTY']);
    expect(misses).toEqual([]);
  });

  it('says the phase while the lobby plays, and stays open when it is full', () => {
    const { l } = lookup(
      new Map([
        ['PLAYIN', { host: 'Mira', players: 10, phase: 'match' as const }],
        ['FULLUP', { host: 'Oren', players: 10 }],
      ]),
    );
    expect(landingInvite('PLAYIN', l)).toEqual({
      open: true,
      host: 'Mira',
      players: 10,
      seats: 10,
      phase: 'match',
    });
    expect(landingInvite('FULLUP', l)).toEqual({
      open: true,
      host: 'Oren',
      players: 10,
      seats: 10,
    });
  });

  it('answers an unknown code closed, and charges it', () => {
    const { l, misses } = lookup(new Map());
    expect(landingInvite('ZZZZZZ', l)).toEqual({ open: false });
    expect(misses).toEqual(['ZZZZZZ']);
  });

  it('looks nothing up for a connection over its budget', () => {
    const { l, asked, misses, limit } = lookup(new Map([['QWERTY', { host: 'Mira', players: 3 }]]));
    limit();
    expect(landingInvite('QWERTY', l)).toEqual({ open: false, limited: true });
    expect(asked).toEqual([]);
    expect(misses).toEqual([]);
  });

  it('carries the answer on the page, and never the code, a key or an id', () => {
    const { l } = lookup(new Map([['QWERTY', { host: 'Mira', players: 3 }]]));
    const invite = landingInvite('QWERTY', l);
    const page = buildLandingPage({ entries: [], own: guestOwn({}), now: NOW, invite });
    expect(page.invite).toEqual({ open: true, host: 'Mira', players: 3, seats: 10 });
    expect(JSON.stringify(page)).not.toMatch(/QWERTY|"(key|id|accountId|code)"/);
    const closed = buildLandingPage({ entries: [], own: null, now: NOW, invite: { open: false } });
    expect(closed.invite).toEqual({ open: false });
  });

  it("names the opener, never another member, and counts the lobby's seats", () => {
    const mm = new Matchmaker(
      () => {},
      () => 1,
      () => 'QWERTY',
    );
    mm.createLobby(1, 'Mira', 0);
    mm.joinLobby(2, 'Oren', 'QWERTY', 0);
    mm.joinLobby(3, 'Tal', 'QWERTY', 0);
    mm.removeEverywhere(1, 0, 'leave');
    const guard = new CodeGuard();
    const answer = landingInvite('QWERTY', guardedLookup(guard, mm, 'k', -5, 0));
    expect(answer).toEqual({ open: true, host: 'Mira', players: 2, seats: 10 });
  });

  it('charges wrong codes on the connection, and lets a remembered member back over budget', () => {
    let account = 101;
    const mm = new Matchmaker(
      () => {},
      () => 1,
      () => 'QWERTY',
      { resolveAccount: () => account },
    );
    mm.createLobby(1, 'Mira', 0);
    account = 102;
    mm.joinLobby(2, 'Oren', 'QWERTY', 0);
    const guard = new CodeGuard();
    for (let i = 0; i < WRONG_CODES_ALLOWED; i++) {
      const code = `ZZZZ${String.fromCharCode(65 + Math.floor(i / 23))}${String.fromCharCode(65 + (i % 23))}`;
      expect(landingInvite(code, guardedLookup(guard, mm, 'k', -9, 10))).toEqual({ open: false });
    }
    expect(landingInvite('QWERTY', guardedLookup(guard, mm, 'k', -9, 20))).toEqual({
      open: false,
      limited: true,
    });
    expect(landingInvite('QWERTY', guardedLookup(guard, mm, 'k', 102, 20))).toMatchObject({
      open: true,
      host: 'Mira',
    });
    // Another connection has its own budget.
    expect(landingInvite('QWERTY', guardedLookup(guard, mm, 'other', -9, 20))).toMatchObject({
      open: true,
    });
  });

  it('answers a code this process issued closed without charging it', () => {
    const mm = new Matchmaker(
      () => {},
      () => 1,
      () => 'QWERTY',
    );
    const guard = new CodeGuard();
    guard.issued('QWERTY', 0);
    expect(landingInvite('QWERTY', guardedLookup(guard, mm, 'k', -9, 10))).toEqual({ open: false });
    expect(guard.misses('k', 10)).toBe(0);
  });
});
