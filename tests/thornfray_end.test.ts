// A Thornfray's end screen, decided (src/ui/thornfray_end.ts): the place,
// the bushels, the bouts won and the ladder points, the table of eight and
// the person's bouts, and the three ways on.

import { describe, expect, it } from 'vitest';
import type { ThornfrayResult } from '../src/net/royale_wire';
import { boutKindOf } from '../src/sim/content/bouts';
import { boutLine, boutsWonText, thornfrayEnd } from '../src/ui/thornfray_end';

const kindName = (id: string): string | null => boutKindOf(id)?.name ?? null;

const RESULT: ThornfrayResult = {
  t: 'thornfray_result',
  place: 2,
  of: 8,
  seat: 2,
  bushels: 17,
  won: 1,
  points: 45,
  table: [
    [0, 'Fogtinder', 'vesk', 1, 21, 2],
    [2, 'Wren', 'torv', 0, 17, 1],
    [5, 'Moss', 'sylra', 1, 3, 0],
  ],
  bouts: [
    { k: 'lastwick', pl: 1, paid: 5 },
    { k: 'starglean', pl: 4, paid: 2 },
  ],
  replays: [41, 42],
};

describe("a Thornfray's end", () => {
  it('says the place, the bushels, the winner and the points', () => {
    const m = thornfrayEnd(RESULT, kindName);
    expect(m.title).toBe('You placed 2nd of 8');
    expect(m.won).toBe(false);
    expect(m.lines).toEqual([
      '17 bushels · 1 bout won',
      'Fogtinder takes the Thornfray, 21 bushels.',
      '+45 ladder points this match',
    ]);
  });

  it('says the win, and no points line when none were banked', () => {
    const m = thornfrayEnd({ ...RESULT, place: 1, points: 0 }, kindName);
    expect(m.title).toBe('Thornfray won');
    expect(m.won).toBe(true);
    expect(m.lines).toEqual(['17 bushels · 1 bout won']);
  });

  it('lists the table best first, the person marked, and their bouts in order', () => {
    const m = thornfrayEnd(RESULT, kindName);
    expect(m.rows.map((r) => [r.place, r.name, r.bushels, r.won, r.bot, r.self])).toEqual([
      [1, 'Fogtinder', 21, 2, true, false],
      [2, 'Wren', 17, 1, false, true],
      [3, 'Moss', 3, 0, true, false],
    ]);
    expect(m.bouts).toEqual(['1. Lastwick 1st +5', '2. Starglean 4th +2']);
    expect(boutLine(3, 'Unknown', 0, -1)).toBe('3. Unknown - +0');
    expect(boutsWonText(2)).toBe('2 bouts won');
  });

  it('offers Play again, the battle royale and home', () => {
    const m = thornfrayEnd(RESULT, kindName);
    expect([m.again, m.other, m.home]).toEqual(['Play again', 'Battle royale', 'Back home']);
  });
});
