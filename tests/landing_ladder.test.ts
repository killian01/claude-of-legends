// The ladder on the landing (src/ui/landing_ladder.ts): the words a visitor
// reads over the rows, and the row text.

import { describe, expect, it } from 'vitest';
import { columnTitle, type LandingLadder, ladderLead, recordText } from '../src/ui/landing_ladder';

const empty = (way: LandingLadder['way']): LandingLadder => ({ way, total: 0, rows: [] });
const some = (way: LandingLadder['way'], total: number): LandingLadder => ({
  way,
  total,
  rows: [{ rank: 1, name: 'a', rating: 1200, wins: 10, losses: 2, owner: null }],
});

describe('the ladder on the landing', () => {
  it('names the two columns', () => {
    expect(columnTitle('hand')).toBe('By hand');
    expect(columnTitle('arena')).toBe('Bots');
    expect(columnTitle('bot')).toBe('Bots');
  });

  it('writes a record as wins and losses', () => {
    expect(recordText({ wins: 12, losses: 3 })).toBe('12 W / 3 L');
  });

  it('speaks to a fresh server rather than counting to zero', () => {
    expect(ladderLead({ ladder: empty('hand'), bots: empty('arena'), accounts: 0 })).toBe(
      'Nobody has placed yet. The first name here could be yours.',
    );
    expect(ladderLead({ ladder: empty('hand'), bots: empty('arena'), accounts: 4 })).toBe(
      '4 accounts, none placed yet. The first name here could be yours.',
    );
  });

  it('counts the placed names across both columns and offers the place', () => {
    expect(ladderLead({ ladder: some('hand', 7), bots: some('arena', 3), accounts: 40 })).toBe(
      '10 names placed, 40 accounts. Yours goes here with a free account.',
    );
    expect(ladderLead({ ladder: some('hand', 1), bots: empty('arena'), accounts: 2 })).toBe(
      '1 name placed, 2 accounts. Yours goes here with a free account.',
    );
  });
});
