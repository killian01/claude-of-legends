// The battle royale's set pieces (CONTEXT.md: Seedfall), data-as-code: when
// the Seedfalls fall and how many seeds each, where they may land, what the
// impact does and what the Seedfall cache pays. All times are seconds after
// landing; distances are chords (src/sim/geo.ts). The rules that read these
// live in src/sim/royale/seedfall.ts and src/sim/royale/caches.ts.

import type { RoyaleVariant } from '../royale/types';

// When each Seedfall lands, seconds after landing: five a match, the first
// at 2:00 as the caches run dry, then one every 70 s. Every 80 s, One life's
// fifth landed at 7:20 with two to five champions left, and two in five
// matches ended before anyone opened it (86% of the Seedfalls opened over
// seeds 1 to 40); every 70 s, 92% (the report, tuning round 1, 2026-10-04).
export const SEEDFALL_AT_S: readonly number[] = [120, 190, 260, 330, 400];
// A Seedfall is called this long before it lands (the announce draws its
// point and tells everyone).
export const SEEDFALL_WARN_S = 20;
// Seeds per Seedfall: one in One life, two at once in Respawn, where fifty
// seats keep coming back and one seed would be a single crowd.
export const SEEDFALL_SEEDS: Readonly<Record<RoyaleVariant, number>> = {
  one_life: 1,
  respawn: 2,
};
// Respawn's two seeds stand at least this far apart, when the light leaves
// room for it (seedfall.ts: else as far apart as it allows).
export const SEEDFALL_PAIR_M = 60;
// A seed lands inside the light as it will stand this long after the
// impact, at least this deep from its edge: the cache is worth walking to.
export const SEEDFALL_FORECAST_S = 30;
export const SEEDFALL_DEPTH_M = 10;
// The impact: every champion within this reach of the point takes this
// share of its maximum health as true damage and is thrown up this long.
export const SEEDFALL_IMPACT_M = 4;
export const SEEDFALL_IMPACT_SHARE = 0.1;
export const SEEDFALL_AIRBORNE_S = 0.75;
// The Seedfall cache: opened by standing still beside it this long, from
// this reach of its center, broken like any cache's opening in One life.
export const SEEDFALL_OPEN_S = 3;
export const SEEDFALL_REACH_M = 2.2;
// In Respawn a Seedfall cache's opening is held, not broken: a hit taken,
// a cast or an attack ordered, or a step inside the reach slows its clock
// to SEEDFALL_HELD_RATE until the opener has gone SEEDFALL_CALM_S
// undisturbed and still; only leaving the reach (or falling) breaks it.
// Fifty seats that come back fight about a hundred times a minute, and
// any hit broke a 3 s opening: fewer than half the Seedfalls were opened
// (tranche 1, 2026-10-04). A pause in place of the slowing left a crowd
// around the opener that never let its clock run. The opener keeps its
// claim while it holds, and when it falls or is driven out the cache keeps
// the time counted for the next one (caches.ts): the cache goes to whoever
// stands in the ring when the count is full. One life keeps the plain
// rule: its field is thin and a hit is a decision.
export const SEEDFALL_HELD: Readonly<Record<RoyaleVariant, boolean>> = {
  one_life: false,
  respawn: true,
};
export const SEEDFALL_HELD_RATE = 0.5;
export const SEEDFALL_CALM_S = 1;
// What it pays: pieces of the build, a share of the maximum health and of
// the maximum mana (both all of it). With Grafts it pays one piece and a
// Heartwood Graft offer; until Grafts ship, two pieces.
export const SEEDFALL_PIECES = 1;
export const SEEDFALL_PIECES_BEFORE_GRAFTS = 2;
export const SEEDFALL_HEAL = 1;
export const SEEDFALL_MANA = 1;
// An opening is contested when this many champions (the opener counted)
// stand within this reach of the cache as it opens: a measurement, no rule.
export const SEEDFALL_CONTEST_M = 12;
export const SEEDFALL_CONTEST_MIN = 2;
