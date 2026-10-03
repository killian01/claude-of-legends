// The Risings (CONTEXT.md: Rising): the big creatures and the Warden called
// thirty seconds ahead on the planet, the Warden's site drawn inside the
// light, and the Wrath's holder on the Wanderseed and its passing. The mode
// drives it from stepAfterDeaths; the call sites stand already and do
// nothing yet: no state moves and no rng is drawn until the rules land here.

import type { ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';

// One tick of the Risings after the deaths: the heads-up, the rise.
export function stepRisings(_mode: RoyaleMode, _sim: Sim): void {}

// The Risings as everyone sees them (ObsRoyale.risings); nothing yet.
export function observeRisings(_mode: RoyaleMode, _sim: Sim, _u: Unit): Pick<ObsRoyale, 'risings'> {
  return {};
}
