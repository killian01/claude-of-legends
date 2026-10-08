// The battle royale's end screen (src/ui/royale_result.ts): the place, the
// takedowns, who won, the top of the ranking with its bot marks, and the
// ways on, from the result the server sends.

import { describe, expect, it } from 'vitest';
import type { RoyaleResult } from '../src/net/royale_wire';
import { goalModel } from '../src/ui/royale_goal';
import { ONE_LIFE_TOP, RESPAWN_TOP, royaleEnd, royaleSting } from '../src/ui/royale_result';

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
    expect(end.lines).toEqual(['9 takedowns', 'Kestrel won with 20 takedowns']);
    expect(end.other).toBe('Try One life');
  });

  it('names the best score a win', () => {
    const end = royaleEnd(result({ v: 'respawn', place: 1, score: 20 }));
    expect(end.title).toBe('Most takedowns');
    expect(end.won).toBe(true);
  });

  it('offers the next match first: the match kept running, entered anew', () => {
    const end = royaleEnd(result({ v: 'respawn' }));
    expect([end.again, end.other, end.home]).toEqual([
      'Play the next match',
      'Try One life',
      'Back home',
    ]);
  });

  it('holds a short ranking as it is', () => {
    expect(royaleEnd(result({ v: 'respawn', top: top(3) })).rows).toHaveLength(3);
  });
});

// A visitor drops into the standing Respawn match minutes in: the card
// counts from their landing (both playthrough cards opened "YOU PLACED
// 50TH OF 50" behind bots on 72), says how close the seat above was, and
// the best this browser kept.
describe('the Respawn end screen of a drop-in', () => {
  const winnerTop = top(10).map((t, i) => (i === 0 ? { ...t, name: 'Gloamwick', score: 72 } : t));
  const dropIn = (over: Partial<RoyaleResult> = {}): RoyaleResult =>
    result({
      v: 'respawn',
      place: 38,
      score: 3,
      winner: 'Gloamwick',
      top: winnerTop,
      window: { rank: 4, of: 50, score: 3 },
      gap: { name: 'Seat 9', by: 1 },
      held: 372,
      ...over,
    });

  it('titles the place since landing and keeps the lines in order', () => {
    const end = royaleEnd(dropIn(), { assists: 12, best: 0 });
    expect(end.title).toBe('4th since you landed');
    expect(end.won).toBe(false);
    expect(end.lines).toEqual([
      '3 takedowns and 12 assists in 6:12',
      'One takedown short of 3rd',
      'Gloamwick won with 72 takedowns',
      'Whole match: 38th of 50',
    ]);
    // The rows and the buttons are the whole match's, as before.
    expect(end.rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(end.rows.some((r) => r.self)).toBe(false);
    expect(end.again).toBe('Play the next match');
  });

  it('says a near miss of two, and none past it or without one', () => {
    const two = royaleEnd(dropIn({ gap: { name: 'Seat 9', by: 2 } }), { assists: 0, best: 0 });
    expect(two.lines[1]).toBe('2 takedowns short of 3rd');
    const none = royaleEnd(dropIn({ gap: undefined }), { assists: 0, best: 0 });
    expect(none.lines).toEqual([
      '3 takedowns in 6:12',
      'Gloamwick won with 72 takedowns',
      'Whole match: 38th of 50',
    ]);
  });

  it('says a new best, the best standing above, and nothing on a first match', () => {
    const lines = (best: number) => royaleEnd(dropIn(), { assists: 0, best }).lines;
    expect(lines(2)[2]).toBe('A new best: 3 takedowns');
    expect(lines(7)[2]).toBe('Your best: 7 takedowns');
    expect(lines(0)).not.toContainEqual(expect.stringMatching(/best/));
    expect(lines(3)).not.toContainEqual(expect.stringMatching(/best/));
  });

  it('tells a seat from the drop its whole-match place and near miss', () => {
    const end = royaleEnd(
      result({ v: 'respawn', place: 12, score: 9, held: 600, gap: { name: 'Seat 11', by: 2 } }),
      { assists: 4, best: 0 },
    );
    expect(end.title).toBe('You placed 12th of 50');
    expect(end.lines).toEqual([
      '9 takedowns and 4 assists in 10:00',
      '2 takedowns short of 11th',
      'Kestrel won with 20 takedowns',
    ]);
  });

  it('crowns the most takedowns without a near miss or a winner line', () => {
    const end = royaleEnd(result({ v: 'respawn', place: 1, score: 20, held: 600 }), {
      assists: 6,
      best: 25,
    });
    expect(end.title).toBe('Most takedowns');
    expect(end.lines).toEqual(['20 takedowns and 6 assists in 10:00', 'Your best: 25 takedowns']);
  });

  it('reads an older result without the new fields as before', () => {
    const end = royaleEnd(result({ v: 'respawn', place: 3, score: 9, held: 'x' as never }));
    expect(end.lines).toEqual(['9 takedowns', 'Kestrel won with 20 takedowns']);
  });

  it('leaves One life as it was, whatever the result carries', () => {
    const r = result({ window: { rank: 4, of: 50, score: 3 }, gap: { name: 'x', by: 1 }, held: 9 });
    const end = royaleEnd(r, { assists: 5, best: 9 });
    expect(end.title).toBe('You placed 7th of 50');
    expect(end.lines).toEqual(['3 takedowns', 'Kestrel is the last one standing.']);
  });
});

// What the end plays: Respawn's middle hears nothing, and a drop-in is
// judged on their window ("defeat" was every place but first).
describe('the end sting', () => {
  const at = (place: number, rank?: number): RoyaleResult =>
    result({
      v: 'respawn',
      place,
      ...(rank !== undefined ? { window: { rank, of: 50, score: 1 } } : {}),
    });

  it('plays a victory first, a defeat in the bottom half, nothing between', () => {
    expect([1, 3, 20, 40].map((p) => royaleSting(at(p)))).toEqual([
      'victory',
      null,
      null,
      'defeat',
    ]);
    expect(royaleSting(at(25))).toBeNull();
    expect(royaleSting(at(26))).toBe('defeat');
  });

  it('judges a drop-in on their window: a top three is a victory, and never a defeat', () => {
    expect([1, 3, 20, 40, 50].map((rank) => royaleSting(at(45, rank)))).toEqual([
      'victory',
      'victory',
      null,
      null,
      null,
    ]);
  });

  it('keeps One life as it was', () => {
    expect(royaleSting(result({ place: 1 }))).toBe('victory');
    expect(royaleSting(result({ place: 3 }))).toBe('defeat');
    expect(royaleSting(result({ place: 3, window: { rank: 1, of: 50, score: 2 } }))).toBe('defeat');
  });
});

describe('the goal across matches on the end card', () => {
  const goal = goalModel(30, 34);

  it("stands on Respawn's card when the seat banks points", () => {
    const end = royaleEnd(result({ v: 'respawn' }), { assists: 0, best: 0, goal });
    expect(end.goal).toBe(goal);
    expect(royaleEnd(result({ v: 'respawn' }), { assists: 0, best: 0 }).goal).toBeNull();
  });

  it("is never One life's", () => {
    expect(royaleEnd(result(), { assists: 0, best: 0, goal }).goal).toBeNull();
  });

  it('names no ladder entry and no other player', () => {
    const words = `${goal.title} ${goal.line}`;
    expect(words).not.toMatch(/ladder|rank|place|Kestrel/i);
  });
});
