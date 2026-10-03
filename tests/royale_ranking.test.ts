// The battle royale's ranking and result (server/royale_ranking.ts).

import { describe, expect, it } from 'vitest';
import { placeOf, type RankedSeat, royaleRanking, royaleResult } from '../server/royale_ranking';

const seats: RankedSeat[] = [1, 2, 3, 4, 5].map((id) => ({
  unitId: id,
  name: `s${id}`,
  championId: 'fenn',
  bot: id !== 1,
  deaths: id === 3 ? 4 : 1,
}));

describe('One life', () => {
  const state = {
    variant: 'one_life' as const,
    stage: 'play' as const,
    scores: new Map([[2, 3]]),
    eliminated: [4, 5],
    winnerId: null,
  };

  it('ranks the standing first, then the fallen, the last to fall first', () => {
    expect(royaleRanking(state, seats)).toEqual([2, 1, 3, 5, 4]);
  });

  it('knows a place the moment a champion is out, and the winner first', () => {
    expect(placeOf(state, 5, 4)).toBe(5);
    expect(placeOf(state, 5, 5)).toBe(4);
    expect(placeOf(state, 5, 1)).toBeNull();
    expect(placeOf({ ...state, winnerId: 2 }, 5, 2)).toBe(1);
  });

  it('tells the fallen their place and the top', () => {
    const r = royaleResult(state, seats, 4);
    expect(r).toMatchObject({ t: 'royale_result', v: 'one_life', place: 5, of: 5, score: 0 });
    expect(r.winner).toBeNull();
    expect(r.top.map((t) => t.name)).toEqual(['s2', 's1', 's3', 's5', 's4']);
    expect(r.top[1]).toEqual({ name: 's1', championId: 'fenn', score: 0, bot: false });
  });
});

describe('Respawn', () => {
  const state = {
    variant: 'respawn' as const,
    stage: 'over' as const,
    scores: new Map([
      [1, 4],
      [2, 6],
      [3, 4],
    ]),
    eliminated: [],
    winnerId: 2,
  };

  it('ranks by score, fewer deaths first on a tie, the winner on top', () => {
    expect(royaleRanking(state, seats)).toEqual([2, 1, 3, 4, 5]);
  });

  it('tells the place at the end and names the winner', () => {
    const r = royaleResult(state, seats, 3);
    expect(r).toMatchObject({ v: 'respawn', place: 3, of: 5, score: 4, winner: 's2' });
  });
});
