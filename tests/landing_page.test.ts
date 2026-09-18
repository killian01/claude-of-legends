// The landing's request (server/landing_page.ts): the top of the ladder by
// hand and the top bots for a visitor, as names and numbers only.

import { describe, expect, it } from 'vitest';
import type { LadderSeed } from '../server/ladder_page';
import { buildLandingPage, LANDING_LADDER_ROWS, type LandingInput } from '../server/landing_page';
import type { WayStats } from '../server/way_stats';
import type { Way } from '../server/ways';

const account = (id: number, rating: number, games: number): LadderSeed => ({
  id,
  accountId: id,
  name: `p${id}`,
  rating,
  games,
  createdAt: id,
});

const bot = (botId: string, accountId: number, rating: number, games: number): LadderSeed => ({
  id: botId,
  accountId,
  name: `${botId}-name`,
  owner: `p${accountId}`,
  championId: 'fenn',
  rating,
  games,
});

function stats(entries: [string | number, Partial<WayStats>][]): Map<string | number, WayStats> {
  const out = new Map<string | number, WayStats>();
  for (const [id, over] of entries) {
    out.set(id, {
      games: 0,
      wins: 0,
      losses: 0,
      form: [],
      lastAt: 0,
      champions: new Map(),
      ...over,
    });
  }
  return out;
}

// Enough rated games to place on every way.
const PLACED = 40;

function input(over: Partial<Record<Way, LadderSeed[]>>, accounts = 9): LandingInput {
  const seeds = (way: Way): LadderSeed[] => over[way] ?? [];
  return {
    seeds,
    stats: (way) =>
      stats(seeds(way).map((s) => [s.id, { games: s.games, wins: s.games - 3, losses: 3 }])),
    accounts,
  };
}

describe('the landing page', () => {
  it('shows the top of the ladder by hand as names and numbers, ranked', () => {
    const page = buildLandingPage(
      input({
        hand: [account(1, 1000, PLACED), account(2, 1300, PLACED), account(3, 1100, PLACED)],
      }),
    );
    expect(page.ladder.way).toBe('hand');
    expect(page.ladder.total).toBe(3);
    expect(page.ladder.rows.map((r) => [r.rank, r.name, r.rating])).toEqual([
      [1, 'p2', 1300],
      [2, 'p3', 1100],
      [3, 'p1', 1000],
    ]);
    expect(page.ladder.rows[0]).toEqual({
      rank: 1,
      name: 'p2',
      rating: 1300,
      wins: PLACED - 3,
      losses: 3,
      owner: null,
    });
    expect(page.accounts).toBe(9);
  });

  it('caps the rows and still counts everyone placed', () => {
    const many = Array.from({ length: 12 }, (_, i) => account(i + 1, 1000 + i, PLACED));
    const page = buildLandingPage(input({ hand: many }));
    expect(page.ladder.rows).toHaveLength(LANDING_LADDER_ROWS);
    expect(page.ladder.total).toBe(12);
    expect(buildLandingPage(input({ hand: many }), { rows: 2 }).ladder.rows).toHaveLength(2);
  });

  it('names the owner on a bot row, from the Arena first', () => {
    const page = buildLandingPage(
      input({ arena: [bot('b1', 4, 1200, PLACED)], bot: [bot('b2', 5, 1500, PLACED)] }),
    );
    expect(page.bots.way).toBe('arena');
    expect(page.bots.rows[0]?.name).toBe('b1-name');
    expect(page.bots.rows[0]?.owner).toBe('p4');
  });

  it('falls back to the bots placed live until the Arena has placed one', () => {
    const page = buildLandingPage(input({ bot: [bot('b2', 5, 1500, PLACED)] }));
    expect(page.bots.way).toBe('bot');
    expect(page.bots.rows.map((r) => r.name)).toEqual(['b2-name']);
  });

  it('is empty rather than absent on a fresh server', () => {
    const page = buildLandingPage(input({}, 0));
    expect(page.ladder).toEqual({ way: 'hand', total: 0, rows: [] });
    expect(page.bots).toEqual({ way: 'arena', total: 0, rows: [] });
    expect(page.accounts).toBe(0);
  });
});
