// The battle royale's end screen (src/ui/royale_result.ts): the place, the
// takedowns, who won, the top of the ranking with its bot marks, and the
// ways on, from the result the server sends.

import { describe, expect, it } from 'vitest';
import type { RoyaleResult } from '../src/net/royale_wire';
import { ONE_LIFE_TOP, RESPAWN_TOP, royaleEnd } from '../src/ui/royale_result';

const top = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? 'Kestrel' : `Seat ${i + 1}`,
    championId: 'torv',
    score: 20 - i,
    bot: i % 2 === 0,
  }));

const result = (over: Partial<RoyaleResult> = {}): RoyaleResult => ({
  t: 'royale_result',
  v: 'one_life',
  place: 7,
  of: 50,
  score: 3,
  winner: 'Kestrel',
  top: top(12),
  ...over,
});

describe('the One life end screen', () => {
  it('says the place out of how many, the takedowns and who stood last', () => {
    const end = royaleEnd(result());
    expect(end.title).toBe('You placed 7th of 50');
    expect(end.won).toBe(false);
    expect(end.lines).toEqual(['3 takedowns', 'Kestrel is the last one standing.']);
  });

  it('shows the top five with a bot mark on every bot', () => {
    const end = royaleEnd(result());
    expect(end.heading).toBe('The top five');
    expect(end.rows).toHaveLength(ONE_LIFE_TOP);
    expect(end.rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5]);
    expect(end.rows.map((r) => r.bot)).toEqual([true, false, true, false, true]);
    expect(end.rows.some((r) => r.self)).toBe(false);
  });

  it('marks the viewer when they made the top five', () => {
    const end = royaleEnd(result({ place: 2 }));
    expect(end.rows.filter((r) => r.self).map((r) => r.place)).toEqual([2]);
  });

  it('says the match goes on when the viewer is out before it ends', () => {
    expect(royaleEnd(result({ winner: null })).lines).toEqual([
      '3 takedowns',
      'The match goes on without you.',
    ]);
  });

  it('crowns the last one standing', () => {
    const end = royaleEnd(result({ place: 1, score: 1 }));
    expect(end.title).toBe('Last one standing');
    expect(end.won).toBe(true);
    expect(end.lines).toEqual(['1st of 50, 1 takedown']);
  });

  it('offers the same rule set again, Respawn, and home', () => {
    const end = royaleEnd(result());
    expect([end.again, end.other, end.home]).toEqual(['Play again', 'Try Respawn', 'Back home']);
  });
});

describe('the Respawn end screen', () => {
  it('shows the final ranking, the place and the score', () => {
    const end = royaleEnd(result({ v: 'respawn', place: 3, score: 9 }));
    expect(end.title).toBe('You placed 3rd of 50');
    expect(end.heading).toBe('The final ranking');
    expect(end.rows).toHaveLength(RESPAWN_TOP);
    expect(end.rows[2]?.self).toBe(true);
    expect(end.lines).toEqual([
      '9 takedowns when the light went out',
      'Kestrel won with 20 takedowns.',
    ]);
    expect(end.other).toBe('Try One life');
  });

  it('names the best score a win', () => {
    const end = royaleEnd(result({ v: 'respawn', place: 1, score: 20 }));
    expect(end.title).toBe('Most takedowns');
    expect(end.won).toBe(true);
  });

  it('holds a short ranking as it is', () => {
    expect(royaleEnd(result({ v: 'respawn', top: top(3) })).rows).toHaveLength(3);
  });
});
