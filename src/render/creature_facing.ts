// Where a ring's creature looks while it stands at home (CONTEXT.md: Ring):
// at its ring's lane, the way the fight comes. The yaw is the renderer's
// (atan2(dx, dz), a body's +z forward), toward the lane's point nearest the
// ring's center. Presentation only; the sim has no facing.

import type { GameMap, RingSite } from '../sim/content/map';
import type { CreatureId } from '../sim/content/rings';
import { creatureOfRing } from '../sim/content/rings';
import type { Vec2 } from '../sim/types';

// After its last swing a creature keeps its guard on the fight this long
// before it turns back to the lane; and it only does so at home.
export const REST_AFTER_SWING_MS = 2500;
export const HOME_RADIUS = 1.5;

export function nearestOnPath(path: readonly Vec2[], p: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const s =
      len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
    const q = { x: a.x + abx * s, z: a.z + abz * s };
    const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best ?? (path[0] ? { x: path[0].x, z: path[0].z } : null);
}

export function ringRestYaw(site: RingSite, lane: readonly Vec2[]): number | null {
  const q = nearestOnPath(lane, site);
  if (!q) return null;
  const dx = q.x - site.x;
  const dz = q.z - site.z;
  return dx === 0 && dz === 0 ? null : Math.atan2(dx, dz);
}

// The home and resting yaw of a creature on this map, or null on a map
// without its ring.
export function creatureRest(
  map: Pick<GameMap, 'rings' | 'lanes'>,
  creature: CreatureId,
): { home: Vec2; yaw: number } | null {
  const site = map.rings?.find((r) => creatureOfRing(r.id).id === creature);
  if (!site) return null;
  const yaw = ringRestYaw(site, map.lanes[site.lane] ?? []);
  return yaw === null ? null : { home: { x: site.x, z: site.z }, yaw };
}
