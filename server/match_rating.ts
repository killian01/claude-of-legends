// Rating a finished match across the ways a seat was played (ADR 0013,
// amended by ADR 0016, docs/design/bots.md): a match counts when each team
// holds at least one seat that belongs to an account, by hand or by its
// bot; a house bot never counts; each owned seat moves the rating of its
// way, and the more owned seats the more the match weighs.
//
// What a seat's rating belongs to is the seat's rated subject: the account
// for a hand seat, the bot itself for a bot seat. This module never has to
// know which, because it hands the whole seat to the book and the book
// answers; it only cares that a seat belongs to somebody, which is what
// makes the match rated at all.

import type { TeamId } from '../src/sim/types';
import { isRated, type RatedSeat, ratingDeltas } from './rating';

export type SeatWay = 'hand' | 'bot';

export interface OwnedSeat {
  // The owner, always: it is what makes the seat owned, and what the match
  // record names. On a bot seat the rating belongs to the bot instead.
  accountId: number;
  team: TeamId;
  way: SeatWay;
  // The bot in the seat, present exactly when the way is 'bot'.
  botId?: string;
}

export interface RatingBook {
  // The rating this seat's subject holds for this way of playing.
  read(seat: OwnedSeat): number;
  apply(seat: OwnedSeat, delta: number): void;
}

export interface SeatResult {
  accountId: number;
  way: SeatWay;
  // The bot the seat held, when it held one: the caller keys its own
  // reading by whatever the seat's subject was.
  botId?: string;
  delta: number;
  rating: number;
}

// Rates the match and applies every movement. Returns the outcome per
// seat, deltas zero when the match was not rated; the caller tells each
// owner and writes the record.
export function rateMatch(
  seats: readonly OwnedSeat[],
  winner: TeamId,
  eligible: boolean,
  book: RatingBook,
): { rated: boolean; results: SeatResult[] } {
  const ownedByTeam: [number, number] = [
    seats.filter((s) => s.team === 0).length,
    seats.filter((s) => s.team === 1).length,
  ];
  const rated = eligible && isRated(ownedByTeam);
  // One account may hold two seats in theory (a hand seat and a bot seat
  // cannot coincide in one match today, but the arithmetic must not care):
  // the Elo runs over seats, keyed by a seat id, and the deltas land per
  // seat.
  const rows: (RatedSeat & { seat: OwnedSeat })[] = seats.map((s, i) => ({
    accountId: i,
    team: s.team,
    rating: book.read(s),
    seat: s,
  }));
  const deltas = rated ? ratingDeltas(rows, winner) : new Map<number, number>();
  const results: SeatResult[] = [];
  for (const row of rows) {
    const delta = deltas.get(row.accountId) ?? 0;
    if (delta !== 0) book.apply(row.seat, delta);
    results.push({
      accountId: row.seat.accountId,
      way: row.seat.way,
      ...(row.seat.botId !== undefined ? { botId: row.seat.botId } : {}),
      delta,
      rating: book.read(row.seat),
    });
  }
  return { rated, results };
}
