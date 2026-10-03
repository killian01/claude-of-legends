// The marks (CONTEXT.md: Lodestar, Ablaze, Wrath): the champions shown to
// everyone on the globe, why, and the last point shown, each show lasting
// MARK_SHOWN_S. Pure over the standings and the units; the mode drives it
// from stepAfterDeaths. The call sites stand already and do nothing yet:
// no state moves until the rules land here.

import type { ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';

// One tick of the marks after the deaths: who is shown, and when.
export function stepMarks(_mode: RoyaleMode, _sim: Sim): void {}

// The marks as everyone sees them (ObsRoyale.marks); nothing yet. The
// Clamors are their own module (clamors.ts).
export function observeMarks(_mode: RoyaleMode, _sim: Sim, _u: Unit): Pick<ObsRoyale, 'marks'> {
  return {};
}
