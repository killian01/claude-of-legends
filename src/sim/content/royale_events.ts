// The battle royale's set pieces (CONTEXT.md: Seedfall), data-as-code: when
// the Seedfalls fall and how many seeds each, where they may land, what the
// impact does and what the Seedfall cache pays. All times are seconds after
// landing; distances are chords (src/sim/geo.ts). The rules that read these
// live in src/sim/royale/seedfall.ts and src/sim/royale/caches.ts.

import { RING_CREATURES_AT_S, type RoyaleVariant, WARDEN_AT_S } from '../royale/types';

// When each Seedfall lands, seconds after landing: five a match, the first
// at 2:00 as the caches run dry, then one every 70 s. Every 80 s, One life's
// fifth landed at 7:20 with two to five champions left, and two in five
// matches ended before anyone opened it (86% of the Seedfalls opened over
// seeds 1 to 40); every 70 s, 92% (the report, tuning round 1, 2026-10-04).
export const SEEDFALL_AT_S: readonly number[] = [120, 190, 260, 330, 400];
// A Seedfall is called this long before it lands (the announce draws its
// point and tells everyone). 20 s called seeds 70 to 200 m away that
// nobody could reach before the impact (the second playtest, 2026-10-04);
// 30 s, with the landing times kept, calls the first one as the calm ends.
export const SEEDFALL_WARN_S = 30;
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
// In Respawn a Seedfall cache's opening is held, not broken: a hit taken
// or dealt, a cast or an attack ordered slows its clock to
// SEEDFALL_HELD_RATE until the opener has gone SEEDFALL_CALM_S without one,
// and a step inside the reach slows it only while the opener moves (the
// full rate is back on its first still tick); only leaving the reach (or
// falling) breaks it.
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
// the maximum mana (both all of it), and a Heartwood Graft offer
// (royale/grafts.ts), which took the second piece's place.
export const SEEDFALL_PIECES = 1;
export const SEEDFALL_HEAL = 1;
export const SEEDFALL_MANA = 1;
// An opening is contested when this many champions (the opener counted)
// stand within this reach of the cache as it opens: a measurement, no rule.
export const SEEDFALL_CONTEST_M = 12;
export const SEEDFALL_CONTEST_MIN = 2;

// The Risings (CONTEXT.md: Rising; src/sim/royale/risings.ts): the big
// creatures and the Warden come up on the planet's own clocks, each called
// RISING_WARN_S ahead. The Pyrefang and the Voidmaul rise at 3:00 on their
// rings and RISING_RETURN_S after each death; the Warden once, inside the
// light (4:30 in One life, 6:00 in Respawn), and never a second time. The
// 5v5's bodies are sized for a duo or a team; on the planet a champion
// fights alone, so a body is scaled at its rise (CombatCtx.neutralScale):
// a level 6 champion with four pieces takes a big creature alone in about
// 20 s and the Warden in about half a minute, keeping most of its health
// (scripts/creature_report.mjs --planet): the gamble is the steal, and the
// slayer shown to everyone.
export const RISING_WARN_S = 30;
export const RING_RISE_AT_S = RING_CREATURES_AT_S;
export const RISING_RETURN_S = 150;
export const WARDEN_RISE_AT_S: Readonly<Record<RoyaleVariant, number>> = {
  one_life: 270,
  respawn: WARDEN_AT_S,
};
// The Warden's site is the walkable point nearest the center of the light
// as it will stand this long after the rise: inside the light, where the
// field is headed.
export const WARDEN_SITE_FORECAST_S = 30;
export interface NeutralScale {
  hp: number;
  ad: number;
}
export const PLANET_NEUTRAL_SCALE: Readonly<{ creature: NeutralScale; warden: NeutralScale }> = {
  creature: { hp: 0.35, ad: 0.7 },
  // 0.3 left the Warden 45 s (One life's 4:30) to 50 s (Respawn's 6:00)
  // for the median lone champion, 0.2 23 to 28 s; 0.22 takes it to about
  // half a minute in both.
  warden: { hp: 0.22, ad: 0.7 },
};
// What a big creature's last hit pays (risings.ts risingReward): pieces of
// the build, all the health and all the mana, and the slayer shown to
// everyone for MARK_SHOWN_S. With Grafts it pays two pieces and a Heartwood
// Graft offer; until Grafts ship, three pieces.
export const RISING_PIECES = 2;
export const RISING_PIECES_BEFORE_GRAFTS = 3;
export const RISING_HEAL = 1;
export const RISING_MANA = 1;
// The Wrath on the planet (CONTEXT.md: Wrath): the Warden's last hit
// carries it this long, and it passes to whoever takes its holder down,
// with whatever was left but never less than WRATH_PASS_MIN_S.
export const WRATH_ROYALE_S: Readonly<Record<RoyaleVariant, number>> = {
  one_life: 60,
  respawn: 120,
};
export const WRATH_PASS_MIN_S = 45;

// The hunted (CONTEXT.md: Lodestar, Ablaze; src/sim/royale/marks.ts): the
// champions shown to everyone. The Lodestar is Respawn's score leader with
// LODESTAR_RESPAWN_SCORE or more, and in One life, from the Dusk's
// LODESTAR_ONE_LIFE_PHASE (the second closing), the most takedowns with
// LODESTAR_ONE_LIFE_SCORE or more. Ablaze is a run of takedowns without
// falling, ABLAZE_RUN by variant, only the ABLAZE_TOP longest runs.
export const LODESTAR_RESPAWN_SCORE = 5;
export const LODESTAR_ONE_LIFE_SCORE = 2;
export const LODESTAR_ONE_LIFE_PHASE = 2;
export const ABLAZE_RUN: Readonly<Record<RoyaleVariant, number>> = { one_life: 3, respawn: 5 };
export const ABLAZE_TOP = 3;
// How often each mark is shown again (each show lasts MARK_SHOWN_S): the
// Lodestar every 20 s, every 10 s while it leads the second by
// LODESTAR_RUNAWAY or more; an Ablaze every 15 s; the Wrath's holder every
// 10 s.
export const LODESTAR_EVERY_S = 20;
export const LODESTAR_RUNAWAY_EVERY_S = 10;
export const LODESTAR_RUNAWAY = 8;
export const ABLAZE_EVERY_S = 15;
export const WRATH_EVERY_S = 10;
// What a takedown on a mark pays its last hit: on the Lodestar, the
// takedown counts LEADER_TAKEDOWN_SCORE (types.ts) and a piece; on an
// Ablaze (snuffed out), 1 + floor(run / 3) pieces, at most SNUFF_MAX_PIECES,
// and in Respawn SNUFF_RESPAWN_SCORE more to the score.
export const LODESTAR_PIECES = 1;
export const SNUFF_RUN_PER_PIECE = 3;
export const SNUFF_MAX_PIECES = 3;
export const SNUFF_RESPAWN_SCORE = 1;
