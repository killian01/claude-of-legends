import type * as THREE from 'three';
import type { PlanetStage } from './planet_stage';
import type { VfxSystem } from './vfx/system';

interface ImpactView {
  vfx: Pick<VfxSystem, 'lightPulse'>;
  camera: THREE.Camera;
  planet?: Pick<PlanetStage, 'bentWorld'>;
  toScene: (at: THREE.Vector3) => THREE.Vector3;
  gain: (x: number, z: number) => number;
  shake: (strength: number) => void;
}

// Only a fresh, seen slam reaches this seam. An old ground scar cannot
// repeat the flash, and a contact outside the camera cannot shake it.
export function voidmaulAttackFeedback(at: THREE.Vector3, view: ImpactView): void {
  view.vfx.lightPulse(at.x, at.z, 0xb8ccff, 18.5, 720);
  const projected = (
    view.planet ? view.planet.bentWorld(at.x, at.y, at.z) : view.toScene(at)
  ).project(view.camera);
  if (
    Math.abs(projected.x) > 1 ||
    Math.abs(projected.y) > 1 ||
    projected.z < -1 ||
    projected.z > 1
  ) {
    return;
  }
  const near = view.gain(at.x, at.z);
  if (near > 0) view.shake(0.46 * near);
}
