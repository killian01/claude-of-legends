// Dropping in (ADR 0025): a player who enters the public queue while a
// public match is under way, with people in it, takes a bot's seat there
// instead of waiting in a queue nobody else is in. On a server where a
// handful of people come by in a day, two of them pressing Play within the
// same few seconds almost never happens; two of them being on during the
// same match does. Pure: the server hands in what it knows of its matches.

import type { TeamId } from '../src/sim/types';

// Only early in a match: a newcomer handed a champion twenty minutes in
// joins a match already decided, with nothing of the start to learn from.
export const DROP_IN_WINDOW_S = 8 * 60;

export interface DropInCandidate {
  matchId: number;
  // Seconds of match time.
  time: number;
  // Humans connected and playing in it (spectators do not count).
  humans: number;
  // Bot seats a newcomer may take.
  openSeats: number;
  // A public classic-queue match, still running: a lobby is private, a
  // Forge match has its own roster, a finished or abandoned one is gone.
  joinable: boolean;
}

function open(c: DropInCandidate, windowS: number): boolean {
  return c.joinable && c.humans > 0 && c.openSeats > 0 && c.time < windowS;
}

// The match to drop into, or null for the queue: the one with the most
// people, then the youngest, then the lowest id.
export function chooseDropIn(
  candidates: readonly DropInCandidate[],
  windowS: number = DROP_IN_WINDOW_S,
): number | null {
  let best: DropInCandidate | null = null;
  for (const c of candidates) {
    if (!open(c, windowS)) continue;
    if (
      !best ||
      c.humans > best.humans ||
      (c.humans === best.humans &&
        (c.time < best.time || (c.time === best.time && c.matchId < best.matchId)))
    ) {
      best = c;
    }
  }
  return best ? best.matchId : null;
}

// The side a newcomer joins: the one with fewer people on it, so two
// strangers meet as opponents; then the one with more bot seats to take;
// then the first. null when neither side has a seat to give.
export function dropInTeam(humans: [number, number], seats: [number, number]): TeamId | null {
  const can = [seats[0] > 0, seats[1] > 0];
  if (!can[0] && !can[1]) return null;
  if (!can[0]) return 1;
  if (!can[1]) return 0;
  if (humans[0] !== humans[1]) return humans[0] < humans[1] ? 0 : 1;
  if (seats[0] !== seats[1]) return seats[0] > seats[1] ? 0 : 1;
  return 0;
}

// What the landing says is going on (ADR 0025): people in a match someone
// could still drop into, and people waiting in the queue.
export interface Presence {
  playing: number;
  queued: number;
  joinable: boolean;
}

export function presenceOf(
  candidates: readonly DropInCandidate[],
  queued: number,
  windowS: number = DROP_IN_WINDOW_S,
): Presence {
  let playing = 0;
  let joinable = false;
  for (const c of candidates) {
    if (!c.joinable) continue;
    playing += c.humans;
    if (open(c, windowS)) joinable = true;
  }
  return { playing, queued, joinable };
}
