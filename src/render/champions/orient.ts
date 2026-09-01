// Weapon-axis math for forged props (playtest: aligning a generated
// weapon by hand was the workshop's hardest chore). Two jobs, both pure
// three.js math with no DOM:
//   orientLongAxisY: a weapon GLB arrives with whatever axes its
//     generator liked (a sword lying diagonally is normal); this turns
//     the geometry so its long axis rides +Y, the convention the house
//     props are authored in. After it, local axes mean something: +Y is
//     'along the blade' everywhere in the workshop.
//   gripAlignment: the math behind 'Hold it here': given the clicked
//     grip point and the hand's grip axis, the prop transform that puts
//     the grip in the fist with the blade along that axis.

import * as THREE from 'three';

// The hand bone's grip axis, in bone-local space, shared by every Tripo
// v1.0 biped rig (same skeleton conventions everywhere). Measured on the
// mannequin's bind pose: hand bones point +Y along the fingers, and the
// fist's tunnel (where a held rod sits, thumb side positive) runs along
// local +Z within the bind noise (mannequin: (0.01, 0.33, 0.94) left,
// (0.04, -0.34, 0.94) right; the Y parts are per-model fit noise, the
// clean convention is +Z).
export const HAND_GRIP_AXIS: Readonly<THREE.Vector3> = new THREE.Vector3(0, 0, 1);

const UP = new THREE.Vector3(0, 1, 0);

// Rotates `root` so the geometry's dominant axis (principal component of
// sampled vertices) lands on +Y. Sign is normalized deterministically
// (the axis' largest component points positive), so the same file always
// orients the same way; which END is the grip is not knowable from
// geometry and stays the player's call (Hold it here, or two quarter
// turns). A shape with no dominant axis (a shield) gets whatever the
// iteration settles on: harmless, since every axis is as good.
export function orientLongAxisY(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const points: THREE.Vector3[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    const pos = mesh.geometry?.getAttribute('position');
    if (!pos) return;
    const local = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      points.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(local));
    }
  });
  if (points.length < 3) return root;

  const center = new THREE.Vector3();
  for (const p of points) center.add(p);
  center.divideScalar(points.length);
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const p of points) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dz = p.z - center.z;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  // Power iteration on the covariance: the dominant eigenvector IS the
  // long axis. 32 rounds is far past convergence for any weapon shape.
  const axis = new THREE.Vector3(1, 1, 1).normalize();
  for (let i = 0; i < 32; i++) {
    axis.set(
      xx * axis.x + xy * axis.y + xz * axis.z,
      xy * axis.x + yy * axis.y + yz * axis.z,
      xz * axis.x + yz * axis.y + zz * axis.z,
    );
    const len = axis.length();
    if (len < 1e-12) return root;
    axis.divideScalar(len);
  }
  const ax = Math.abs(axis.x);
  const ay = Math.abs(axis.y);
  const az = Math.abs(axis.z);
  const top = Math.max(ax, ay, az);
  const lead = top === ay ? axis.y : top === ax ? axis.x : axis.z;
  if (lead < 0) axis.negate();
  root.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(axis, UP));
  return root;
}

// The 'Hold it here' pose: the prop-local transform (for a prop whose
// long axis is +Y, see above) that puts `gripLocal` (the clicked point,
// in prop space) at the parent holder's origin, with the blade along
// `axisHolder` (the hand's grip axis expressed in the holder's frame).
// The blade is the LONG side of the weapon as seen from the click: a
// click on the lower half sends +Y out of the fist, a click on the upper
// half sends -Y. setFromUnitVectors keeps the roll minimal, on purpose:
// the edge stays where the file put it, quarter turns adjust it.
export function gripAlignment(
  gripLocal: THREE.Vector3,
  axisHolder: THREE.Vector3,
  scale: number,
): { quaternion: THREE.Quaternion; position: THREE.Vector3 } {
  const blade = new THREE.Vector3(0, gripLocal.y <= 0 ? 1 : -1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    blade,
    axisHolder.clone().normalize(),
  );
  const position = gripLocal.clone().multiplyScalar(scale).applyQuaternion(quaternion).negate();
  return { quaternion, position };
}
