// The Elo policy: rated only with a human on each side, symmetric deltas,
// K scaling with the human count, upsets paying more than favorites.

import { describe, expect, it } from 'vitest';
import type { Account } from '../server/accounts';
import { buildLadder, LADDER_CAP, MIN_RATED_GAMES } from '../server/ladder';
import {
  isRated,
  K_MAX,
  LEAVER_RATING_PENALTY,
  leaverPenalty,
  type RatedSeat,
  ratingDeltas,
} from '../server/rating';

const seat = (accountId: number, team: 0 | 1, rating: number): RatedSeat => ({
  accountId,
  team,
  rating,
});

describe('rating policy', () => {
  it('a match is rated only with a human on each side', () => {
    expect(isRated([1, 1])).toBe(true);
    expect(isRated([5, 5])).toBe(true);
    expect(isRated([1, 0])).toBe(false);
    expect(isRated([0, 0])).toBe(false);
  });

  it('equal teams split K evenly and symmetrically', () => {
    const deltas = ratingDeltas([seat(1, 0, 1000), seat(2, 1, 1000)], 0);
    // Two humans: K = K_MAX * 2/10; an even match moves half of that.
    const expected = Math.round(((K_MAX * 2) / 10) * 0.5);
    expect(deltas.get(1)).toBe(expected);
    expect(deltas.get(2)).toBe(-expected);
  });

  it('an upset pays more than a favorite win', () => {
    const upset = ratingDeltas([seat(1, 0, 900), seat(2, 1, 1100)], 0);
    const favorite = ratingDeltas([seat(1, 0, 1100), seat(2, 1, 900)], 0);
    expect(upset.get(1)!).toBeGreaterThan(favorite.get(1)!);
    // A heavy favorite's win still moves at least one point.
    const crush = ratingDeltas([seat(1, 0, 2000), seat(2, 1, 1000)], 0);
    expect(crush.get(1)).toBe(1);
    expect(crush.get(2)).toBe(-1);
  });

  it('scales K with the human count and moves teammates together', () => {
    const duo = ratingDeltas(
      [seat(1, 0, 1000), seat(2, 0, 1000), seat(3, 1, 1000), seat(4, 1, 1000)],
      1,
    );
    const solo = ratingDeltas([seat(1, 0, 1000), seat(3, 1, 1000)], 1);
    expect(Math.abs(duo.get(1)!)).toBeGreaterThan(Math.abs(solo.get(1)!));
    expect(duo.get(1)).toBe(duo.get(2));
    expect(duo.get(3)).toBe(duo.get(4));
    expect(duo.get(3)!).toBeGreaterThan(0);
  });

  it('returns nothing when one side has no human seat', () => {
    expect(ratingDeltas([seat(1, 0, 1000)], 0).size).toBe(0);
  });

  it('punishes a walk-out only when the match was rateable', () => {
    expect(leaverPenalty([1, 1])).toBe(LEAVER_RATING_PENALTY);
    expect(leaverPenalty([3, 2])).toBe(LEAVER_RATING_PENALTY);
    // Solo or duo against pure bot fill: leaving costs nothing.
    expect(leaverPenalty([1, 0])).toBe(0);
    expect(leaverPenalty([2, 0])).toBe(0);
    expect(leaverPenalty([0, 0])).toBe(0);
  });
});

const account = (id: number, rating: number, ratedGames: number): Account => ({
  id,
  name: `p${id}`,
  fold: `p${id}`,
  password: { salt: 'salt', hash: 'hash' },
  createdAt: id,
  seenAt: id,
  rating,
  ratedGames,
});

describe('ladder', () => {
  it('ranks by rating, requires placement games, caps the list', () => {
    const accounts = [
      account(1, 1040, MIN_RATED_GAMES),
      account(2, 1100, MIN_RATED_GAMES + 2),
      account(3, 2000, MIN_RATED_GAMES - 1),
      account(4, 990, MIN_RATED_GAMES),
    ];
    const rows = buildLadder(accounts);
    // Account 3 has not placed yet despite the highest rating.
    expect(rows.map((r) => r.id)).toEqual([2, 1, 4]);
    expect(rows[0]).toMatchObject({ rank: 1, name: 'p2', rating: 1100 });
    const many = buildLadder(
      Array.from({ length: LADDER_CAP + 10 }, (_, i) => account(i + 1, 1000 + i, MIN_RATED_GAMES)),
    );
    expect(many).toHaveLength(LADDER_CAP);
    expect(many[0]!.rating).toBe(1000 + LADDER_CAP + 9);
  });
});
