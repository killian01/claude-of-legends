// The ladder on the landing (src/ui/landing_ladder.ts): the ladder of every
// human (ADR 0027), the words a visitor reads over the rows, and a
// returning Guest's own line.

import { describe, expect, it } from 'vitest';
import { LADDER_PROMISE, ladderLead, meLine, pointsText } from '../src/ui/landing_ladder';

describe('the ladder on the landing', () => {
  it('promises a place for one match, with no account', () => {
    expect(LADDER_PROMISE).toMatch(/one match/i);
    expect(LADDER_PROMISE).toMatch(/no account/i);
  });

  it('writes points as a number people read', () => {
    expect(pointsText(1)).toBe('1 point');
    expect(pointsText(0)).toBe('0 points');
    expect(pointsText(1240)).toBe('1,240 points');
  });

  it('speaks to a fresh server rather than counting to zero', () => {
    expect(ladderLead({ total: 0 })).toBe(
      'Nobody is on it yet. The first name here could be yours.',
    );
  });

  it('counts everyone on it, Guests and accounts alike', () => {
    expect(ladderLead({ total: 1 })).toMatch(/^1 player on it, Guests and accounts alike/);
    expect(ladderLead({ total: 37 })).toMatch(/^37 players on it/);
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
