// A world checkpoint (docs/design/bots.md, the replay; playtest round 3):
// the whole state of a sim as plain data, taken in a few milliseconds and
// put back in place, so a replay can reach any tick by restoring the
// nearest checkpoint and stepping the remainder instead of rebuilding the
// match from tick zero. The contract, pinned by tests/snapshot.test.ts:
// restore at k then step to n is the same world as stepping straight to
// n. The Sim owns the two doors (snapshot, restore); this module holds
// the copying rules:
// - champion definitions carry hooks (functions) and are never copied: a
//   unit keeps its championId and is re-linked through the registry;
// - policies are not state and are not touched: they close over the
//   sim's own containers (attachPlaybook's trace), so restoring mutates
//   those containers in place rather than replacing them;
// - everything else is data, Maps, Sets and typed arrays included, which
//   structuredClone copies whole.

import type { ChampionRegistry } from './champion_registry';
import type { Unit } from './unit';

export interface SimSnapshot {
  tick: number;
  // Opaque: whatever the Sim gathered, deep-copied. Cloneable across a
  // worker boundary (postMessage), which is how the replay viewer gets
  // its checkpoints.
  state: unknown;
}

// The units as data: the same records without their definition.
export function freezeUnits(units: ReadonlyMap<number, Unit>): Unit[] {
  return [...units.values()].map((u) => ({ ...u, champion: null }));
}

// The units back into the live map, definitions re-linked. The map is
// emptied and refilled rather than replaced (see the header).
export function thawUnits(
  into: Map<number, Unit>,
  units: readonly Unit[],
  champions: ChampionRegistry,
): void {
  into.clear();
  for (const u of units) {
    into.set(u.id, {
      ...u,
      champion: u.championId !== null ? champions.get(u.championId) : null,
    });
  }
}

// Refill a Map in place from a copy.
export function refillMap<K, V>(into: Map<K, V>, from: ReadonlyMap<K, V>): void {
  into.clear();
  for (const [k, v] of from) into.set(k, v);
}

export function refillSet<T>(into: Set<T>, from: ReadonlySet<T>): void {
  into.clear();
  for (const v of from) into.add(v);
}

// A deep copy of plain data (Maps, Sets, typed arrays, nested objects).
export function deepCopy<T>(v: T): T {
  return structuredClone(v);
}
