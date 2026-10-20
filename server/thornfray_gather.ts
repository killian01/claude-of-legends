// A Thornfray's gathering (CONTEXT.md: Thornfray; ADR 0035): the wait before
// its seats are dealt. The first person to enter opens one; whoever enters
// while it gathers joins it. It starts when its seats are full, when its
// time runs out, or when its opener presses Start now; an opener who leaves
// hands Start now to the next person in it. Pure: the service
// (server/thornfray_service.ts) holds one and tells its people where it
// stands.

import { BOUT_SEATS } from '../src/sim/content/bouts/match';

// How long a gathering waits for people, in milliseconds.
export const GATHER_MS = 20_000;

export interface Gathering {
  openedAt: number;
  // The people in it by connection, in the order they came: the first holds
  // Start now.
  people: number[];
  startNow: boolean;
}

export function openGathering(clientId: number, now: number): Gathering {
  return { openedAt: now, people: [clientId], startNow: false };
}

// Whether a person may join it now (it has a free seat, they are not in it).
export function joinGathering(g: Gathering, clientId: number, seats = BOUT_SEATS): boolean {
  if (g.people.includes(clientId) || g.people.length >= seats) return false;
  g.people.push(clientId);
  return true;
}

// A person leaves it; true when they were in it.
export function leaveGathering(g: Gathering, clientId: number): boolean {
  const i = g.people.indexOf(clientId);
  if (i < 0) return false;
  g.people.splice(i, 1);
  return true;
}

// Start now, the opener's alone; true when it was taken.
export function pressStartNow(g: Gathering, clientId: number): boolean {
  if (g.people[0] !== clientId) return false;
  g.startNow = true;
  return true;
}

// Why it starts now, or null while it still gathers (and for one nobody is
// left in).
export type GatherStart = 'full' | 'start_now' | 'timed_out';

export function gatheringStarts(g: Gathering, now: number, seats = BOUT_SEATS): GatherStart | null {
  if (g.people.length === 0) return null;
  if (g.people.length >= seats) return 'full';
  if (g.startNow) return 'start_now';
  if (now - g.openedAt >= GATHER_MS) return 'timed_out';
  return null;
}

// Whole seconds until it starts by its clock.
export function gatherSecondsLeft(g: Gathering, now: number): number {
  return Math.max(0, Math.ceil((g.openedAt + GATHER_MS - now) / 1000));
}

// Where it stands, for one person in it.
export function gatherStatus(
  g: Gathering,
  now: number,
  clientId: number,
  seats = BOUT_SEATS,
): { people: number; of: number; startsIn: number; opener: boolean } {
  return {
    people: g.people.length,
    of: seats,
    startsIn: gatherSecondsLeft(g, now),
    opener: g.people[0] === clientId,
  };
}
