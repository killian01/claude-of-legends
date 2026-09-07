// A rendered bolt leaves the rifle's tip, and the tip is read off the rig
// in three's world space: across the scene's z mirror (the renderer flips
// z about the map's middle so +z runs up the screen). Measured naively
// against the sim position, that put Vesk's bullets about (size - 2z) away
// from him, flying in from nowhere. muzzle_spawn.ts brings the tip back
// into sim coordinates before it is measured. Pure three math, so plain
// node exercises it without a GLB or a canvas.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { estimatedMuzzleOffset, muzzleSpawnOffset, PROJECTILE_Y } from '../src/render/muzzle_spawn';

const SIZE = 150;
const MUZZLE = { forward: 2.3, y: 1.4 };

// The renderer's scene graph in miniature: the mirrored scene, a unit
// holder at its sim position turned to its facing, and a muzzle tip riding
// it a rifle's length ahead at shoulder height.
function rigged(
  x: number,
  z: number,
  yaw: number,
): { scene: THREE.Scene; tipWorld: THREE.Vector3 } {
  const scene = new THREE.Scene();
  scene.scale.z = -1;
  scene.position.z = SIZE;
  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  holder.rotation.y = yaw;
  scene.add(holder);
  const tip = new THREE.Object3D();
  tip.position.set(0, 1.4, 2.4);
  holder.add(tip);
  return { scene, tipWorld: tip.getWorldPosition(new THREE.Vector3()) };
}

describe('the muzzle spawn offset', () => {
  it('lands the bolt on the rifle tip in sim coordinates, across the mirror', () => {
    // Vesk high on the map facing +z, the bolt already one sim step out.
    const { scene, tipWorld } = rigged(40, 120, 0);
    // The naive reading sits on the far side of the mirror: nowhere near him.
    expect(Math.abs(tipWorld.z - 120)).toBeGreaterThan(50);
    const at = { x: 40, z: 121.5 };
    const ofs = muzzleSpawnOffset(scene, tipWorld, at);
    expect(at.x + ofs.x).toBeCloseTo(40, 6);
    expect(at.z + ofs.z).toBeCloseTo(122.4, 6);
    expect(PROJECTILE_Y + ofs.y).toBeCloseTo(1.4, 6);
  });

  it('follows the facing: turned toward +x, the bolt is born to his +x', () => {
    const { scene, tipWorld } = rigged(20, 30, Math.PI / 2);
    const at = { x: 21.5, z: 30 };
    const ofs = muzzleSpawnOffset(scene, tipWorld, at);
    expect(at.x + ofs.x).toBeCloseTo(22.4, 6);
    expect(at.z + ofs.z).toBeCloseTo(30, 6);
  });

  it('estimates the tip along the fire line while the rig is still loading', () => {
    const ofs = estimatedMuzzleOffset({ x: 10, z: 10 }, { x: 10, z: 11.5 }, MUZZLE);
    expect(ofs).not.toBeNull();
    expect(10 + (ofs?.x ?? 0)).toBeCloseTo(10, 6);
    expect(11.5 + (ofs?.z ?? 0)).toBeCloseTo(12.3, 6);
    expect(PROJECTILE_Y + (ofs?.y ?? 0)).toBeCloseTo(1.4, 6);
    // The bolt still on the shooter: no fire line, no estimate.
    expect(estimatedMuzzleOffset({ x: 10, z: 10 }, { x: 10, z: 10 }, MUZZLE)).toBeNull();
  });
});
