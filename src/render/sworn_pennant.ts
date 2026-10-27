// Ostrand's Sworn read over a head (docs/design/ostrand.md, CONTEXT.md:
// Sworn): an oath-red pennant on a dark staff above the nameplate, flying
// clear of where a stun's "!" sits so the two never cover each other. Presentation only; the
// renderer shows it while the unit carries the `sworn` status.

import * as THREE from 'three';

export const OATH_RED = 0xc0262f;
const STAFF_COLOR = 0x2a2420;

// A pennant whose staff foot sits at the group's origin, flying toward +x.
export function buildSwornPennant(): THREE.Group {
  const group = new THREE.Group();
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5),
    new THREE.MeshBasicMaterial({ color: STAFF_COLOR, depthTest: false }),
  );
  staff.position.y = 0.65;
  staff.renderOrder = 10;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.85, -0.24);
  shape.lineTo(0, -0.52);
  shape.closePath();
  const flag = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: OATH_RED, side: THREE.DoubleSide, depthTest: false }),
  );
  flag.position.set(0.05, 1.28, 0);
  flag.renderOrder = 10;
  flag.name = 'flag';
  group.add(staff, flag);
  return group;
}

// The flag's flutter: a slow sway about its staff.
export function flutterPennant(pennant: THREE.Group, nowMs: number): void {
  const flag = pennant.getObjectByName('flag');
  if (flag) flag.rotation.y = 0.35 * Math.sin(nowMs / 170);
}
