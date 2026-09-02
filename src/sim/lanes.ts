// Which lane a seat plays (CONTEXT.md: Home lane; docs/design/roster.md).
// A five-seat team holds one mid, two top, two bot. The champions of a
// team are seated in creation order, in two passes: first each takes its
// preferred lane (a bot's lane preference, else its role's home lane) while
// that lane has a seat open; then the rest (the flex skirmisher, a role
// past its lane's seats) take the lane with the most seats open, ties to
// top, then bot, then mid. Once every seat is taken the lanes reopen, so a
// bigger team cycles the same way. Pure and deterministic: the same seats
// in the same order give the same lanes on every host.

import type { LaneId } from './content/map';

export const LANE_SEATS: Readonly<Record<LaneId, number>> = { top: 2, mid: 1, bot: 2 };

// The order ties break in, and the order the count runs in.
const LANES: readonly LaneId[] = ['top', 'bot', 'mid'];

export interface LaneSeat {
  home: LaneId | null;
  // A bot's own lane preference, ahead of the home lane.
  prefer?: LaneId | null;
}

export function assignLanes(seats: readonly LaneSeat[]): LaneId[] {
  const open: Record<LaneId, number> = { ...LANE_SEATS };
  const out: (LaneId | null)[] = seats.map(() => null);
  const reopen = (): void => {
    if (LANES.every((lane) => open[lane] <= 0)) {
      for (const lane of LANES) open[lane] += LANE_SEATS[lane];
    }
  };
  const take = (i: number, lane: LaneId): void => {
    out[i] = lane;
    open[lane] -= 1;
  };
  for (const [i, seat] of seats.entries()) {
    reopen();
    const want = seat.prefer ?? seat.home;
    if (want !== null && open[want] > 0) take(i, want);
  }
  for (const [i] of seats.entries()) {
    if (out[i] !== null) continue;
    reopen();
    let best = LANES[0]!;
    for (const lane of LANES) if (open[lane] > open[best]) best = lane;
    take(i, best);
  }
  return out as LaneId[];
}
