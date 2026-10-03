// The Seedfalls (CONTEXT.md: Seedfall): five a match from two minutes after
// landing, each called twenty seconds ahead, its impact throwing up whoever
// stands under it, its cache opened once. Pure where it can be (the
// schedule, the point drawn, the impact's reach); the mode drives it from
// stepAfterDeaths (the announce, the cache) and stepSeedfallImpact (the
// hit, right after the Dusk). The call sites stand already and do nothing
// yet: no state moves and no rng is drawn until the rules land here.

import type { ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';

// One tick of the Seedfalls after the deaths: announcing the next, landing
// it, leaving its cache.
export function stepSeedfalls(_mode: RoyaleMode, _sim: Sim): void {}

// The Seedfalls as everyone sees them (ObsRoyale.seedfalls), each with its
// opener while the seat's team sees it (ObsSeedfall.opener); nothing yet.
export function observeSeedfalls(
  _mode: RoyaleMode,
  _sim: Sim,
  _u: Unit,
): Pick<ObsRoyale, 'seedfalls'> {
  return {};
}
