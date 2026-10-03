// The Clamors (CONTEXT.md: Clamor): where a champion's takedown rang out
// and when, kept CLAMOR_S (types.ts) and public to every seat, so a late
// One life bot can answer one (bot/calls.ts) and every client can hear it
// by bearing (server/royale_snapshot_blocks.ts, the cl block). The mode
// calls noteClamor from onDeath's champion branch, stepClamors from
// stepAfterDeaths and observeClamors from observe. The call sites stand
// already and do nothing yet: no Clamor is kept until the rules land here.

import type { ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';

// A champion fell: the victim, and the champion credited with the
// takedown (null for a fall nobody landed, the Dusk's own say).
export function noteClamor(
  _mode: RoyaleMode,
  _sim: Sim,
  _victim: Unit,
  _killer: Unit | null,
): void {}

// One tick of the Clamors after the deaths: the ones older than CLAMOR_S
// fall silent.
export function stepClamors(_mode: RoyaleMode, _sim: Sim): void {}

// The Clamors as everyone hears them (ObsRoyale.clamors); nothing yet.
export function observeClamors(_mode: RoyaleMode, _sim: Sim, _u: Unit): Pick<ObsRoyale, 'clamors'> {
  return {};
}
