// Assists pay in Respawn (ADR 0031, amended 2026-10-08): a takedown's last
// hit is paid in full (mode.ts onDeath), and every other champion that hit
// the fallen within the assist window (rewards.ts assistersOf, the sim's
// own count of assists) learns a share of what the takedown would have
// paid it (levels.ts assistXp), bots and people alike, a fallen helper
// too. In Respawn about two takedowns in five go to a champion who dealt
// under a quarter of the damage (the royale report's steals), so the last
// hit alone left a seat that fought every fight near its landing level.
// The levels an assist passes offer their Grafts like a takedown's. One
// life pays the last hit alone (ASSIST_XP_SHARE).

import { assistersOf } from '../rewards';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import { offerOnLevels } from './grafts';
import { ASSIST_XP_SHARE, assistXp, grantXp } from './levels';
import type { RoyaleMode } from './mode';

// Pays each assist on `victim`'s takedown by `taker`, in the order the
// assisting seats first hit it.
export function payAssists(mode: RoyaleMode, sim: Sim, victim: Unit, taker: Unit): void {
  if (ASSIST_XP_SHARE[mode.variant] <= 0) return;
  for (const helper of assistersOf(sim.units, victim, taker.id, sim.time)) {
    const from = helper.level;
    grantXp(helper, assistXp(mode.variant, victim.level, helper.level));
    offerOnLevels(mode, sim, helper, from);
  }
}
