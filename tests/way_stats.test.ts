// The match log read per way (server/way_stats.ts): rated seats only,
// each on its own way, the form newest first, the favorite champion.

import { describe, expect, it } from 'vitest';
import type { MatchPlayerRecord, MatchRecord } from '../server/records';
import { FORM_CAP, favoriteOf, wayStatsOf } from '../server/way_stats';

const seat = (over: Partial<MatchPlayerRecord>): MatchPlayerRecord => ({
  accountId: 7,
  name: 'bob',
  championId: 'fenn',
  team: 0,
  level: 10,
  kills: 1,
  deaths: 2,
  assists: 3,
  cs: 10,
  ...over,
});

const match = (
  at: number,
  winner: 0 | 1,
  players: MatchPlayerRecord[],
  queue?: 'forge' | 'arena',
): MatchRecord => ({
  at,
  durationS: 600,
  winner,
  rated: true,
  ...(queue !== undefined ? { queue } : {}),
  players,
});

describe('the stats of a way', () => {
  it('counts rated seats on their own way, hand and bot and Arena and Forge apart', () => {
    const records = [
      match(100, 0, [seat({ ratingDelta: 3 })]),
      match(200, 1, [seat({ ratingDelta: -3, championId: 'vesk' })]),
      match(300, 0, [seat({ ratingDelta: 4, way: 'bot' })]),
      match(400, 0, [seat({ ratingDelta: 4, way: 'bot' })], 'arena'),
      match(500, 0, [seat({ ratingDelta: 2 })], 'forge'),
      // Unrated seats and house bots count nowhere.
      match(600, 0, [seat({}), seat({ accountId: null, ratingDelta: 1 })]),
    ];
    const hand = wayStatsOf(records, 'hand').get(7);
    expect(hand).toMatchObject({ games: 2, wins: 1, losses: 1, form: ['L', 'W'], lastAt: 200 });
    expect([...hand!.champions]).toEqual([
      ['fenn', 1],
      ['vesk', 1],
    ]);
    expect(wayStatsOf(records, 'bot').get(7)).toMatchObject({ games: 1, wins: 1, lastAt: 300 });
    expect(wayStatsOf(records, 'arena').get(7)).toMatchObject({ games: 1, lastAt: 400 });
    expect(wayStatsOf(records, 'forge').get(7)).toMatchObject({ games: 1, lastAt: 500 });
  });

  it('reads the form newest first whatever the log order, capped', () => {
    const records: MatchRecord[] = [];
    for (let i = 0; i < FORM_CAP + 3; i++) {
      records.push(match(1000 + i, i % 3 === 0 ? 1 : 0, [seat({ ratingDelta: 1 })]));
    }
    const s = wayStatsOf(records.reverse(), 'hand').get(7)!;
    expect(s.form).toHaveLength(FORM_CAP);
    // The newest match is i = 12, a loss (12 % 3 === 0), then two wins.
    expect(s.form.slice(0, 3)).toEqual(['L', 'W', 'W']);
    expect(s.games).toBe(FORM_CAP + 3);
  });

  it('names the favorite as the most played champion, first played on a tie', () => {
    const s = wayStatsOf(
      [
        match(1, 0, [seat({ ratingDelta: 1, championId: 'dain' })]),
        match(2, 0, [seat({ ratingDelta: 1, championId: 'fenn' })]),
        match(3, 0, [seat({ ratingDelta: 1, championId: 'fenn' })]),
        match(4, 0, [seat({ ratingDelta: 1, championId: 'dain' })]),
      ],
      'hand',
    ).get(7);
    expect(favoriteOf(s)).toEqual({ championId: 'dain', games: 2 });
    expect(favoriteOf(undefined)).toBeNull();
  });
});
