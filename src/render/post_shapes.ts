// The Range's Strikeposts as figures (CONTEXT.md: Strikepost;
// content/strikeposts.ts), built like the camps': a few flat-shaded
// primitives. A timber post on a stone foot with a painted ring round its
// middle; the plated one banded in iron, so the two read apart at a
// glance. A Blender model can replace either without touching the sim.

import * as THREE from 'three';
import type { Unit } from '../sim/unit';

export interface PostFigure {
  holder: THREE.Group;
  barY: number;
}

function flat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export function buildPostMesh(u: Readonly<Unit>, holder: THREE.Group): PostFigure {
  const plated = u.postKind === 'plated';
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.3, 8), flat(0x7d7a72));
  foot.position.y = 0.15;
  holder.add(foot);
  const timber = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.45, 2.2, 8), flat(0x8a6236));
  timber.position.y = 1.4;
  holder.add(timber);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.35, 8), flat(0x6e4c2a));
  cap.position.y = 2.68;
  holder.add(cap);
  // The painted ring, where a hit is aimed.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.08, 6, 16), flat(0xd8463a));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.55;
  holder.add(ring);
  if (plated) {
    const iron = flat(0x5d6670);
    for (const y of [0.75, 1.15, 1.95, 2.35]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 8), iron);
      band.position.y = y;
      holder.add(band);
    }
  }
  return { holder, barY: 3.3 };
}
