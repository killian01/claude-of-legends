// The house bots in a bout (ADR 0035; docs/design/thornfray.md, How a bot
// plays a bout), data-as-code: each kind's numbers its bots read in place
// of the fifty seat tunings of royale_skills.ts, and the errands' own. A
// kind's `bots` (content/bouts/types.ts BoutBots) is its entry here, so its
// fingerprint reads them; the brain's bout branch (royale/bot/brain.ts,
// royale/bot/bout_calls.ts) reads them while a bout runs and never on the
// planet.

import type { BoutBots } from '../bouts/types';

// The skills of a Thornfray's eight seats (royale/fill.ts boutSeatSkills),
// dealt once for the match: four gentle, three normal, one strong. When
// only Guests play, the strong seat plays normal: softer, as the planet's
// Guests mix moves its strong share to normal and keeps the gentle at half
// (a field mostly gentle loots and never fights back). Rounded over eight
// seats the planet's two mixes deal alike, so a bout keeps its own.
export const BOUT_MIX: Readonly<{ gentle: number; normal: number }> = {
  gentle: 4 / 8,
  normal: 3 / 8,
};
export const BOUT_MIX_GUESTS: Readonly<{ gentle: number; normal: number }> = {
  gentle: 4 / 8,
  normal: 4 / 8,
};

// What a bout's bots read when the kind gives the policy none (a script
// that calls the brain with a bout's observation alone): no errand, the
// Dusk margin halved, cornered under 8 m, no calm nerve and no pace.
export const BOUT_BOTS: BoutBots = {
  errand: null,
  floor: 0.4,
  reach: 80,
  duskMargin: 0.5,
  cornered: 8,
  calm: 0,
  pace: null,
};

// Lastwick: One life's brain with no errand; the fights and the light are
// the bout. No calm nerve and no pace: the pace's curve counts fifty seats,
// and held against eight it asks for odds no fight shows, so nobody would
// fight. Half the skill's Dusk margin, the Dusk closing faster than on the
// planet. Cornered under 8 m: under the planet's 20 m a bot stops fleeing
// and takes any fight, which would hold from the bout's second closing,
// half the bout.
export const LASTWICK_BOTS: BoutBots = {
  errand: null,
  floor: 0,
  reach: 0,
  duskMargin: 0.5,
  cornered: 8,
  calm: 0,
  pace: null,
};

// Starglean: the glean errand (bout_calls.ts gleanCall) from 40 percent
// health, to a called Seedfall anywhere in the Thornyard (80 m, its
// width), else a cache in sight; the rest as Lastwick's.
export const STARGLEAN_BOTS: BoutBots = {
  errand: 'glean',
  floor: 0.4,
  reach: 80,
  duskMargin: 0.5,
  cornered: 8,
  calm: 0,
  pace: null,
};

// The glean errand's cache: the nearest standing one in reach, a golden
// one counted GLEAN_GOLDEN_M closer and a Seedfall's GLEAN_SEEDFALL_M (they
// count 2 and 3), never one an enemy in sight stands within GLEAN_BESIDE_M
// of (the bot passed on that fight already). Unlike the planet's pick
// (travel.ts pickCache) it races an enemy farther off for it: in Starglean
// the cache is the count, and the race the bout's contest.
export const GLEAN_GOLDEN_M = 10;
export const GLEAN_SEEDFALL_M = 20;
export const GLEAN_BESIDE_M = 8;
// The light an errand's goal must hold past the walk and the opening.
export const GLEAN_LIT_MARGIN_S = 4;
// A landed Seedfall's cache this close is stepped into and its held
// opening begun (bout_calls.ts beginHeldOpening): the standoff a bot waits
// at before the landing, and a little more.
export const GLEAN_STEP_IN_M = 6;
