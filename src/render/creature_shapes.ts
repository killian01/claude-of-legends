// The rings' creatures as figures (CONTEXT.md: Pyrefang, Voidmaul), built
// like the Warden's: a few flat-shaded primitives, an emissive accent in
// the aspect's color, and a beacon of that color above, so the creature and
// what it carries read from anywhere nearby. Two silhouettes: the Pyrefang
// lean and forward, a spine of embers and a trail behind; the Voidmaul low
// and massive, black veined with light, a great maul at its side. A
// Blender model can replace either body later without touching the sim.

import * as THREE from 'three';
import type { Unit } from '../sim/unit';
import { aspectColor } from './aspect_colors';

export interface CreatureFigure {
  holder: THREE.Group;
  barY: number;
}

function beaconOf(color: number): THREE.Mesh {
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.2, 16, 6, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beacon.position.y = 8;
  beacon.userData.spin = true;
  return beacon;
}

function glowOf(color: number, intensity: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    flatShading: true,
  });
}

// The Pyrefang: a low predator stretched along its stride, a wedge of a
// head, four splayed legs, a ridge of ember spikes down the spine and a
// trail of embers tapering behind it.
function pyrefang(holder: THREE.Group, accent: number): CreatureFigure {
  const hide = new THREE.MeshLambertMaterial({ color: 0x3a1c14, flatShading: true });
  const ember = glowOf(accent, 0.75);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), hide);
  body.position.y = 1.1;
  body.scale.set(0.85, 0.8, 1.7);
  holder.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 5), hide);
  head.position.set(0, 1.25, 1.9);
  head.rotation.x = Math.PI / 2;
  holder.add(head);
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 4), ember);
    fang.position.set(side * 0.22, 1.0, 2.35);
    fang.rotation.x = Math.PI;
    holder.add(fang);
    for (const front of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.0, 5), hide);
      leg.position.set(side * 0.7, 0.5, front * 0.9);
      leg.rotation.z = -side * 0.25;
      holder.add(leg);
    }
  }
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9 - i * 0.12, 4), ember);
    spike.position.set(0, 1.85 - i * 0.08, 1.0 - i * 0.55);
    spike.rotation.x = -0.45;
    holder.add(spike);
  }
  for (let i = 0; i < 4; i++) {
    const trail = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 - i * 0.05, 0), ember);
    trail.position.set(0, 1.0 - i * 0.12, -1.9 - i * 0.55);
    holder.add(trail);
  }
  holder.add(beaconOf(accent));
  holder.scale.setScalar(1.05);
  return { holder, barY: 3.6 };
}

// The Voidmaul: a slab of a body close to the ground, four pillar legs, a
// blunt head sunk into the shoulders, veins of light across the hide, and
// the maul held low at its right side, its head glowing at the seams.
function voidmaul(holder: THREE.Group, accent: number): CreatureFigure {
  const hide = new THREE.MeshLambertMaterial({
    color: 0x16122a,
    emissive: accent,
    emissiveIntensity: 0.18,
    flatShading: true,
  });
  const vein = glowOf(accent, 0.8);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 0), hide);
  body.position.y = 1.5;
  body.scale.set(1.35, 0.95, 1.25);
  holder.add(body);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), hide);
  head.position.set(0, 1.9, 1.35);
  head.scale.set(1.1, 0.8, 1);
  holder.add(head);
  for (const side of [-1, 1]) {
    for (const front of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.2, 6), hide);
      leg.position.set(side * 1.05, 0.6, front * 0.85);
      holder.add(leg);
    }
    const veinBar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.2), vein);
    veinBar.position.set(side * 0.75, 2.35, 0.1);
    veinBar.rotation.y = side * 0.18;
    holder.add(veinBar);
  }
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), vein);
  eyes.position.set(0, 2.0, 1.9);
  holder.add(eyes);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 6), hide);
  handle.position.set(1.9, 1.3, -0.2);
  handle.rotation.z = 0.35;
  holder.add(handle);
  const maulHead = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.3), hide);
  maulHead.position.set(2.35, 2.5, -0.2);
  maulHead.rotation.z = 0.35;
  holder.add(maulHead);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 1.35), vein);
  seam.position.copy(maulHead.position);
  seam.rotation.z = 0.35;
  holder.add(seam);
  holder.add(beaconOf(accent));
  holder.scale.setScalar(1.1);
  return { holder, barY: 4.2 };
}

// Builds the creature's figure into `holder`. The caller enables shadows
// and collects the beacon as a spinner, like it does for the Warden.
export function buildCreatureMesh(u: Readonly<Unit>, holder: THREE.Group): CreatureFigure {
  const accent = aspectColor(u.aspect).hex;
  return u.creatureId === 'voidmaul' ? voidmaul(holder, accent) : pyrefang(holder, accent);
}
