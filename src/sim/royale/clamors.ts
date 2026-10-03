// The Clamors (CONTEXT.md: Clamor): where a champion's takedown rang out
// and when, kept CLAMOR_S (types.ts) and public to every seat, so a late
// One life bot can answer one (bot/calls.ts) and every client can hear it
// by bearing (server/royale_snapshot_blocks.ts, the cl block). The mode
// calls noteClamor from onDeath's champion branch, stepClamors from
// stepAfterDeaths and observeClamors from observe. Presentation reads it,
// rules do not: nothing here draws from the rng or moves a unit.

import type { ObsClamor, ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';
import { CLAMOR_S } from './types';

// A champion fell: the victim, and the champion credited with the
// takedown (null for a fall nobody landed, the Dusk's own say). Only a
// takedown rings out, at the victim's feet: a champion the Dusk burned
// leaves no fight to answer.
export function noteClamor(mode: RoyaleMode, sim: Sim, victim: Unit, killer: Unit | null): void {
  if (killer === null) return;
  const p = victim.pos;
  if (p.y === undefined) return;
  mode.state.clamors.push({ pos: { x: p.x, y: p.y, z: p.z }, at: sim.time });
}

// Whether a Clamor rung at `at` still rings at `time`.
export function clamorRings(at: number, time: number): boolean {
  return time - at < CLAMOR_S - 1e-9;
}

// One tick of the Clamors after the deaths: the ones older than CLAMOR_S
// fall silent.
export function stepClamors(mode: RoyaleMode, sim: Sim): void {
  const list = mode.state.clamors;
  if (list.length === 0) return;
  const kept = list.filter((c) => clamorRings(c.at, sim.time));
  if (kept.length !== list.length) mode.state.clamors = kept;
}

// The Clamors as every seat hears them (ObsRoyale.clamors): all of them,
// whoever rang them and wherever, since a takedown is heard, not seen.
export function observeClamors(mode: RoyaleMode, _sim: Sim, _u: Unit): Pick<ObsRoyale, 'clamors'> {
  return {
    clamors: mode.state.clamors.map(
      (c): ObsClamor => ({ x: c.pos.x, y: c.pos.y, z: c.pos.z, at: c.at }),
    ),
  };
}
