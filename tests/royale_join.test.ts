// Entering a battle royale (server/royale_join.ts, ADR 0031, ADR 0025):
// which running match takes a newcomer, and which bot's seat they take.

import { describe, expect, it } from 'vitest';
import {
  chooseBotSeat,
  chooseRoyaleMatch,
  type RoyaleCandidate,
  takesPeople,
} from '../server/royale_join';
import { CALM_S, DROP_S, JOIN_UNTIL_END_S, PLAY_S } from '../src/sim/royale/types';

const match = (over: Partial<RoyaleCandidate> = {}): RoyaleCandidate => ({
  matchId: 1,
  variant: 'respawn',
  stage: 'play',
  time: 60,
  dropEndsAt: DROP_S,
  endsAt: DROP_S + PLAY_S,
  people: 1,
  openSeats: 49,
  closing: false,
  ...over,
});

describe('who takes people', () => {
  it('Respawn takes people until two minutes from the end', () => {
    const end = DROP_S + PLAY_S;
    expect(takesPeople(match({ time: end - JOIN_UNTIL_END_S - 1 }))).toBe(true);
    expect(takesPeople(match({ time: end - JOIN_UNTIL_END_S }))).toBe(false);
    expect(takesPeople(match({ stage: 'drop', time: 1 }))).toBe(true);
  });

  it('One life takes people during the drop and the calm only', () => {
    const one = (time: number, stage: 'drop' | 'play' = 'play') =>
      takesPeople(match({ variant: 'one_life', time, stage }));
    expect(one(3, 'drop')).toBe(true);
    expect(one(DROP_S + CALM_S - 1)).toBe(true);
    expect(one(DROP_S + CALM_S)).toBe(false);
  });

  it('never a match that is over, closing, or full of people', () => {
    expect(takesPeople(match({ stage: 'over' }))).toBe(false);
    expect(takesPeople(match({ closing: true }))).toBe(false);
    expect(takesPeople(match({ openSeats: 0 }))).toBe(false);
  });
});

describe('the match to join', () => {
  it('is the liveliest of the variant, then the youngest, then the lowest id', () => {
    const list = [
      match({ matchId: 1, people: 1, time: 30 }),
      match({ matchId: 2, people: 3, time: 200 }),
      match({ matchId: 3, people: 3, time: 100 }),
      match({ matchId: 4, people: 9, variant: 'one_life', stage: 'drop', time: 2 }),
    ];
    expect(chooseRoyaleMatch(list, 'respawn')).toBe(3);
    expect(chooseRoyaleMatch(list, 'one_life')).toBe(4);
    expect(chooseRoyaleMatch([match({ matchId: 5, stage: 'over' })], 'respawn')).toBeNull();
  });
});

describe('the seat to take', () => {
  const seats = [
    { unitId: 3, championId: 'torv', dead: false, out: false, level: 3 },
    { unitId: 5, championId: 'fenn', dead: true, out: false, level: 9 },
    { unitId: 7, championId: 'fenn', dead: false, out: false, level: 4 },
    { unitId: 9, championId: 'vesk', dead: false, out: true, level: 8 },
  ];

  it('is a bot playing the champion picked, standing first', () => {
    expect(chooseBotSeat(seats, 'fenn')).toBe(7);
  });

  it('else a standing bot, the lowest unit id first', () => {
    expect(chooseBotSeat(seats, 'sylra')).toBe(3);
  });

  it('never a seat out for good', () => {
    expect(chooseBotSeat(seats, 'vesk')).toBe(3);
    expect(chooseBotSeat([seats[3]!], 'vesk')).toBeNull();
    expect(chooseBotSeat([seats[3]!], 'vesk', 8)).toBeNull();
  });

  // Respawn's field level (RoyaleMatch.takeBotSeat): the lower median of
  // every champion's level.
  const fenns = [
    { unitId: 2, championId: 'fenn', dead: false, out: false, level: 3 },
    { unitId: 4, championId: 'fenn', dead: false, out: false, level: 9 },
    { unitId: 6, championId: 'fenn', dead: false, out: false, level: 7 },
    { unitId: 8, championId: 'fenn', dead: false, out: false, level: 6 },
    { unitId: 10, championId: 'fenn', dead: false, out: false, level: 6 },
    { unitId: 12, championId: 'fenn', dead: true, out: false, level: 8 },
    { unitId: 14, championId: 'torv', dead: false, out: false, level: 8 },
  ];

  it('takes the standing seat of the picked champion nearest the field level', () => {
    // The standing fenn at 9 and the one at 7 are as near 8: the higher.
    expect(chooseBotSeat(fenns, 'fenn', 8)).toBe(4);
    expect(chooseBotSeat(fenns, 'fenn', 3)).toBe(2);
    expect(chooseBotSeat(fenns, 'fenn', 7)).toBe(6);
    // Two seats at the field's level: the lowest unit id.
    expect(chooseBotSeat(fenns, 'fenn', 6)).toBe(8);
  });

  it('keeps the picked champion and standing before the level', () => {
    // The torv at the field's level loses to any standing fenn.
    expect(chooseBotSeat(fenns, 'fenn', 8)).not.toBe(14);
    // A fenn down at the field's level loses to the standing ones.
    expect(chooseBotSeat(fenns, 'fenn', 8)).not.toBe(12);
    expect(chooseBotSeat(fenns.slice(5), 'fenn', 8)).toBe(12);
    // Another champion: the standing seats of every other, nearest the level.
    expect(chooseBotSeat(fenns, 'vesk', 8)).toBe(14);
    expect(chooseBotSeat(fenns, 'vesk', 3)).toBe(2);
  });

  it('keeps the lowest unit id without a field level', () => {
    expect(chooseBotSeat(fenns, 'fenn')).toBe(2);
    expect(chooseBotSeat(fenns, 'vesk')).toBe(2);
    expect(chooseBotSeat(seats, 'fenn')).toBe(7);
  });
});
