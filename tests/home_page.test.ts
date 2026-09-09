// The home's panels (server/home_page.ts): the top of the ladder by hand
// with the reader marked, the top bots from the Arena or, until it has
// placed one, from live play, the latest champions out of the Forge as the
// gallery would list them, and the reader's own numbers.

import { describe, expect, it } from 'vitest';
import type { ForgedRow } from '../server/forge_store';
import {
  buildHomePage,
  careerOf,
  type ForgedListing,
  HOME_BOT_ROWS,
  HOME_FORGED_CARDS,
  HOME_LADDER_ROWS,
  type HomeInput,
  latestForged,
} from '../server/home_page';
import type { LadderSeed } from '../server/ladder_page';
import type { ProfileStats } from '../server/profile';
import type { WayStats } from '../server/way_stats';
import type { Way } from '../server/ways';
import { FORGED_TWINS } from './forged_twins';

const account = (id: number, rating: number, games: number): LadderSeed => ({
  id,
  accountId: id,
  name: `p${id}`,
  rating,
  games,
  createdAt: id,
});

const bot = (
  botId: string,
  accountId: number,
  rating: number,
  games: number,
  championId = 'fenn',
): LadderSeed => ({
  id: botId,
  accountId,
  name: `${botId}-name`,
  owner: `p${accountId}`,
  championId,
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

const NO_CAREER: ProfileStats = {
  games: 0,
  wins: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  perChampion: [],
  recent: [],
};

function forged(
  id: string,
  accountId: number,
  updatedAt: number,
  over: Partial<ForgedRow> & { likes?: number } = {},
): ForgedListing {
  const twin = FORGED_TWINS[updatedAt % FORGED_TWINS.length]!;
  return {
    id,
    accountId,
    def: { ...twin, id, creator: `p${accountId}` },
    status: 'finalized',
    createdAt: updatedAt - 1,
    updatedAt,
    listed: true,
    shared: true,
    takenDown: false,
    likes: 0,
    ...over,
  };
}

function input(over: Partial<HomeInput> = {}): HomeInput {
  const empty = new Map<string | number, WayStats>();
  return {
    seeds: () => [],
    stats: () => empty,
    forged: [],
    career: NO_CAREER,
    myBots: [],
    ...over,
  };
}

function ways(table: Partial<Record<Way, readonly LadderSeed[]>>): Pick<HomeInput, 'seeds'> {
  return { seeds: (way) => table[way] ?? [] };
}

describe('the home page', () => {
  it('shows the top of the ladder by hand, capped, with the reader marked', () => {
    const hand = [1, 2, 3, 4, 5, 6, 7].map((id) => account(id, 1000 + id * 10, 5));
    const page = buildHomePage(
      input({
        ...ways({ hand }),
        stats: (way) => (way === 'hand' ? stats([[7, { wins: 4, losses: 1 }]]) : new Map()),
      }),
      6,
    );
    expect(page.ladder.way).toBe('hand');
    expect(page.ladder.total).toBe(7);
    expect(page.ladder.rows).toHaveLength(HOME_LADDER_ROWS);
    expect(page.ladder.rows.map((r) => [r.rank, r.name, r.mine])).toEqual([
      [1, 'p7', false],
      [2, 'p6', true],
      [3, 'p5', false],
      [4, 'p4', false],
      [5, 'p3', false],
    ]);
    expect(page.ladder.rows[0]).toMatchObject({ wins: 4, losses: 1, rating: 1070 });
    // The reader's place stands whether or not their row made the top.
    expect(page.me.places.hand).toMatchObject({ rank: 2, placed: true, total: 7 });
    const beyond = buildHomePage(input(ways({ hand })), 1);
    expect(beyond.ladder.rows.some((r) => r.mine)).toBe(false);
    expect(beyond.me.places.hand).toMatchObject({ rank: 7, placed: true });
  });

  it('takes the top bots from the Arena, each naming its champion and owner', () => {
    const arena = [
      bot('b1', 1, 1050, 4, 'vesk'),
      bot('b2', 2, 1120, 6, 'torv'),
      bot('b3', 2, 1000, 1, 'fenn'),
    ];
    const page = buildHomePage(
      input({
        ...ways({ arena, bot: [bot('l1', 3, 1300, 9)] }),
        stats: (way) =>
          way === 'arena'
            ? stats([
                ['b2', { wins: 5, losses: 1, champions: new Map([['torv', 6]]) }],
                ['b1', { wins: 2, losses: 2, champions: new Map([['vesk', 4]]) }],
              ])
            : new Map(),
      }),
      2,
    );
    expect(page.bots.way).toBe('arena');
    expect(page.bots.total).toBe(2);
    expect(page.bots.rows.map((r) => [r.rank, r.name, r.owner, r.championId, r.mine])).toEqual([
      [1, 'b2-name', 'p2', 'torv', true],
      [2, 'b1-name', 'p1', 'vesk', false],
    ]);
    expect(page.bots.rows[0]).toMatchObject({ wins: 5, losses: 1, rating: 1120 });
  });

  it('falls back to the bots placed live while the Arena has placed none', () => {
    const live = [bot('l1', 3, 1300, 9), bot('l2', 4, 1200, 3)];
    const page = buildHomePage(input(ways({ arena: [bot('a1', 1, 1000, 2)], bot: live })), 1);
    expect(page.bots.way).toBe('bot');
    expect(page.bots.rows.map((r) => r.name)).toEqual(['l1-name', 'l2-name']);
    // Nobody placed anywhere: the Arena, empty, is the honest answer.
    const none = buildHomePage(input(ways({ arena: [bot('a1', 1, 1000, 2)] })), 1);
    expect(none.bots).toEqual({ way: 'arena', total: 0, rows: [] });
  });

  it('caps the bots at the row count', () => {
    const arena = Array.from({ length: HOME_BOT_ROWS + 3 }, (_, i) =>
      bot(`b${i}`, i + 1, 1000 + i, 5),
    );
    const page = buildHomePage(input(ways({ arena })), 99);
    expect(page.bots.rows).toHaveLength(HOME_BOT_ROWS);
    expect(page.bots.total).toBe(HOME_BOT_ROWS + 3);
  });

  it('lists the latest forged champions the way the gallery would', () => {
    const rows: ForgedListing[] = [
      forged('forged_a', 1, 10, { likes: 3 }),
      forged('forged_b', 2, 30),
      // Another account's unlisted champion is not on the home; the
      // reader's own is, listed or not.
      forged('forged_c', 2, 40, { listed: false }),
      forged('forged_d', 1, 50, { listed: false }),
      // A draft is not a champion yet; a champion taken down is gone.
      forged('forged_e', 2, 60, { status: 'draft' }),
      forged('forged_f', 2, 70, { takenDown: true }),
    ];
    // A sealed champion that no longer fits the rules reaches no match.
    const broken = forged('forged_g', 2, 80);
    broken.def = { ...broken.def, name: 'x'.repeat(200) };
    const cards = latestForged(
      [...rows, broken],
      1,
      (r) => (r.id === 'forged_a' ? 'a/splash.webp' : null),
      HOME_FORGED_CARDS,
    );
    expect(cards.map((c) => c.id)).toEqual(['forged_d', 'forged_b', 'forged_a']);
    expect(cards[2]).toMatchObject({
      id: 'forged_a',
      creator: 'p1',
      splash: 'a/splash.webp',
      likes: 3,
      mine: true,
    });
    expect(cards[1]).toMatchObject({ creator: 'p2', splash: null, mine: false });
    for (const c of cards) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(typeof c.role).toBe('string');
    }
  });

  it('caps the forged strip, newest first', () => {
    const rows = Array.from({ length: HOME_FORGED_CARDS + 4 }, (_, i) =>
      forged(`forged_${i}`, 3, 100 + i),
    );
    const page = buildHomePage(input({ forged: rows }), 1);
    expect(page.forged).toHaveLength(HOME_FORGED_CARDS);
    expect(page.forged[0]?.id).toBe(`forged_${HOME_FORGED_CARDS + 3}`);
    // The reader made none of them.
    expect(page.me.forged).toBe(0);
  });

  it("reads the reader's own numbers: places, career, bots, sealed champions", () => {
    const career: ProfileStats = {
      games: 12,
      wins: 7,
      kills: 60,
      deaths: 36,
      assists: 84,
      perChampion: [
        {
          championId: 'sylra',
          games: 8,
          wins: 5,
          kills: 40,
          deaths: 20,
          assists: 50,
          cs: 800,
          mastery: 2,
          masteryTitle: 'Adept',
        },
        {
          championId: 'fenn',
          games: 4,
          wins: 2,
          kills: 20,
          deaths: 16,
          assists: 34,
          cs: 400,
          mastery: 1,
          masteryTitle: 'Novice',
        },
      ],
      recent: [
        {
          at: 5000,
          durationS: 900,
          win: true,
          championId: 'sylra',
          kills: 5,
          deaths: 2,
          assists: 7,
          cs: 100,
        },
      ],
    };
    expect(careerOf(career)).toEqual({
      games: 12,
      wins: 7,
      kills: 60,
      deaths: 36,
      assists: 84,
      favorite: { championId: 'sylra', games: 8 },
      lastAt: 5000,
    });
    expect(careerOf(NO_CAREER)).toMatchObject({ games: 0, favorite: null, lastAt: null });

    const page = buildHomePage(
      input({
        ...ways({
          hand: [account(1, 1040, 4), account(2, 1010, 3)],
          arena: [bot('b1', 1, 1120, 5), bot('b2', 2, 1000, 1)],
          bot: [bot('b1', 1, 1000, 1)],
          forge: [{ id: 1, accountId: 1, name: 'p1', rating: 1000, games: 0 }],
        }),
        career,
        myBots: [{ deposited: true }, { deposited: false }, { deposited: true }],
        forged: [
          forged('forged_mine', 1, 10),
          forged('forged_mine_unlisted', 1, 20, { listed: false }),
          forged('forged_draft', 1, 30, { status: 'draft' }),
          forged('forged_theirs', 2, 40),
        ],
      }),
      1,
    );
    expect(page.me.places.hand).toMatchObject({ rank: 1, rating: 1040, games: 4, placed: true });
    expect(page.me.places.arena).toMatchObject({ rank: 1, rating: 1120, games: 5, placed: true });
    expect(page.me.places.bot).toMatchObject({ rank: null, rating: 1000, games: 1, placed: false });
    expect(page.me.places.forge).toMatchObject({ rank: null, games: 0, placed: false });
    expect(page.me.career.favorite).toEqual({ championId: 'sylra', games: 8 });
    expect(page.me.bots).toEqual({ total: 3, ranked: 2 });
    expect(page.me.forged).toBe(2);
  });

  it('reads each way once however many panels want it', () => {
    const asked: Way[] = [];
    buildHomePage(
      input({
        seeds: (way) => {
          asked.push(way);
          return way === 'arena' ? [bot('b1', 1, 1100, 5)] : [];
        },
      }),
      1,
    );
    expect(asked.sort()).toEqual(['arena', 'bot', 'forge', 'hand']);
  });
});
