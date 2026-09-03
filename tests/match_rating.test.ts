// Rating across ways (ADR 0013, plan-bots phase 5): a match counts with an
// owned seat on each side, house bots move nothing, each seat moves the
// rating of its way, and the bot ratings live in the bots' store.

import { describe, expect, it } from 'vitest';
import { BotStore } from '../server/bot_store';
import { buildBotLadder } from '../server/ladder';
import { type OwnedSeat, type RatingBook, rateMatch, type SeatWay } from '../server/match_rating';
import { BASE_RATING } from '../server/rating';

function book(): RatingBook & { ratings: Map<string, number> } {
  const ratings = new Map<string, number>();
  const key = (id: number, way: SeatWay): string => `${id}:${way}`;
  return {
    ratings,
    read: (id, way) => ratings.get(key(id, way)) ?? BASE_RATING,
    apply: (id, way, delta) =>
      ratings.set(key(id, way), (ratings.get(key(id, way)) ?? BASE_RATING) + delta),
  };
}

describe('rating a match across ways', () => {
  it('counts with an owned seat on each side, whatever the way', () => {
    const b = book();
    const seats: OwnedSeat[] = [
      { accountId: 1, team: 0, way: 'hand' },
      { accountId: 2, team: 1, way: 'bot' },
    ];
    const out = rateMatch(seats, 0, true, b);
    expect(out.rated).toBe(true);
    const hand = out.results.find((r) => r.accountId === 1)!;
    const bot = out.results.find((r) => r.accountId === 2)!;
    expect(hand.way).toBe('hand');
    expect(hand.delta).toBeGreaterThan(0);
    expect(bot.way).toBe('bot');
    expect(bot.delta).toBeLessThan(0);
    expect(b.read(1, 'hand')).toBe(BASE_RATING + hand.delta);
    expect(b.read(2, 'bot')).toBe(BASE_RATING + bot.delta);
    // Each way is its own number: the loser's hand rating never moved.
    expect(b.read(2, 'hand')).toBe(BASE_RATING);
  });

  it('does not count with one side all house bots, or outside the public queue', () => {
    const b = book();
    const one = rateMatch([{ accountId: 1, team: 0, way: 'bot' }], 0, true, b);
    expect(one.rated).toBe(false);
    expect(one.results[0]!.delta).toBe(0);
    const lobby = rateMatch(
      [
        { accountId: 1, team: 0, way: 'hand' },
        { accountId: 2, team: 1, way: 'hand' },
      ],
      0,
      false,
      b,
    );
    expect(lobby.rated).toBe(false);
    expect([...b.ratings.values()]).toEqual([]);
  });

  it('weighs a fuller match more', () => {
    const light = rateMatch(
      [
        { accountId: 1, team: 0, way: 'hand' },
        { accountId: 2, team: 1, way: 'bot' },
      ],
      0,
      true,
      book(),
    );
    const full = rateMatch(
      [1, 2, 3, 4, 5].flatMap((i): OwnedSeat[] => [
        { accountId: i, team: 0, way: 'hand' },
        { accountId: i + 10, team: 1, way: 'bot' },
      ]),
      0,
      true,
      book(),
    );
    expect(full.results[0]!.delta).toBeGreaterThan(light.results[0]!.delta);
  });
});

describe('bot ratings in the store, and their ladder', () => {
  it('start at the base, move per way, and place after enough games', () => {
    const store = new BotStore(':memory:');
    expect(store.botRating(1, 'live')).toEqual({ rating: BASE_RATING, games: 0 });
    store.applyBotRating(1, 'live', 12);
    store.applyBotRating(1, 'live', -4);
    store.applyBotRating(1, 'arena', 7);
    store.applyBotRating(2, 'live', 30);
    expect(store.botRating(1, 'live')).toEqual({ rating: BASE_RATING + 8, games: 2 });
    expect(store.botRating(1, 'arena')).toEqual({ rating: BASE_RATING + 7, games: 1 });
    expect(store.botRating(2, 'live')).toEqual({ rating: BASE_RATING + 30, games: 1 });

    for (let i = 0; i < 3; i++) store.applyBotRating(3, 'live', 5);
    for (let i = 0; i < 4; i++) store.applyBotRating(4, 'live', 2);
    const names = new Map([
      [3, 'carol'],
      [4, 'dave'],
    ]);
    const ladder = buildBotLadder(store.listBotRatings('live'), (id) => names.get(id) ?? null);
    expect(ladder.map((r) => [r.rank, r.name, r.rating, r.ratedGames])).toEqual([
      [1, 'carol', BASE_RATING + 15, 3],
      [2, 'dave', BASE_RATING + 8, 4],
    ]);
    // An account that vanished from the registry does not place.
    const orphaned = buildBotLadder(store.listBotRatings('live'), () => null);
    expect(orphaned).toEqual([]);
    store.close();
  });
});
