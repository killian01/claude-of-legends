// Respawn's Last light (CONTEXT.md): from the start of the Dusk's last
// closing until the light goes out, a takedown counts LAST_LIGHT_FACTOR
// times on the score, the Lodestar's and a Burr's included, for people and
// bots alike. The closing every seat sees coming is the one cue that the
// ranking is still open: a seat a few takedowns behind can catch up in the
// last fights. No death is final; One life has none of it. The mode calls
// lastLightFactor from onDeath and stepLastLight from stepAfterDeaths; the
// HUD reads lastLightOn off the snapshot's clock (de, end), so nothing
// new rides the wire or the checkpoint.

import { DUSK_PHASES } from '../content/dusk';
import type { Sim } from '../sim';
import { DT } from '../types';
import type { RoyaleMode } from './mode';
import type { RoyaleStage, RoyaleVariant } from './types';

// When the Last light begins, seconds after landing: the last closing of
// the Dusk (content/dusk.ts, 528 s of the 600, so the last 72 s).
export const LAST_LIGHT_AT_S = DUSK_PHASES[DUSK_PHASES.length - 1]!.closeFrom;
// How many times a takedown counts while it lasts.
export const LAST_LIGHT_FACTOR = 2;

export interface LastLightClock {
  variant: RoyaleVariant;
  stage: RoyaleStage;
  // Sim time the drop ends (everyone lands), and the light goes out.
  dropEndsAt: number;
  endsAt: number;
}

// Whether the Last light is on at sim time `time`.
export function lastLightOn(c: LastLightClock, time: number): boolean {
  if (c.variant !== 'respawn' || c.stage !== 'play') return false;
  return time + 1e-9 >= c.dropEndsAt + LAST_LIGHT_AT_S && time < c.endsAt + 1e-9;
}

// What a takedown's score is multiplied by at `time`.
export function lastLightFactor(c: LastLightClock, time: number): number {
  return lastLightOn(c, time) ? LAST_LIGHT_FACTOR : 1;
}

// After the deaths: on the tick it begins, the Last light is told to
// everyone (the 'double' step). Read off the clock alone, so a restored
// checkpoint tells it once as well.
export function stepLastLight(mode: RoyaleMode, sim: Sim): void {
  const s = mode.state;
  if (!lastLightOn(s, sim.time) || lastLightOn(s, sim.time - DT)) return;
  sim.pushEvent({ type: 'royale_last_light', step: 'double' });
}
