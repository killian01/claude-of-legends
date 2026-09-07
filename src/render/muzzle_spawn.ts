// Where a rendered bolt begins its flight. The sim spawns every projectile
// at the shooter's center; a champion with an authored muzzle shows the
// bolt leaving the barrel tip instead, and the renderer converges it onto
// the sim-true path over the first instants of flight (hit tests never
// move). The rig answers the tip in three's WORLD space, which lies across
// the scene's z mirror (the renderer flips z about the map's middle so +z
// runs up the screen); the bolt itself is placed in scene space, in sim
// coordinates. So the tip crosses the mirror here before it is measured
// against the sim position. Measured naively, Vesk's bullets spawned about
// (size - 2z) away from him and visibly flew in from nowhere.

import type * as THREE from 'three';
import type { Vec2 } from '../sim/types';

// Rendered flight height of every projectile, world units above the ground.
export const PROJECTILE_Y = 1.2;

// Offset from the bolt's sim position to where its mesh is born; the
// renderer blends it away over the first beat of flight.
export interface SpawnOffset {
  x: number;
  y: number;
  z: number;
}

// The offset for a tip read off the rig in world space. `scene` is the
// object whose local frame is sim space: the renderer's scene, mirror and
// all. `tipWorld` is rewritten into that frame.
export function muzzleSpawnOffset(
  scene: THREE.Object3D,
  tipWorld: THREE.Vector3,
  at: Vec2,
): SpawnOffset {
  const tip = scene.worldToLocal(tipWorld);
  return { x: tip.x - at.x, y: tip.y - PROJECTILE_Y, z: tip.z - at.z };
}

// The estimate while the rig is still loading (the procedural figure has no
// tip): the manifest's forward reach along the fire line, at its authored
// height. Null when the bolt still sits on the shooter, since there is no
// fire line to reach along yet.
export function estimatedMuzzleOffset(
  shooter: Vec2,
  at: Vec2,
  muzzle: { forward: number; y: number },
): SpawnOffset | null {
  let dx = at.x - shooter.x;
  let dz = at.z - shooter.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return null;
  dx /= d;
  dz /= d;
  return {
    x: shooter.x + dx * muzzle.forward - at.x,
    y: muzzle.y - PROJECTILE_Y,
    z: shooter.z + dz * muzzle.forward - at.z,
  };
}
