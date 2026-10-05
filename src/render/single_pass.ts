// A double-sided see-through material is drawn twice by three, its back
// faces then its front ones, and each of those draws looks its program up
// again (the side flips, the material counts as changed): for the mist and
// the veils of a fight, twice the draws and a program lookup per draw,
// every frame. When the material adds its light and writes no depth, the
// order of its faces changes nothing on the screen (adding commutes, and
// with no depth written neither face hides the other), so it is drawn in
// one pass: the same picture for half the draws.

import * as THREE from 'three';

// Whether drawing the material in one pass gives the very same picture.
export function onePassAlike(material: THREE.Material): boolean {
  return (
    material.side === THREE.DoubleSide &&
    material.blending === THREE.AdditiveBlending &&
    material.depthWrite === false
  );
}

// Draws the material in one pass where that changes nothing on the screen.
export function drawInOnePassWhereAlike(material: THREE.Material): void {
  if (onePassAlike(material)) material.forceSinglePass = true;
}
