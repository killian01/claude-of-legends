// Lastwick (CONTEXT.md: Lastwick; docs/design/thornfray.md, Lastwick): the
// last one standing, fast. One life's death, a fall out for the bout,
// under a Dusk that closes on its Thornyard in three closings (phases 3, 4
// and 5, numbered from the end) to five meters by 82 s, the outside burning
// from the first second, the light out at 92 s. Twelve caches at landing,
// none back. Its count is the shared survival scorer (royale/bouts/count.ts):
// the order of the falls, a same-tick pair placed by the health it had the
// tick before, as One life places its fallen (royale/score.ts placeFallen
// and oneLifeRanking). Its clock stands past the dark as a backstop: the
// dark's burn ends the bout by its rule well before it.

import { survivalScorer } from '../../royale/bouts/count';
import { LASTWICK_BOTS } from '../bots/bout_skills';
import type { BoutKind } from './types';

export const LASTWICK: BoutKind = {
  id: 'lastwick',
  name: 'Lastwick',
  rule: 'Last one standing wins',
  card: [
    'Last one standing wins',
    'A fall is out until the next bout',
    'The light closes fast: keep inside it',
  ],
  version: 1,
  released: false,
  base: 'one_life',
  playS: 120,
  thornyard: { radius: 40 },
  dusk: {
    closings: [
      { radius: 26, closeFrom: 20, closeTo: 35, holdTo: 45, burn: 0.04 },
      { radius: 14, closeFrom: 45, closeTo: 60, holdTo: 70, burn: 0.07 },
      { radius: 5, closeFrom: 70, closeTo: 82, holdTo: 92, burn: 0.12 },
    ],
    edgeSpeed: 1.1,
    burnBefore: 0.03,
    lightOutS: 92,
  },
  systems: { clamors: true },
  caches: { count: 12, backS: null },
  count: survivalScorer,
  ties: ['health', 'seat'],
  bots: LASTWICK_BOTS,
  hud: { word: 'left', place: true },
};
