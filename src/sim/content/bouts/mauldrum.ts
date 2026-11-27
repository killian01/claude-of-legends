// Mauldrum (CONTEXT.md: Mauldrum; docs/design/mauldrum.md): the most
// struck on the Voidmaul, risen early at the heart of the Cliffs, where its
// ring stands, so the Thornyard is drawn there alone. Respawn's death, a
// fall costing five seconds and the walk back. One closing (phase 5) to
// 30 m from 60 to 75 s, the light held to 110 s, the outside burning from
// the first second. Eight caches at landing, back 40 s after opened. Its
// count is its own (royale/bouts/score_mauldrum.ts): every point of damage
// landed on the Voidmaul, more for the blow that fells it, and a takedown
// taking a fifth of the fallen's. No camp, no Warden and no other ring
// stand in it: the count reads every body that is not a seat as the
// Voidmaul.

import { mauldrumScorer } from '../../royale/bouts/score_mauldrum';
import { MAULDRUM_BOTS } from '../bots/bout_skills';
import type { BoutKind } from './types';

export const MAULDRUM: BoutKind = {
  id: 'mauldrum',
  name: 'Mauldrum',
  rule: 'Most struck wins',
  card: [
    'Most struck on the Voidmaul wins',
    'Its felling blow counts 400 more',
    'A takedown takes a fifth of the fallen',
  ],
  version: 1,
  released: true,
  base: 'respawn',
  playS: 100,
  thornyard: { radius: 40, regions: ['cliffs'] },
  dusk: {
    closings: [{ radius: 30, closeFrom: 60, closeTo: 75, holdTo: 110, burn: 0.06 }],
    edgeSpeed: 1.1,
    burnBefore: 0.04,
    lightOutS: 110,
  },
  systems: { clamors: true, risings: { voidmaul: 12 } },
  caches: { count: 8, backS: 40 },
  count: mauldrumScorer,
  ties: ['falls', 'reached', 'seat'],
  // The maul errand (royale/bot/bout_calls.ts maulCall): to the Voidmaul
  // from 40 percent health, anywhere in the Thornyard.
  bots: MAULDRUM_BOTS,
  hud: { word: 'struck', place: false },
};
