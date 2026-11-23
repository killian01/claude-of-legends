// Emberstray (CONTEXT.md: Emberstray, Glow; docs/design/emberstray.md):
// the most seconds held in the glow, a ring of light twelve meters across
// that rests twelve seconds and drifts at a walk across the heart of the
// Thornyard (royale/bouts/goal_emberstray.ts), in the Ruins or the Cliffs. Respawn's death, a fall
// costing five seconds and the walk back. One closing (phase 5) to 34 m
// from 65 to 80 s, the light held to 115 s, the outside burning from the
// first second. Ten caches at landing, back 40 s after opened. Its count
// is the shared held-time scorer (royale/bouts/count.ts heldTimeScorer):
// every champion standing in the glow counts the seconds, shared with
// whoever else stands in it, so the way to count alone is to clear it.

import { heldTimeScorer } from '../../royale/bouts/count';
import { glowGoal } from '../../royale/bouts/goal_emberstray';
import { EMBERSTRAY_BOTS } from '../bots/bout_skills';
import type { BoutKind } from './types';

export const EMBERSTRAY: BoutKind = {
  id: 'emberstray',
  name: 'Emberstray',
  rule: 'Hold the Glow longest',
  card: [
    'Hold the Glow longest',
    'The Glow rests, then drifts: follow it',
    'Anyone inside it counts: clear it',
  ],
  version: 1,
  released: true,
  base: 'respawn',
  playS: 100,
  // The Ruins and the Cliffs alone: the Lakes' and the Groves' hearts are
  // water and thicket under much of the Glow's roam, and the Sanctuary's
  // and the Open ground's stand on the poles' landmarks.
  thornyard: { radius: 40, regions: ['ruins', 'cliffs'] },
  dusk: {
    closings: [{ radius: 34, closeFrom: 65, closeTo: 80, holdTo: 115, burn: 0.06 }],
    edgeSpeed: 1.1,
    burnBefore: 0.04,
    lightOutS: 115,
  },
  systems: { clamors: true },
  caches: { count: 10, backS: 40 },
  goals: [glowGoal],
  count: heldTimeScorer('held'),
  ties: ['falls', 'reached', 'seat'],
  // The tend errand (royale/bot/bout_calls.ts): to the glow from 35
  // percent health, anywhere in the Thornyard.
  bots: EMBERSTRAY_BOTS,
  hud: { word: 's held', place: false },
};
