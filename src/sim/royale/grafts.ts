// The Grafts (CONTEXT.md: Graft): the offers of three cards a seat gets on
// the drop and on events, queued at most three deep, the head open for ten
// seconds before card 0 is taken for it, and the Grafts each seat holds.
// The mode drives it from stepAfterDeaths and takes a seat's pick
// (Sim.pickGraft, the 'graft' action). The call sites stand already and do
// nothing yet: no offer is made, no pick is taken and no rng is drawn until
// the rules land here.

import type { ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';

// One tick of the offers after the deaths: deadlines, card 0 taken.
export function stepGrafts(_mode: RoyaleMode, _sim: Sim): void {}

// A seat's pick of its open offer's card; false when nothing was taken.
export function pickGraft(
  _mode: RoyaleMode,
  _unitId: number,
  _pick: number,
  _time: number,
): boolean {
  return false;
}

// The seat's own open offer and its Grafts (ObsRoyale.offer, grafts);
// nothing yet.
export function observeGrafts(
  _mode: RoyaleMode,
  _sim: Sim,
  _u: Unit,
): Pick<ObsRoyale, 'offer' | 'grafts'> {
  return {};
}
