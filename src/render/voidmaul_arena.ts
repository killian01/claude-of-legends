// Debris covers the authored Voidmaul platform. Its centre is independent
// of the paw contact, and its radius excludes the leash and fog margins.
import * as THREE from 'three';
import type { RingSite } from '../sim/content/map';
import type { Vec2 } from '../sim/types';
import type { GroundHeight } from './terrain';

export interface VoidmaulArena {
  center: THREE.Vector3;
  radius: number;
}

export function voidmaulArenaForImpact(
  rings: readonly RingSite[] | undefined,
  groundHeight: GroundHeight,
  toLocal?: (point: Vec2) => Pick<Vec2, 'x' | 'z'>,
): VoidmaulArena | undefined {
  // The shared map names Voidmaul's site 'top', including on the planet.
  // A scene without that site keeps the impact's ordinary local fallback.
  const site = rings?.find((ring) => ring.id === 'top');
  if (
    !site ||
    !Number.isFinite(site.r) ||
    site.r <= 0 ||
    !Number.isFinite(site.x) ||
    !Number.isFinite(site.z) ||
    (site.y !== undefined && (!Number.isFinite(site.y) || !toLocal))
  ) {
    return;
  }
  const source: Vec2 = { x: site.x, z: site.z };
  if (site.y !== undefined) source.y = site.y;
  const point = toLocal ? toLocal(source) : source;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
  const height = groundHeight(point.x, point.z);
  if (!Number.isFinite(height)) return;
  return { center: new THREE.Vector3(point.x, height, point.z), radius: site.r };
}
