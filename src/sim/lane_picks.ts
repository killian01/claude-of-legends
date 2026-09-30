// Lane preferences at champion select (CONTEXT.md: Lane preference; ADR
// 0026): how many seats of a five-seat team may ask for each lane, the
// lane a seat is offered before it chooses, and how a team's asks settle
// into one lane per seat. First come, first served: an ask is honored
// while its lane has room, in the order the asks came, and every seat
// left without one gets its default over what the others took. Pure and
// shared: the client's select greys a full lane with it and the server's
// matchmaker settles the team with it, so the two never disagree on what
// is open.

import { type ChampionRole, homeLane } from './content/champions';
import type { LaneId } from './content/map';
import { ELIGIBLE } from './fill';
import { LANE_SEATS } from './lanes';
import type { LanePreference } from './playbook/types';

// The four a seat may ask for, in the order the select shows them.
export const LANE_CHOICES: readonly LanePreference[] = ['top', 'mid', 'bot', 'jungle'];

// Seats per ask on a five-seat team: the sim's lanes (two top, one mid,
// two bot) and one forest. The forest's seat is the fill's second top
// (src/sim/fill.ts), so top and the forest share two seats between them.
export const LANE_CAPS: Readonly<Record<LanePreference, number>> = { ...LANE_SEATS, jungle: 1 };
export const TOP_AND_FOREST_CAP = 2;

// The order ties break in for the default, the sim's own (src/sim/lanes.ts).
const TIE_ORDER: readonly LaneId[] = ['top', 'bot', 'mid'];

export function isLanePreference(value: unknown): value is LanePreference {
  return value === 'top' || value === 'mid' || value === 'bot' || value === 'jungle';
}

// How many more seats may ask for a lane beside the asks already taken;
// zero or less when it is full.
export function laneRoom(taken: readonly LanePreference[], lane: LanePreference): number {
  let top = 0;
  let forest = 0;
  let same = 0;
  for (const t of taken) {
    if (t === 'top') top += 1;
    if (t === 'jungle') forest += 1;
    if (t === lane) same += 1;
  }
  const own = LANE_CAPS[lane] - same;
  if (lane === 'top' || lane === 'jungle') return Math.min(own, TOP_AND_FOREST_CAP - top - forest);
  return own;
}

// Whether one more seat may ask for the lane.
export function laneOpen(taken: readonly LanePreference[], lane: LanePreference): boolean {
  return laneRoom(taken, lane) > 0;
}

// The lane a seat is offered before it chooses, and the one a seat that
// asked nothing (or was refused) settles in: its champion's home lane
// while that has room, else the lane with the most room left, ties to
// top, then bot, then mid. Never the forest: nobody is sent there unasked.
export function defaultLane(role: ChampionRole | null, taken: readonly LanePreference[]): LaneId {
  const home = homeLane(role);
  if (home !== null && laneOpen(taken, home)) return home;
  let best = TIE_ORDER[0]!;
  for (const lane of TIE_ORDER) if (laneRoom(taken, lane) > laneRoom(taken, best)) best = lane;
  return best;
}

export interface LaneAsk {
  role: ChampionRole | null;
  // The lane the seat asked for; null or absent for none.
  lane?: LanePreference | null;
}

// One lane per seat, in the order given: every ask honored in that order
// while its lane has room, then every seat without one (it asked nothing,
// or its lane was full) takes its default over what is taken by then.
export function settleLanes(asks: readonly LaneAsk[]): LanePreference[] {
  const out: (LanePreference | null)[] = asks.map(() => null);
  const taken: LanePreference[] = [];
  for (const [i, ask] of asks.entries()) {
    if (!ask.lane || !laneOpen(taken, ask.lane)) continue;
    out[i] = ask.lane;
    taken.push(ask.lane);
  }
  for (const [i, ask] of asks.entries()) {
    if (out[i] !== null) continue;
    const lane = defaultLane(ask.role, taken);
    out[i] = lane;
    taken.push(lane);
  }
  return out.map((lane) => lane ?? 'top');
}

// Whether the fill would post this champion in the forest (a fighter, a
// tank, a skirmisher or an assassin): anyone may ask for the forest, and
// one who would not be posted there is warned that camps will be slow. An
// unknown role is flex, as the fill takes it.
export function forestFit(role: ChampionRole | null): boolean {
  return role === null || ELIGIBLE.jungle.includes(role);
}
