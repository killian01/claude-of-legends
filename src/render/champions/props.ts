// Procedural signature props for the rigged champions: the oversized rifle,
// the bramble crown, the tower shield. Built in code so they tint with the
// skin accent, sized in world units (assets.ts counter-scales them against
// the rig normalization when attaching to a bone). Presentation only.

import * as THREE from 'three';
import type { ChampionPropDef } from './manifest';

function lambert(color: number, emissiveScale = 0): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  if (emissiveScale > 0) {
    mat.emissive = new THREE.Color(color).multiplyScalar(emissiveScale);
  }
  return mat;
}

// All props are authored with +Y up their long axis and origin at the grip,
// which is how KayKit handslot bones expect a held item to sit.
export function buildChampionProp(kind: ChampionPropDef['kind'], accent: number): THREE.Group {
  const group = new THREE.Group();
  const accentMat = lambert(accent);
  const darkMat = lambert(0x3a3a42);
  switch (kind) {
    case 'sword': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.95, 0.22), accentMat);
      blade.position.y = 0.62;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.3), darkMat);
      guard.position.y = 0.14;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 5), darkMat);
      group.add(blade, guard, grip);
      break;
    }
    case 'shield': {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.12, 6), accentMat);
      plate.rotation.x = Math.PI / 2;
      plate.position.set(0, 0.28, 0.1);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), darkMat);
      boss.position.set(0, 0.28, 0.18);
      group.add(plate, boss);
      break;
    }
    case 'daggers': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.14), accentMat);
      blade.position.y = 0.34;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 5), darkMat);
      group.add(blade, grip);
      break;
    }
    case 'staff': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.9, 5), darkMat);
      shaft.position.y = 0.55;
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), lambert(accent, 0.6));
      tip.position.y = 1.62;
      group.add(shaft, tip);
      break;
    }
    case 'rifle': {
      // Deliberately far longer than Vesk is tall: the weapon reads before
      // the goblin does.
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), accentMat);
      barrel.position.y = 1.05;
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.36, 6), darkMat);
      muzzle.position.y = 2.4;
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06), darkMat);
      sight.position.set(0, 1.6, -0.16);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.3), darkMat);
      stock.position.y = -0.25;
      group.add(barrel, muzzle, sight, stock);
      break;
    }
    case 'bow': {
      // A soft accent glow keeps the bow readable on dark skins.
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.06, 5, 14, Math.PI),
        lambert(accent, 0.35),
      );
      const string = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.08, 0.025), darkMat);
      group.add(arc, string);
      break;
    }
  }
  return group;
}
