// Scores and places (src/sim/royale/score.ts): the leader by takedowns,
// fewer deaths then the lower id; the
// places of One life, champions falling on one tick ordered by the health
// they had on the tick before.

import { describe, expect, it } from 'vitest';
import {
  compareStanding,
  leaderOf,
  oneLifeRanking,
  placeFallen,
  respawnRanking,
} from '../src/sim/royale/score';

describe('Respawn scores', () => {
  it('names the leader by takedowns, then fewer deaths, then the lower id', () => {
    expect(leaderOf([])).toBeNull();
    expect(leaderOf([{ id: 1, score: 0, deaths: 0 }])).toBeNull();
    const rows = [
      { id: 7, score: 3, deaths: 2 },
      { id: 4, score: 3, deaths: 1 },
      { id: 2, score: 3, deaths: 1 },
      { id: 9, score: 1, deaths: 0 },
    ];
    expect(leaderOf(rows)).toBe(2);
    expect(respawnRanking(rows)).toEqual([2, 4, 7, 9]);
    expect(compareStanding(rows[0]!, rows[3]!)).toBeLessThan(0);
  });
});

describe('One life places', () => {
  it('places the fallen of one tick by their health the tick before', () => {
    expect(
      placeFallen(
        [
          { id: 3, hpBefore: 50 },
          { id: 8, hpBefore: 20 },
          { id: 5, hpBefore: 50 },
        ],
        10,
      ),
    ).toEqual([
      { id: 8, place: 10 },
      { id: 5, place: 9 },
      { id: 3, place: 8 },
    ]);
    // The last two falling together: the healthier one wins.
    expect(
      placeFallen(
        [
          { id: 1, hpBefore: 30 },
          { id: 2, hpBefore: 31 },
        ],
        2,
      ),
    ).toEqual([
      { id: 1, place: 2 },
      { id: 2, place: 1 },
    ]);
  });

  it('ranks the winner first, then the last out to the first', () => {
    expect(oneLifeRanking(4, [9, 2, 7])).toEqual([4, 7, 2, 9]);
    expect(oneLifeRanking(7, [9, 2, 7])).toEqual([7, 2, 9]);
    expect(oneLifeRanking(null, [1, 2])).toEqual([2, 1]);
  });
});
