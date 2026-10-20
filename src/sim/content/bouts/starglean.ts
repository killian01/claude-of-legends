// Starglean (CONTEXT.md: Starglean; docs/design/thornfray.md, Starglean):
// the most gleaned, in bursts. Respawn's death, a fall costing five
// seconds, the champion back in its Grace at the edge of the light or where
// the globe's tap picked. One closing (phase 5, numbered from the end) to
// 26 m from 60 to 75 s, the light held to 120 s (the clock plus the
// Seedfalls' forecast), the outside burning from the first second. Up to
// eighteen caches at landing, never more than the spots inside the
// Thornyard less six kept free for the seeds, back 30 s after opened.
// Seedfalls in bursts of three at 25, 55 and 85 s, called 12 s ahead,
// placed in the light as it will stand 15 s past the impact, every seed
// 18 m from every other and 8 m inside that light. Its count is the shared
// gleaned scorer (royale/bouts/count.ts gleanedScorer): a cache 1, a golden
// cache 2, a Seedfall cache 3, a takedown taking one from the fallen, kept
// beside the takedown score and never in it.

import { gleanedScorer } from '../../royale/bouts/count';
import type { BoutKind } from './types';

export const STARGLEAN: BoutKind = {
  id: 'starglean',
  name: 'Starglean',
  rule: 'Most gleaned wins',
  card: [
    'Most gleaned wins',
    'A cache counts 1, golden 2, a Seedfall 3',
    'A takedown takes one from the fallen',
  ],
  version: 1,
  released: false,
  base: 'respawn',
  playS: 105,
  thornyard: { radius: 40 },
  dusk: {
    closings: [{ radius: 26, closeFrom: 60, closeTo: 75, holdTo: 120, burn: 0.06 }],
    edgeSpeed: 1.1,
    burnBefore: 0.04,
    lightOutS: 120,
  },
  systems: { clamors: true },
  caches: { count: 18, backS: 30 },
  seedfalls: { at: [25, 55, 85], seeds: 3, warnS: 12, forecastS: 15, apartM: 18, depthM: 8 },
  count: gleanedScorer,
  ties: ['seedfalls', 'falls', 'reached', 'seat'],
  // The errand (glean: a called Seedfall anywhere in the Thornyard from 40
  // percent health) is named here with its BOUT_CALLS entry
  // (royale/bot/bout_calls.ts, docs/plan-thornfray.md slice 4); until then
  // none, and the planet's brain plays the bout.
  bots: { errand: null, floor: 0.4, reach: 80, duskMargin: 0.5, cornered: 8, pace: null },
  hud: { word: 'gleaned', place: false },
};
