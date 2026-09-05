// The grip's rest orientation (the workshop and the match renderer share
// it). Every authored weapon pose is relative to this rest, so the rest
// has to be the SAME every time or a saved weapon sits somewhere new on
// each open. It used to be sampled on a wall clock, 300 or 400 ms in,
// which lands on a different frame of the idle every run.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { captureRestPose, type PropAnchor, syncPropAnchors } from '../src/render/champions/assets';

function rig(): { root: THREE.Object3D; bone: THREE.Bone; anchor: PropAnchor } {
  const root = new THREE.Object3D();
  const bone = new THREE.Bone();
  root.add(bone);
  const holder = new THREE.Group();
  root.add(holder);
  const anchor: PropAnchor = {
    holder,
    prop: new THREE.Object3D(),
    hand: { bone, rot: [0, 0, 0], pos: [0, 0, 0] },
    armed: true,
    fixedPose: false,
    tip: null,
    restInv: null,
  };
  return { root, bone, anchor };
}

// The holder's turn away from the rest, in degrees.
function holderTurn(anchor: PropAnchor): number {
  const q = anchor.holder.quaternion;
  return (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
}

describe('the grip rest pose', () => {
  it('reads the pose it is given, whenever it is called', () => {
    const { root, bone, anchor } = rig();
    // The reference frame: the idle at time zero, whatever that is.
    bone.rotation.set(0.2, 0, 0);
    captureRestPose(root, [anchor]);
    const first = anchor.restInv!.clone();

    // The clip plays on: the bone is somewhere else entirely now.
    bone.rotation.set(1.1, 0.4, -0.7);
    root.updateMatrixWorld(true);
    // Called again from the reference frame, it answers the same thing.
    bone.rotation.set(0.2, 0, 0);
    captureRestPose(root, [anchor]);
    expect(anchor.restInv!.angleTo(first)).toBeLessThan(1e-6);
  });

  it('leaves the prop square with the rig at the reference frame', () => {
    const { root, bone, anchor } = rig();
    bone.rotation.set(0.2, 0, 0);
    captureRestPose(root, [anchor]);
    root.updateMatrixWorld(true);
    syncPropAnchors(root, [anchor]);
    // At rest the holder adds no turn of its own: the authored grip is
    // exactly what the creator sees.
    expect(holderTurn(anchor)).toBeLessThan(1e-3);
  });

  it('turns the prop by the bone’s travel away from that frame, and only that', () => {
    const { root, bone, anchor } = rig();
    bone.rotation.set(0.2, 0, 0);
    captureRestPose(root, [anchor]);
    // Half a radian on, the weapon follows the bone by half a radian.
    bone.rotation.set(0.7, 0, 0);
    root.updateMatrixWorld(true);
    syncPropAnchors(root, [anchor]);
    expect(holderTurn(anchor)).toBeCloseTo((0.5 * 180) / Math.PI, 3);
  });

  it('is what the old sampling could not be: independent of when it ran', () => {
    // Two runs of the same session, reaching the reference frame after
    // different amounts of play. The old rule captured the first frame
    // seen after a delay, so these two disagreed; the rest is now named,
    // so they cannot.
    const a = rig();
    const b = rig();
    a.bone.rotation.set(0.9, -0.3, 0.2);
    a.root.updateMatrixWorld(true);
    a.bone.rotation.set(0.2, 0, 0);
    captureRestPose(a.root, [a.anchor]);

    b.bone.rotation.set(-1.4, 0.8, 1.2);
    b.root.updateMatrixWorld(true);
    b.bone.rotation.set(0.55, 0.1, 0);
    b.root.updateMatrixWorld(true);
    b.bone.rotation.set(0.2, 0, 0);
    captureRestPose(b.root, [b.anchor]);

    expect(a.anchor.restInv!.angleTo(b.anchor.restInv!)).toBeLessThan(1e-6);
  });
});
