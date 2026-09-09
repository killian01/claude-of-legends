// Which lane a seat plays (CONTEXT.md: Home lane; docs/design/roster.md).
// A five-seat team holds one mid, two top, two bot. The champions of a
// team are seated in creation order, in two passes: first each takes its
// preferred lane (a bot's lane preference, else its role's home lane) while
// that lane has a seat open; then the rest (the flex skirmisher, a role
// past its lane's seats) take the lane with the most seats open, ties to
// top, then bot, then mid. Once every seat is taken the lanes reopen, so a
// bigger team cycles the same way. Pure and deterministic: the same seats
// in the same order give the same lanes on every host.

import { GAME_MAP, type GameMap, type LaneId } from './content/map';
import { hypot } from './exact';

export const LANE_SEATS: Readonly<Record<LaneId, number>> = { top: 2, mid: 1, bot: 2 };

// The order ties break in, and the order the count runs in.
const LANES: readonly LaneId[] = ['top', 'bot', 'mid'];

export interface LaneSeat {
  home: LaneId | null;
  // A bot's own lane preferences in order, ahead of the home lane: the
  // first with a seat open wins (plan-bots phase 12).
  prefer?: readonly LaneId[] | null;
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
    const want = (seat.prefer ?? []).find((lane) => open[lane] > 0) ?? seat.home;
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

// The closest point of a lane's polyline to (x, z).
export function laneDistance(
  lane: readonly { x: number; z: number }[],
  x: number,
  z: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < lane.length; i++) {
    const a = lane[i]!;
    const b = lane[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
    best = Math.min(best, hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

// Half the width of a lane's corridor: inside it a champion is in the lane.
export const LANE_HALF_WIDTH = 7;

// The lane whose corridor holds the point, the nearest when several do
// (the three meet at each base), null off every lane.
export function laneOf(x: number, z: number, map: GameMap = GAME_MAP): LaneId | null {
  let best: LaneId | null = null;
  let bestD = LANE_HALF_WIDTH;
  for (const lane of ['top', 'mid', 'bot'] as const) {
    const d = laneDistance(map.lanes[lane], x, z);
    if (d <= bestD) {
      best = lane;
      bestD = d;
    }
  }
  return best;
}
