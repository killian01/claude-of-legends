// The ladder on the landing (src/ui/landing_ladder.ts): the ladder of every
// human (ADR 0027), the words a visitor reads over the rows, and a
// returning Guest's own line.

import { describe, expect, it } from 'vitest';
import { ladderLead, meLine, pointsText, rowPoints } from '../src/ui/landing_ladder';

describe('the ladder on the landing', () => {
  it('writes points as a number people read, the word once over the rows', () => {
    expect(pointsText(1)).toBe('1 point');
    expect(pointsText(0)).toBe('0 points');
    expect(pointsText(1240)).toBe('1,240 points');
    expect(rowPoints(1240)).toBe('1,240');
    expect(ladderLead({ total: 37 })).toMatch(/points/);
  });

  it('speaks to a fresh server rather than counting to zero', () => {
    expect(ladderLead({ total: 0 })).toBe(
      'Nobody is on it yet. The first name here could be yours.',
    );
  });

  // The hero says that one match puts a name here, with no account; the
  // ladder says it no second time (the maintainer, 2026-10-02).
  it('counts everyone on it, and repeats nothing the hero says', () => {
    expect(ladderLead({ total: 1 })).toBe('1 player, ranked by the points their matches earned.');
    expect(ladderLead({ total: 37 })).toMatch(/^37 players, ranked/);
    expect(ladderLead({ total: 37 })).not.toMatch(/account|guest/i);
  });

  it('tells a returning Guest where they stand, once they are on it', () => {
    expect(meLine(null)).toBeNull();
    expect(
      meLine({ rank: null, points: 0, name: 'Wanderer 0042', guest: true, named: false }),
    ).toBeNull();
    expect(meLine({ rank: 12, points: 340, name: 'Starling', guest: true, named: true })).toBe(
      'You are #12 with 340 points. Play to climb.',
    );
  });
});
