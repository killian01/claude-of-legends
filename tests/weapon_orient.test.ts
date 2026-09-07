// The weapon-axis math behind the workshop (orient.ts): a generated
// weapon's long axis must land on +Y whatever pose the GLB shipped in,
// 'Hold it here' must put the clicked grip point in the fist with the
// blade along the hand's grip axis, and the automatic placement must
// guess the handle end of a weapon nobody has aimed yet.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { gripAlignment, guessGripPoint, orientLongAxisY } from '../src/render/champions/orient';

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

describe('guessGripPoint', () => {
  // An axe: a thin haft from -1 to +0.6, a fat head at the top. A hand
  // goes on the haft, near its free end.
  function axe(headOnTop: boolean): THREE.Group {
    const root = new THREE.Group();
    const haft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08));
    haft.position.y = headOnTop ? -0.2 : 0.2;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3));
    head.position.y = headOnTop ? 0.8 : -0.8;
    root.add(haft, head);
    root.updateMatrixWorld(true);
    return root;
  }

  it('takes the thin end, whichever end the file put it on', () => {
    const top = guessGripPoint(axe(true));
    expect(top).not.toBeNull();
    // Head up: the hand goes low, a short way in from the bottom.
    expect(top?.y ?? 0).toBeLessThan(-0.6);
    const bottom = guessGripPoint(axe(false));
    // Head down: the same weapon, held at the top instead.
    expect(bottom?.y ?? 0).toBeGreaterThan(0.6);
  });

  it('stays inside the weapon, a short way in from its end', () => {
    const root = axe(true);
    const box = new THREE.Box3().setFromObject(root);
    const grip = guessGripPoint(root);
    expect(grip).not.toBeNull();
    if (!grip) return;
    expect(grip.y).toBeGreaterThan(box.min.y);
    expect(grip.y).toBeLessThan(box.max.y);
    // A tenth of the span in: past the tip, still on the handle.
    const span = box.max.y - box.min.y;
    expect(grip.y - box.min.y).toBeCloseTo(span * 0.1, 5);
  });

  it('takes the bottom of a shape with no thin end, and nothing from an empty one', () => {
    const ball = new THREE.Group();
    ball.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    ball.updateMatrixWorld(true);
    const grip = guessGripPoint(ball);
    expect(grip?.y ?? 1).toBeLessThan(0);
    expect(guessGripPoint(new THREE.Group())).toBeNull();
  });

  it('lands in the fist when it goes through the same alignment as a click', () => {
    // The whole point: what the placement computes must be what an aimed
    // click would have computed, so the weapon arrives held.
    const root = axe(true);
    const grip = guessGripPoint(root);
    expect(grip).not.toBeNull();
    if (!grip) return;
    const axis = new THREE.Vector3(0, 0, 1);
    const fit = gripAlignment(grip, axis, 1);
    const held = grip.clone().applyQuaternion(fit.quaternion).add(fit.position);
    // The grip point sits exactly at the holder's origin, which is the
    // fist, and the blade runs along the hand's axis.
    expect(held.length()).toBeLessThan(1e-6);
    const blade = new THREE.Vector3(0, 1, 0).applyQuaternion(fit.quaternion);
    expect(blade.angleTo(axis)).toBeLessThan(1e-6);
  });
});
