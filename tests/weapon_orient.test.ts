// The weapon-axis math behind the workshop (orient.ts): a generated
// weapon's long axis must land on +Y whatever pose the GLB shipped in,
// and 'Hold it here' must put the clicked grip point in the fist with
// the blade along the hand's grip axis.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gripAlignment, orientLongAxisY } from '../src/render/champions/orient';

function bladeMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.14));
}

function longestAxis(root: THREE.Object3D): 'x' | 'y' | 'z' {
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  if (size.y >= size.x && size.y >= size.z) return 'y';
  return size.x >= size.z ? 'x' : 'z';
}

describe('orientLongAxisY', () => {
  it('turns a diagonal blade upright', () => {
    const root = new THREE.Group();
    const mesh = bladeMesh();
    // Lying flat AND turned: the awkward pose a generated GLB arrives in.
    mesh.rotation.set(Math.PI / 2, 0, Math.PI / 5);
    root.add(mesh);
    expect(longestAxis(root)).not.toBe('y');
    orientLongAxisY(root);
    expect(longestAxis(root)).toBe('y');
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(2, 1);
  });

  it('leaves an already-upright blade essentially untouched', () => {
    const root = new THREE.Group();
    root.add(bladeMesh());
    orientLongAxisY(root);
    expect(root.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.05);
  });

  it('orients the same file the same way every time', () => {
    const make = (): THREE.Group => {
      const root = new THREE.Group();
      const mesh = bladeMesh();
      mesh.rotation.set(0.4, 1.1, -0.7);
      root.add(mesh);
      return orientLongAxisY(root) as THREE.Group;
    };
    const a = make();
    const b = make();
    expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(1e-6);
  });
});

describe('gripAlignment', () => {
  const X = new THREE.Vector3(1, 0, 0);

  it('puts the clicked point in the fist and the blade along the axis', () => {
    const grip = new THREE.Vector3(0.02, -0.8, 0.01);
    const scale = 1.3;
    const { quaternion, position } = gripAlignment(grip, X, scale);
    // Clicked low on the weapon: the +Y half is the blade, along +X now.
    const blade = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    expect(blade.angleTo(X)).toBeLessThan(1e-6);
    // The grip point maps to the holder origin (the bone).
    const mapped = grip.clone().multiplyScalar(scale).applyQuaternion(quaternion).add(position);
    expect(mapped.length()).toBeLessThan(1e-6);
  });

  it('flips the blade side when the click lands on the upper half', () => {
    const { quaternion } = gripAlignment(new THREE.Vector3(0, 0.8, 0), X, 1);
    const blade = new THREE.Vector3(0, -1, 0).applyQuaternion(quaternion);
    expect(blade.angleTo(X)).toBeLessThan(1e-6);
  });
});
