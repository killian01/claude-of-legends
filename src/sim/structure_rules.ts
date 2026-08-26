// Structure protection: an inner tower is invulnerable while the outer tower
// of its lane stands; Sanctum towers open up once ANY lane is fully down;
// the Sanctum itself opens once both of its towers are down. Checked by the
// damage pipeline AND by targeting, so nothing wastes attacks on immunity.

import type { LaneId } from './content/map';
import type { Unit } from './unit';

const LANES: readonly LaneId[] = ['top', 'mid', 'bot'];

function hasAliveTower(
  units: ReadonlyMap<number, Unit>,
  team: number,
  pred: (u: Unit) => boolean,
): boolean {
  for (const u of units.values()) {
    if (u.team !== team || u.kind !== 'tower' || u.dead || !u.structure) continue;
    if (pred(u)) return true;
  }
  return false;
}

export function isInvulnerable(units: ReadonlyMap<number, Unit>, u: Unit): boolean {
  if (u.kind === 'tower' && u.structure) {
    const s = u.structure;
    if (s.lane !== 'sanctum') {
      if (s.tier === 2) {
        return hasAliveTower(
          units,
          u.team,
          (o) => o.structure!.lane === s.lane && o.structure!.tier === 1,
        );
      }
      return false;
    }
    // Sanctum towers: protected until at least one lane is fully open.
    const anyLaneOpen = LANES.some(
      (lane) => !hasAliveTower(units, u.team, (o) => o.structure!.lane === lane),
    );
    return !anyLaneOpen;
  }
  if (u.kind === 'sanctum') {
    return hasAliveTower(units, u.team, (o) => o.structure!.lane === 'sanctum');
  }
  return false;
}
