// The ladder page (server/ladder_page.ts): the placed accounts in ladder
// order with their rated play, the reader's own place inside or beyond
// the top, the accounts still placing, the bots on the bot ways and the
// forged favorite on the Forge way.

import { describe, expect, it } from 'vitest';
import { MIN_RATED_GAMES } from '../server/ladder';
import { buildLadderPage, type LadderSeed, placeOf, ROW_FORM } from '../server/ladder_page';
import { FORM_CAP, type WayStats } from '../server/way_stats';

const seed = (
  accountId: number,
  rating: number,
  games: number,
  name: string | null = `p${accountId}`,
): LadderSeed => ({
  // On the hand way the subject is the account, so the two ids are one.
  id: accountId,
  accountId,
  name,
  rating,
  games,
  createdAt: accountId,
});

function stats(entries: [number, Partial<WayStats>][]): Map<string | number, WayStats> {
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

describe('the ladder page', () => {
  it('ranks the placed accounts and carries their rated play', () => {
    const seeds = [
      seed(1, 1010, 5),
      seed(2, 1030, 4),
      seed(3, 1010, 8),
      seed(4, 1200, 1),
      seed(5, 1300, 10, null),
    ];
    const st = stats([
      [
        2,
        {
          wins: 3,
          losses: 1,
          form: ['W', 'W', 'L', 'W'],
          champions: new Map([
            ['vesk', 3],
            ['fenn', 1],
          ]),
        },
      ],
      [3, { wins: 4, losses: 4, form: ['L', 'W', 'L', 'W', 'L', 'W', 'L', 'W'] }],
    ]);
    const page = buildLadderPage('hand', seeds, st, 2);
    expect(page.way).toBe('hand');
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => [r.rank, r.id])).toEqual([
      [1, 2],
      [2, 3],
      [3, 1],
    ]);
    expect(page.rows[0]).toMatchObject({
      name: 'p2',
      rating: 1030,
      ratedGames: 4,
      wins: 3,
      losses: 1,
      favorite: { championId: 'vesk', games: 3 },
    });
    expect(page.rows[1]!.form).toHaveLength(ROW_FORM);
    expect(page.rows[2]).toMatchObject({ wins: 0, losses: 0, form: [], favorite: null });
    expect(page.rows.some((r) => 'bots' in r)).toBe(false);
    expect(page.me).toEqual({
      rank: 1,
      rating: 1030,
      ratedGames: 4,
      placed: true,
      wins: 3,
      losses: 1,
      form: ['W', 'W', 'L', 'W'],
    });
  });

  it('pins the reader beyond the cap with their true rank, and places them at all', () => {
    const seeds: LadderSeed[] = [];
    for (let i = 1; i <= 8; i++) seeds.push(seed(i, 1100 - i, MIN_RATED_GAMES));
    const page = buildLadderPage('hand', seeds, stats([]), 7, { cap: 3 });
    expect(page.rows).toHaveLength(3);
    expect(page.total).toBe(8);
    expect(page.me.rank).toBe(7);
    expect(page.me.pinned).toMatchObject({ rank: 7, id: 7, name: 'p7', rating: 1093 });
    const inside = buildLadderPage('hand', seeds, stats([]), 2, { cap: 3 });
    expect(inside.me.rank).toBe(2);
    expect(inside.me.pinned).toBeUndefined();
  });

  it('shows the reader in placement with the whole form, and a stranger at the base', () => {
    const seeds = [seed(1, 1004, 2), seed(2, 1100, 5)];
    const form = Array.from({ length: FORM_CAP }, (_, i) => (i % 2 ? 'L' : 'W')) as ('W' | 'L')[];
    const page = buildLadderPage('hand', seeds, stats([[1, { wins: 1, losses: 1, form }]]), 1);
    expect(page.me).toMatchObject({ rank: null, placed: false, rating: 1004, ratedGames: 2 });
    expect(page.me.form).toHaveLength(FORM_CAP);
    // A placing row names its subject and its owner; on the hand way they
    // are the same account (ADR 0016).
    expect(page.placing).toEqual([{ id: 1, accountId: 1, name: 'p1', ratedGames: 2, lastAt: 0 }]);
    const stranger = buildLadderPage('hand', seeds, stats([]), 99);
    expect(stranger.me).toEqual({
      rank: null,
      rating: 1000,
      ratedGames: 0,
      placed: false,
      wins: 0,
      losses: 0,
      form: [],
    });
  });

  it('lists the placing accounts by games then recency, capped, never the unplayed', () => {
    const seeds = [
      seed(1, 1000, 1),
      seed(2, 1000, 2),
      seed(3, 1000, 1),
      seed(4, 1000, 0),
      seed(5, 1000, 2),
    ];
    const st = stats([
      [1, { lastAt: 500 }],
      [3, { lastAt: 900 }],
      [2, { lastAt: 100 }],
      [5, { lastAt: 200 }],
    ]);
    const page = buildLadderPage('hand', seeds, st, 1);
    expect(page.placing.map((p) => p.id)).toEqual([5, 2, 3, 1]);
    expect(
      buildLadderPage('hand', seeds, st, 1, { placingCap: 2 }).placing.map((p) => p.id),
    ).toEqual([5, 2]);
  });

  it('carries the ranked bots on the bot ways and the forged favorite on the Forge way', () => {
    const seeds = [seed(1, 1050, 4), seed(2, 1020, 3)];
    const st = stats([
      [
        1,
        {
          champions: new Map([
            ['forged_axe', 2],
            ['fenn', 1],
          ]),
        },
      ],
    ]);
    const bots = buildLadderPage('arena', seeds, st, 1, {
      bots: (id) =>
        id === 1
          ? [{ id: 'bot_1', name: 'Nightfall', championId: 'vesk', tally: { wins: 2, losses: 1 } }]
          : [],
    });
    expect(bots.rows[0]!.bots).toEqual([
      { id: 'bot_1', name: 'Nightfall', championId: 'vesk', tally: { wins: 2, losses: 1 } },
    ]);
    expect(bots.rows[1]!.bots).toEqual([]);
    const forge = buildLadderPage('forge', seeds, st, 1, {
      forged: (id) => (id === 'forged_axe' ? { name: 'Axe', splash: 'a/b.png' } : null),
    });
    expect(forge.rows[0]!.favorite).toEqual({
      championId: 'forged_axe',
      games: 2,
      forged: { name: 'Axe', splash: 'a/b.png' },
    });
    expect(forge.rows[1]!.favorite).toBeNull();
  });
});

describe('the account place for the home card', () => {
  it('says the rank when placed, the games and rating either way, the placed count', () => {
    const seeds = [seed(1, 1050, 4), seed(2, 1020, 3), seed(3, 1000, 1)];
    expect(placeOf(seeds, 2)).toEqual({ rank: 2, rating: 1020, games: 3, placed: true, total: 2 });
    expect(placeOf(seeds, 3)).toEqual({
      rank: null,
      rating: 1000,
      games: 1,
      placed: false,
      total: 2,
    });
    expect(placeOf(seeds, 9)).toEqual({
      rank: null,
      rating: 1000,
      games: 0,
      placed: false,
      total: 2,
    });
  });
});
