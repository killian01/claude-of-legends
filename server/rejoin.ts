// What a live match still owes an account that stopped playing: a seat a
// bot is holding until they come back, and the queue lockout a walk-out
// earns. Both were Maps in the coordinator, keyed on the browser's
// session token; both are keyed on the account now (ADR 0006), which is
// what makes them mean anything.
//
// The keying is the whole point of this module. Against a browser token,
// a seat could only be reclaimed from the exact browser that dropped it,
// and a leaver escaped their queue lockout by clearing localStorage: the
// penalty died with the key. Against an account, the seat comes back on
// whatever device its owner logs in from, and the lockout follows the
// person who earned it.
//
// In memory on purpose, like the queue locks always were: a restart
// amnesties every lockout and drops every hold, and that is fine. A
// reservation outlives its match by nothing, and a restart ends every
// match anyway.

import type { TeamId } from '../src/sim/types';

export interface HeldSeat {
  matchId: number;
  name: string;
  team: TeamId;
  unitId: number;
  // A coach seat (ADR 0013): the bot kept playing; the coach comes back
  // to it, never to a stand-in.
  coach?: true;
}

export class RejoinRegistry {
  // Seats abandoned by a dropped connection; a bot holds the champion
  // meanwhile. Reservations die with their match.
  private readonly seats = new Map<number, HeldSeat>();
  // When each account's queue lockout runs out.
  private readonly queueLocks = new Map<number, number>();

  // A connection dropped mid-match: hold the seat for its owner.
  reserve(accountId: number, seat: HeldSeat): void {
    this.seats.set(accountId, seat);
  }

  // Claiming is one-shot: the seat is handed back once and the hold is
  // gone, so a second socket cannot be given a champion the first is
  // already playing.
  claim(accountId: number): HeldSeat | undefined {
    const seat = this.seats.get(accountId);
    if (seat) this.seats.delete(accountId);
    return seat;
  }

  // A deliberate walk-out holds no seat: reservations are for dropped
  // connections, and a player who chose to leave must not be pulled back
  // in by their next queue.
  drop(accountId: number): void {
    this.seats.delete(accountId);
  }

  held(accountId: number): HeldSeat | undefined {
    return this.seats.get(accountId);
  }

  // A match closed: every seat it was holding is meaningless now.
  pruneMatch(matchId: number): number {
    let dropped = 0;
    for (const [accountId, seat] of this.seats) {
      if (seat.matchId === matchId) {
        this.seats.delete(accountId);
        dropped++;
      }
    }
    return dropped;
  }

  lockQueue(accountId: number, until: number): void {
    this.queueLocks.set(accountId, until);
  }

  // Milliseconds still owed before this account may queue again, 0 when
  // it may queue now. A lock that has run out is forgotten on the way, so
  // the map does not keep an entry per leaver forever.
  queueLockRemaining(accountId: number, now: number): number {
    const until = this.queueLocks.get(accountId);
    if (until === undefined) return 0;
    if (until <= now) {
      this.queueLocks.delete(accountId);
      return 0;
    }
    return until - now;
  }

  get heldSeats(): number {
    return this.seats.size;
  }

  get lockedAccounts(): number {
    return this.queueLocks.size;
  }
}
