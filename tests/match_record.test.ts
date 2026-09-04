// The match record (server/records.ts): what a finished match writes down
// about each seat, and in particular the rating movement, which only a
// rated match has. Everything that counts an account's rated play reads
// that field, so a record that carries it on an unrated match makes the
// ladder and the career count matches that moved nothing.

import { describe, expect, it } from 'vitest';
import { buildMatchRecord } from '../server/records';
import { wayStatsOf } from '../server/way_stats';
import type { ScoreRow } from '../src/sim/types';

const row = (unitId: number, team: 0 | 1, over: Partial<ScoreRow> = {}): ScoreRow => ({
  unitId,
  name: 'Vesk',
  player: null,
  championId: 'vesk',
  team,
  level: 10,
  kills: 1,
  deaths: 2,
  assists: 3,
  cs: 40,
  items: [],
  ...over,
});

// One owned seat against a house bot: exactly the Arena's shape when a
// single owner has bots deposited, and the shape a queued match takes
// when nobody sits on the other side.
const rows = [row(1, 0), row(2, 1, { championId: 'fenn', name: 'House laner' })];
const accounts = new Map([[1, 7]]);

describe('the rating movement on a match record', () => {
  it('writes the delta on a rated match', () => {
    const rec = buildMatchRecord(rows, accounts, 0, 900, 1000, {
      rated: true,
      deltas: new Map([[7, 3]]),
      ways: new Map([[1, 'bot']]),
      queue: 'arena',
    });
    expect(rec.rated).toBe(true);
    expect(rec.players[0]?.ratingDelta).toBe(3);
  });

  it('leaves it off an unrated match, even though the seat is owned', () => {
    const rec = buildMatchRecord(rows, accounts, 0, 900, 1000, {
      rated: false,
      // rateMatch answers for every seat whether or not it rated the
      // match, so the caller hands a zero here rather than nothing.
      deltas: new Map([[7, 0]]),
      ways: new Map([[1, 'bot']]),
      queue: 'arena',
    });
    expect(rec.rated).toBe(false);
    expect(rec.players[0]?.ratingDelta).toBeUndefined();
    expect('ratingDelta' in rec.players[0]!).toBe(false);
  });

  it('keeps unrated matches out of an account rated play on the way', () => {
    const unrated = buildMatchRecord(rows, accounts, 0, 900, 1000, {
      rated: false,
      deltas: new Map([[7, 0]]),
      ways: new Map([[1, 'bot']]),
      queue: 'arena',
    });
    const rated = buildMatchRecord(rows, accounts, 0, 900, 2000, {
      rated: true,
      deltas: new Map([[7, 3]]),
      ways: new Map([[1, 'bot']]),
      queue: 'arena',
    });
    const stats = wayStatsOf([unrated, unrated, unrated, rated], 'arena').get(7);
    expect(stats).toMatchObject({ games: 1, wins: 1, losses: 0, form: ['W'] });
  });
});
