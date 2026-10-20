// Points in a Thornfray (ADR 0027, ADR 0035): its bouts pay their actions
// as the battle royale does (a takedown 10, an assist 5, a cache 1), each
// bout's RoyalePoints with its end awards off (server/royale_match.ts); the
// match's end pays once, after the Final, 40 to its first and 20 to its
// second and third, to a seat still playing (an order in the last three
// minutes of the match's time, the Lulls included), at the weight the
// people put on it (another person in the match doubles it). Bushels are
// never banked: they decide the match, the points are the ladder's. Pure.

import { activeNearEnd, POINTS, type PointsAward, weighted } from './points';
import { royaleWeight } from './royale_points';

// The end's award for a place in the match, or null below the third.
export function thornfrayEndReason(
  place: number,
): 'thornfray_first' | 'thornfray_top_three' | null {
  if (place === 1) return 'thornfray_first';
  if (place >= 2 && place <= 3) return 'thornfray_top_three';
  return null;
}

// A person's seat at the match's end: the connection told, the line it
// banks on, its seat, and the match's tick of its last order.
export interface ThornfrayPointsSeat {
  clientId: number;
  owner: number;
  seat: number;
  lastOrderAt: number;
}

// The end's awards: `places` by seat (1 the first), `seats` the people
// connected at the end, `matchTick` the match's clock then.
export function thornfrayEndAwards(
  places: readonly number[],
  seats: readonly ThornfrayPointsSeat[],
  matchTick: number,
): PointsAward[] {
  const weight = royaleWeight(seats.length);
  const out: PointsAward[] = [];
  for (const s of seats) {
    const reason = thornfrayEndReason(places[s.seat] ?? 0);
    if (!reason || !activeNearEnd(matchTick, s.lastOrderAt)) continue;
    const delta = weighted(POINTS[reason], weight);
    if (delta > 0) out.push({ clientId: s.clientId, owner: s.owner, reason, delta });
  }
  return out;
}
