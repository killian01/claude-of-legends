// What was actually played (scripts/meta_report.ts). The one thing here
// that is easy to get wrong and expensive to notice is which seats belong
// to a person: this deployment's match log is mostly the Arena, so a
// champion's real win rate and the house bots' win rate are different
// numbers that would happily share a column.

import { describe, expect, it } from 'vitest';
import {
  byHand,
  championRows,
  type MatchRow,
  median,
  overview,
  type SeatRow,
} from '../scripts/meta_report';

const seat = (over: Partial<SeatRow>): SeatRow => ({
  accountId: null,
  championId: 'sylra',
  team: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  cs: 0,
  ...over,
});

const match = (over: Partial<MatchRow>): MatchRow => ({
  at: Date.parse('2026-09-06T10:00:00Z'),
  durationS: 900,
  winner: 0,
  rated: false,
  players: [],
  ...over,
});

describe('a seat somebody played', () => {
  it('is one with an account and no way behind it', () => {
    expect(byHand(seat({ accountId: 7 }))).toBe(true);
  });

  it('is not a house bot, which has no account at all', () => {
    expect(byHand(seat({ accountId: null }))).toBe(false);
  });

  it('is not an account bot, which has one and is still not a person', () => {
    // The case that would quietly turn a bot's pick into a player's: the
    // Arena fields owned bots, so this is most of the log.
    expect(byHand(seat({ accountId: 7, way: 'bot' }))).toBe(false);
  });
});

describe('a champion row', () => {
  it('counts a seat as a win when its team is the winner', () => {
    const rows = championRows([
      match({
        winner: 1,
        players: [seat({ championId: 'vesk', team: 0 }), seat({ championId: 'vesk', team: 1 })],
      }),
    ]);
    expect(rows[0]).toMatchObject({ championId: 'vesk', seats: 2, wins: 1 });
  });

  it('keeps the seats a person played apart from every other seat', () => {
    const rows = championRows([
      match({
        winner: 0,
        players: [
          seat({ championId: 'dain', team: 0, accountId: 3 }),
          seat({ championId: 'dain', team: 1, accountId: 4, way: 'bot' }),
          seat({ championId: 'dain', team: 1 }),
        ],
      }),
    ]);
    expect(rows[0]).toMatchObject({ seats: 3, wins: 1, handSeats: 1, handWins: 1 });
  });

  it('adds the scores across every seat, and leads with the most played', () => {
    const rows = championRows([
      match({
        players: [
          seat({ championId: 'fenn', kills: 4, cs: 100 }),
          seat({ championId: 'fenn', kills: 2, cs: 50 }),
          seat({ championId: 'torv', kills: 9, cs: 10 }),
        ],
      }),
    ]);
    expect(rows.map((r) => r.championId)).toEqual(['fenn', 'torv']);
    expect(rows[0]).toMatchObject({ seats: 2, kills: 6, cs: 150 });
  });
});

describe('the overview', () => {
  it('separates the matches a person was in from the rest', () => {
    const o = overview([
      match({ players: [seat({ accountId: 1 })], rated: true }),
      match({ players: [seat({ accountId: 1, way: 'bot' })], queue: 'arena' }),
      match({ players: [seat({})] }),
    ]);
    expect(o).toMatchObject({ matches: 3, withHuman: 1, rated: 1, arena: 1 });
  });

  it('counts which side won, since the two halves are mirrored', () => {
    const o = overview([match({ winner: 0 }), match({ winner: 0 }), match({ winner: 1 })]);
    expect(o.blueWins).toBe(2);
  });
});

describe('the median', () => {
  it('is the middle of an odd list and the mean of the two in an even one', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBe(0);
  });
});
