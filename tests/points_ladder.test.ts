// The ladder of every human (server/points_ladder.ts, ADR 0027): accounts
// and Guests on one ladder by their points, names and numbers only, and
// the reader's own place.

import { describe, expect, it } from 'vitest';
import { buildPointsLadder, type PointsEntry } from '../server/points_ladder';

const line = (key: number, points: number, since = 0, name = `p${key}`): PointsEntry => ({
  key,
  name,
  points,
  guest: key < 0,
  since,
});

describe('the ladder of every human', () => {
  it('ranks accounts and Guests together by their points', () => {
    const ladder = buildPointsLadder([line(1, 40), line(-3, 90), line(2, 60)], null);
    expect(ladder.rows).toEqual([
      { rank: 1, name: 'p-3', points: 90, guest: true },
      { rank: 2, name: 'p2', points: 60, guest: false },
      { rank: 3, name: 'p1', points: 40, guest: false },
    ]);
    expect(ladder.total).toBe(3);
    expect(ladder.me).toBeNull();
  });

  it('puts a name on it with its first points, and not before', () => {
    const ladder = buildPointsLadder([line(1, 0), line(-2, 1)], null);
    expect(ladder.rows.map((r) => r.name)).toEqual(['p-2']);
    expect(ladder.total).toBe(1);
  });

  it('ranks equal points by the older line', () => {
    const ladder = buildPointsLadder([line(1, 50, 20), line(2, 50, 10)], null);
    expect(ladder.rows.map((r) => r.name)).toEqual(['p2', 'p1']);
  });

  it('caps the rows and still counts everyone on it', () => {
    const many = Array.from({ length: 12 }, (_, i) => line(i + 1, 100 - i));
    const ladder = buildPointsLadder(many, null, 5);
    expect(ladder.rows).toHaveLength(5);
    expect(ladder.total).toBe(12);
  });

  it("answers the reader's own place, on the ladder or not yet", () => {
    const entries = [line(1, 40), line(-3, 90), line(2, 60)];
    const on = buildPointsLadder(entries, { key: 1, name: 'p1', guest: false, named: true }, 1);
    expect(on.me).toEqual({ rank: 3, points: 40, name: 'p1', guest: false, named: true });
    const fresh = buildPointsLadder(entries, {
      key: -9,
      name: 'Wanderer 0042',
      guest: true,
      named: false,
    });
    expect(fresh.me).toEqual({
      rank: null,
      points: 0,
      name: 'Wanderer 0042',
      guest: true,
      named: false,
    });
  });

  it('never carries a key', () => {
    const ladder = buildPointsLadder([line(7, 5), line(-7, 6)], {
      key: 7,
      name: 'p7',
      guest: false,
      named: true,
    });
    expect(JSON.stringify(ladder)).not.toMatch(/"(key|id|accountId)"/);
  });
});
