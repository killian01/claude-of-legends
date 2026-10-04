// A dev shortcut to a ring's creature, on the dev server only (src/main.ts
// reads it behind import.meta.env.DEV): ?creature=voidmaul (or pyrefang)
// on an offline practice match rises that creature two seconds in and
// stands the champion at its ring's edge, so its rise, slam and fall can be
// looked at without waiting for its clock. Nothing a build can reach.

import type { CreatureId } from '../sim/content/rings';
import type { RingState } from '../sim/rings';
import type { Vec2 } from '../sim/types';

export const CREATURE_NOW_PARAM = 'creature';
const RISE_AFTER_S = 2;
// From the ring's center sideways toward the map's middle, past the rift's
// rim and inside the platform: both rings sit in a corner, where the camera
// stops, and a stand toward the screen's bottom would sink under the HUD.
const STAND_OFF = 15;

export function creatureNowFrom(search: string): CreatureId | null {
  const value = new URLSearchParams(search).get(CREATURE_NOW_PARAM);
  return value === 'voidmaul' || value === 'pyrefang' ? value : null;
}

// Rewinds that creature's clock and returns where the champion stands, or
// null when the map has no ring for it.
export function riseCreatureNow(
  rings: RingState[],
  creature: CreatureId,
  now: number,
  mapSize: number,
): Vec2 | null {
  const state = rings.find((s) => s.creature === creature);
  if (!state || state.unitId !== null) return null;
  state.nextRiseAt = now + RISE_AFTER_S;
  const side = state.site.x < mapSize / 2 ? 1 : -1;
  return { x: state.site.x + side * STAND_OFF, z: state.site.z };
}
