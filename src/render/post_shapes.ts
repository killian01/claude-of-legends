// The Range's Strikeposts as figures (CONTEXT.md: Strikepost;
// content/strikeposts.ts), built like the camps': a few flat-shaded
// primitives. A timber post on a stone foot with a painted ring round its
// middle; the plated one clad in dark iron with steel bands and a steel
// dome (post_look.ts: postPalette), so the two read apart at a glance.
// A Blender model can replace either without touching the sim.

import * as THREE from 'three';
import type { Unit } from '../sim/unit';
import { postPalette } from './post_look';

export interface PostFigure {
  holder: THREE.Group;
  barY: number;
}

function flat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export function buildPostMesh(u: Readonly<Unit>, holder: THREE.Group): PostFigure {
  const plated = u.postKind === 'plated';
  const look = postPalette(plated ? 'plated' : 'bare');
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.3, 8), flat(look.foot));
  foot.position.y = 0.15;
  holder.add(foot);
  const timber = new THREE.Mesh(
    new THREE.CylinderGeometry(plated ? 0.44 : 0.38, plated ? 0.5 : 0.45, 2.2, 8),
    flat(look.body),
  );
  timber.position.y = 1.4;
  holder.add(timber);
  // The bare post ends in a timber point, the plated one in a steel dome.
  const cap = plated
    ? new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
        flat(look.cap),
      )
    : new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.35, 8), flat(look.cap));
  cap.position.y = plated ? 2.5 : 2.68;
  holder.add(cap);
  // The painted ring, where a hit is aimed.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(plated ? 0.53 : 0.47, 0.08, 6, 16),
    flat(look.ring),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.55;
  holder.add(ring);
  if (look.bands !== null) {
    const steel = flat(look.bands);
    for (const y of [0.75, 1.15, 1.95, 2.35]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.16, 8), steel);
      band.position.y = y;
      holder.add(band);
    }
  }
  return { holder, barY: 3.3 };
}
