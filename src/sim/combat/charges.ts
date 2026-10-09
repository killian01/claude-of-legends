// Ability charges (CONTEXT.md: Charge): an ability that declares them is
// cast from a small store instead of a single cooldown. Each cast spends
// one; one comes back every `every` seconds (shortened by rank like a
// cooldown) until the store is full, and the ability's own cooldown is only
// the short beat between two casts. The store fills from the moment the
// ability is first learned, one charge to begin with. Persists through
// death like a cooldown. Nisk's Sourpods are the first to carry them.

import { RANK_CD_SCALE } from '../stats';
import type { AbilityKey } from '../types';
import type { Unit } from '../unit';

export interface ChargeSpec {
  // The most charges the store holds.
  max: number;
  // Seconds for one charge to come back at rank 1.
  every: number;
}

export interface ChargeState {
  count: number;
  // Sim time the next charge comes back; meaningless while the store is full.
  nextAt: number;
}

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// Seconds for one charge at this rank: the cooldown's rank rule.
export function rechargeSeconds(spec: ChargeSpec, rank: number): number {
  return spec.every * (1 - RANK_CD_SCALE * (Math.max(1, rank) - 1));
}

// The charges in store for `key`; zero for an ability not yet learned or
// one that carries none.
export function chargesOf(u: Unit, key: AbilityKey): number {
  return u.charges[key]?.count ?? 0;
}

// The store of `key`, opened with its first charge when the ability is
// learned and has none yet (the tick's step opens it too, whichever comes
// first: a cast on the very tick the rank lands finds it there).
export function openStore(
  u: Unit,
  key: AbilityKey,
  spec: ChargeSpec,
  rank: number,
  time: number,
): ChargeState | null {
  if (rank <= 0) return null;
  let state = u.charges[key];
  if (!state) {
    state = { count: 1, nextAt: time + rechargeSeconds(spec, rank) };
    u.charges[key] = state;
  }
  return state;
}

// One step of every store the champion holds: a learned ability starts
// with one charge, and the store gains one each recharge until full.
// `rankOf` reads the live rank (stats.ts effectiveRank).
export function stepCharges(u: Unit, time: number, rankOf: (key: AbilityKey) => number): void {
  const def = u.champion;
  if (!def) return;
  for (const key of KEYS) {
    const spec = def.abilities[key].charges;
    if (!spec) continue;
    const state = openStore(u, key, spec, rankOf(key), time);
    if (!state) continue;
    const rank = rankOf(key);
    while (state.count < spec.max && time >= state.nextAt) {
      state.count += 1;
      state.nextAt += rechargeSeconds(spec, rank);
    }
  }
}

// Spends one charge of `key` at `time`. A full store starts its recharge
// clock now; a store already refilling keeps its clock.
export function spendCharge(
  u: Unit,
  key: AbilityKey,
  spec: ChargeSpec,
  rank: number,
  time: number,
): void {
  const state = u.charges[key];
  if (!state || state.count <= 0) return;
  if (state.count >= spec.max) state.nextAt = time + rechargeSeconds(spec, rank);
  state.count -= 1;
}
