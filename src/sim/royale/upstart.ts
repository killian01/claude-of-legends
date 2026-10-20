// The Upstart (CONTEXT.md; ADR 0031): a Respawn champion that comes down
// into the running match with no takedown on its tally hits champions
// UPSTART_DAMAGE harder until its first takedown, its fall, or UPSTART_S
// after it came down. Coming down is a drop-in's Arrival (its tally starts
// from zero, grace.ts arrive) or a Respawn return (mode.ts onRespawn), for
// every seat alike, a bot's as a person's; the match's own landing is not
// one, every seat being level with every other there. A drop-in's first
// fight was lost to the others drawn to it: of 96 drop-ins the royale
// report played (seeds 1 to 24), 97 percent of the first lives were ended
// by a champion other than the enemy nearest at landing (the fair foe when
// there was one), and that enemy fell to another champion in 46 percent of
// them, to the drop-in in 22; a fight the drop-in ends sooner leaves the
// others less time to come (ADR 0031, amended 2026-10-11).
// Respawn only: One life is unchanged.
// Nothing shows it, on a screen or in an observation: what the seat and
// everyone else read of a fight is as before, only its hits land harder.
// It rides on the champion's damage to champions (Unit.dmgScale, the
// planet's tuning, read once in combat/damage.ts): scaled as it begins,
// set back to the very number it was as it ends; the mode keeps each one
// (in its checkpoint).

import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';

// How much harder an Upstart's hits on champions land, and the longest it
// lasts, seconds from coming down (its Grace included).
export const UPSTART_DAMAGE = 0.5;
export const UPSTART_S = 30;

// One Upstart: when it runs out, and the champion's damage to champions
// before it began.
export interface Upstart {
  until: number;
  base: number;
}

// A champion comes down (an Arrival, a Respawn return): in Respawn, with no
// takedown on its tally, its Upstart begins.
export function beginUpstart(mode: RoyaleMode, u: Unit, time: number): void {
  if (mode.variant !== 'respawn' || u.kind !== 'champion' || u.kills > 0) return;
  // None in a bout that leaves it out (ADR 0035, BoutSystems).
  if (!mode.runs('upstart')) return;
  endUpstart(mode, u);
  mode.upstarts.set(u.id, { until: time + UPSTART_S, base: u.dmgScale });
  u.dmgScale *= 1 + UPSTART_DAMAGE;
  mode.tally.upstarts++;
}

// The Upstart ends: the champion's damage as it was.
export function endUpstart(mode: RoyaleMode, u: Unit): void {
  const up = mode.upstarts.get(u.id);
  if (!up) return;
  mode.upstarts.delete(u.id);
  u.dmgScale = up.base;
}

// Whether a champion carries its Upstart.
export function hasUpstart(mode: RoyaleMode, unitId: number): boolean {
  return mode.upstarts.has(unitId);
}

// At the start of a tick: an Upstart run out ends (in the order they
// began).
export function stepUpstarts(mode: RoyaleMode, sim: Sim): void {
  if (mode.upstarts.size === 0) return;
  for (const [id, up] of [...mode.upstarts]) {
    const u = sim.units.get(id);
    if (!u) {
      mode.upstarts.delete(id);
      continue;
    }
    if (u.dead || sim.time + 1e-9 >= up.until) endUpstart(mode, u);
  }
}

// A champion's fall (mode.ts onDeath): its own Upstart ends, and its
// taker's, which has its first takedown.
export function upstartOnDeath(mode: RoyaleMode, victim: Unit, taker: Unit | null): void {
  endUpstart(mode, victim);
  if (!taker || !mode.upstarts.has(taker.id)) return;
  mode.tally.upstartTakedowns++;
  endUpstart(mode, taker);
}
