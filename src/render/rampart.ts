// An ability wall's body, presentation only. A plain wall (Korrath's) is a
// rampart of jagged stone blocks with crown teeth; a chord of an Oathfield
// (Ostrand's ring) is squared, even ashlar under a thin oath-red banner
// running along its top, so the two never read alike. Block shapes vary
// deterministically per wall id so a wall never reshuffles between frames.

import * as THREE from 'three';
import { OATH_RED } from './sworn_pennant';

const STONE = 0x8d8877;
const OATH_STONE = 0x9c978c;

// Builds the wall along local +x, centered on the origin, feet at y = 0.
export function buildRampart(id: number, length: number, ring: boolean): THREE.Group {
  const holder = new THREE.Group();
  const jitter = (i: number, k: number): number => {
    const s = Math.sin((id + 1) * 374.61 + i * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const blocks = Math.max(3, Math.round(length / 0.75));
  const pitch = length / blocks;
  let top = 0;
  for (let i = 0; i < blocks; i++) {
    const bw = ring ? pitch * 0.97 : pitch * (0.9 + jitter(i, 1) * 0.35);
    const bh = ring ? 1.35 + jitter(i, 2) * 0.12 : 1.15 + jitter(i, 2) * 0.85;
    const bd = ring ? 0.6 : 0.55 + jitter(i, 3) * 0.4;
    const shade = 0.82 + jitter(i, 4) * 0.3;
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(ring ? OATH_STONE : STONE).multiplyScalar(shade),
    });
    const block = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    block.position.set(
      -length / 2 + (i + 0.5) * pitch,
      bh / 2,
      ring ? 0 : (jitter(i, 5) - 0.5) * 0.35,
    );
    if (!ring) {
      block.rotation.y = (jitter(i, 6) - 0.5) * 0.5;
      block.rotation.z = (jitter(i, 7) - 0.5) * 0.18;
    }
    holder.add(block);
    top = Math.max(top, bh);
    // A jagged crown tooth on some stones of a plain rampart.
    if (!ring && jitter(i, 8) > 0.45) {
      const tooth = new THREE.Mesh(
        new THREE.ConeGeometry(bw * 0.34, 0.45 + jitter(i, 9) * 0.5, 4),
        mat,
      );
      tooth.position.set(block.position.x, bh + 0.15, block.position.z);
      tooth.rotation.y = jitter(i, 10) * Math.PI;
      holder.add(tooth);
    }
  }
  if (ring) {
    // The oath's banner: a thin red line along the top of the stones.
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.12, 0.2),
      new THREE.MeshLambertMaterial({ color: OATH_RED, emissive: 0x3a0608 }),
    );
    band.position.y = top + 0.04;
    holder.add(band);
  }
  return holder;
}
