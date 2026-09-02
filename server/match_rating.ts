// Rating a finished match across the ways a seat was played (ADR 0013,
// docs/design/bots.md): a match counts when each team holds at least one
// seat that belongs to an account, by hand or by its bot; a house bot
// never counts; each owned seat moves the rating of its way, and the more
// owned seats the more the match weighs. Pure over the seats it is handed
// and the two rating stores it reads and writes through.

import type { TeamId } from '../src/sim/types';
import { isRated, type RatedSeat, ratingDeltas } from './rating';

export type SeatWay = 'hand' | 'bot';

export interface OwnedSeat {
  accountId: number;
  team: TeamId;
  way: SeatWay;
}

export interface RatingBook {
  // The rating this account holds for this way of playing.
  read(accountId: number, way: SeatWay): number;
  apply(accountId: number, way: SeatWay, delta: number): void;
}

export interface SeatResult {
  accountId: number;
  way: SeatWay;
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
    rating: book.read(s.accountId, s.way),
    seat: s,
  }));
  const deltas = rated ? ratingDeltas(rows, winner) : new Map<number, number>();
  const results: SeatResult[] = [];
  for (const row of rows) {
    const delta = deltas.get(row.accountId) ?? 0;
    if (delta !== 0) book.apply(row.seat.accountId, row.seat.way, delta);
    results.push({
      accountId: row.seat.accountId,
      way: row.seat.way,
      delta,
      rating: book.read(row.seat.accountId, row.seat.way),
    });
  }
  return { rated, results };
}
