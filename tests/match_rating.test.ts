// Rating across ways (ADR 0013, plan-bots phase 5): a match counts with an
// owned seat on each side, house bots move nothing, each seat moves the
// rating of its way, and the bot ratings live in the bots' store.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { BotStore } from '../server/bot_store';
import { buildBotLadder } from '../server/ladder';
import { type OwnedSeat, type RatingBook, rateMatch } from '../server/match_rating';
import { BASE_RATING } from '../server/rating';

// The book is keyed by the seat's rated subject (ADR 0016): the bot when
// the seat holds one, the account otherwise.
function subject(seat: OwnedSeat): string {
  return `${seat.botId ?? seat.accountId}:${seat.way}`;
}

function book(): RatingBook & { ratings: Map<string, number> } {
  const ratings = new Map<string, number>();
  return {
    ratings,
    read: (seat) => ratings.get(subject(seat)) ?? BASE_RATING,
    apply: (seat, delta) =>
      ratings.set(subject(seat), (ratings.get(subject(seat)) ?? BASE_RATING) + delta),
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
    expect(b.read({ accountId: 1, team: 0, way: 'hand' })).toBe(BASE_RATING + hand.delta);
    expect(b.read({ accountId: 2, team: 1, way: 'bot' })).toBe(BASE_RATING + bot.delta);
    // Each way is its own number: the loser's hand rating never moved.
    expect(b.read({ accountId: 2, team: 1, way: 'hand' })).toBe(BASE_RATING);
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
  it('belong to the bot, move per way, and place after enough games', () => {
    const store = new BotStore(':memory:');
    expect(store.botRating('b1', 'live')).toEqual({ rating: BASE_RATING, games: 0 });
    store.applyBotRating('b1', 7, 'live', 12);
    store.applyBotRating('b1', 7, 'live', -4);
    store.applyBotRating('b1', 7, 'arena', 7);
    store.applyBotRating('b2', 7, 'live', 30);
    expect(store.botRating('b1', 'live')).toEqual({ rating: BASE_RATING + 8, games: 2 });
    expect(store.botRating('b1', 'arena')).toEqual({ rating: BASE_RATING + 7, games: 1 });
    // Two bots of one account hold two ratings: the whole point of ADR
    // 0016 is that a weak one never drags a strong one.
    expect(store.botRating('b2', 'live')).toEqual({ rating: BASE_RATING + 30, games: 1 });

    for (let i = 0; i < 3; i++) store.applyBotRating('b3', 3, 'live', 5);
    for (let i = 0; i < 4; i++) store.applyBotRating('b4', 4, 'live', 2);
    const names = new Map([
      ['b3', 'Carol bot'],
      ['b4', 'Dave bot'],
    ]);
    const ladder = buildBotLadder(store.listBotRatings('live'), (id) => names.get(id) ?? null);
    expect(ladder.map((r) => [r.rank, r.id, r.name, r.rating, r.ratedGames])).toEqual([
      [1, 'b3', 'Carol bot', BASE_RATING + 15, 3],
      [2, 'b4', 'Dave bot', BASE_RATING + 8, 4],
    ]);
    // The row also names the owner, so a reader can reach the account.
    expect(ladder.map((r) => r.accountId)).toEqual([3, 4]);
    // A bot with no public name (its owner gone) does not place.
    const orphaned = buildBotLadder(store.listBotRatings('live'), () => null);
    expect(orphaned).toEqual([]);
    store.close();
  });
});

describe('the move of the rating from the account to the bot', () => {
  it('drops a store whose ratings were keyed by account, so every bot places again', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'loc-ratings-')), 'bots.sqlite3');
    // A store as it was before ADR 0016: the key was the account.
    const old = new DatabaseSync(file);
    old.exec(`create table bot_ratings (
      account_id integer not null,
      way text not null,
      rating integer not null,
      games integer not null,
      primary key (account_id, way)
    )`);
    old.prepare('insert into bot_ratings values (?, ?, ?, ?)').run(7, 'arena', 1234, 9);
    old.close();

    const store = new BotStore(file);
    // The rows cannot be split across the bots the account owns, so they
    // are gone and the table has the new shape.
    expect(store.listBotRatings('arena')).toEqual([]);
    store.applyBotRating('b1', 7, 'arena', 5);
    expect(store.botRating('b1', 'arena')).toEqual({ rating: BASE_RATING + 5, games: 1 });
    store.close();

    // Opening it again leaves the ratings alone: the migration runs once.
    const again = new BotStore(file);
    expect(again.botRating('b1', 'arena')).toEqual({ rating: BASE_RATING + 5, games: 1 });
    again.close();
  });
});
