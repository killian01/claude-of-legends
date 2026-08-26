// Minion figures: little characters instead of raw primitives. The variant
// is inferred from the unit's stats the way the wire exposes them (radius
// and attack range), so the same code dresses offline sim units and online
// mirror units. Returns the holder plus the torso the renderer waddles.
// Presentation only.

import * as THREE from 'three';
import type { Unit } from '../sim/unit';

export interface MinionMesh {
  holder: THREE.Group;
  body: THREE.Object3D;
  barY: number;
}

function lambert(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export function buildMinionMesh(u: Readonly<Unit>, teamColor: number): MinionMesh {
  const holder = new THREE.Group();
  const base = new THREE.Color(teamColor);
  const dark = lambert(base.clone().multiplyScalar(0.55));
  const main = lambert(base);
  const skin = lambert(0xd8b98a);

  // Vanguard: the hulking lane-escalation brute.
  if (u.radius >= 0.75) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.5, 1.0), main);
    body.position.y = 0.95;
    holder.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 5), skin);
    head.position.set(0, 1.95, 0.25);
    holder.add(head);
    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 5), dark);
      pauldron.position.set(side * 0.75, 1.6, 0);
      holder.add(pauldron);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 5), dark);
      fist.position.set(side * 0.85, 0.7, 0.25);
      holder.add(fist);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 4), dark);
      spike.position.set(side * 0.45, 2.1, -0.15);
      holder.add(spike);
    }
    return { holder, body, barY: 2.6 };
  }

  const ranged = u.stats.attackRange > 2;
  const siege = ranged && u.stats.attackRange <= 5;

  if (siege) {
    // Siege golem: squat armored bulk with a boulder on its back.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.8), main);
    body.position.y = 0.55;
    holder.add(body);
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), dark);
    boulder.position.set(0, 1.2, -0.25);
    holder.add(boulder);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.35), skin);
    head.position.set(0, 1.15, 0.3);
    holder.add(head);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), dark);
      arm.position.set(side * 0.62, 0.55, 0.1);
      holder.add(arm);
    }
    return { holder, body, barY: 2.0 };
  }

  if (ranged) {
    // Caster: a robed figure with a glowing staff.
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 6), main);
    robe.position.y = 0.5;
    holder.add(robe);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), skin);
    head.position.y = 1.15;
    holder.add(head);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 6), dark);
    hood.position.y = 1.32;
    holder.add(hood);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 5), dark);
    staff.position.set(0.35, 0.75, 0.1);
    holder.add(staff);
    const tip = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshLambertMaterial({
        color: base,
        emissive: base,
        emissiveIntensity: 0.8,
        flatShading: true,
      }),
    );
    tip.position.set(0.35, 1.35, 0.1);
    holder.add(tip);
    return { holder, body: robe, barY: 1.8 };
  }

  // Melee grunt: stubby fighter with a blade and a buckler.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.4, 3, 6), main);
  body.position.y = 0.62;
  holder.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 5), skin);
  head.position.y = 1.12;
  holder.add(head);
  const helm = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.22, 6), dark);
  helm.position.y = 1.28;
  holder.add(helm);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.12), dark);
  blade.position.set(0.4, 0.75, 0.15);
  blade.rotation.z = 0.35;
  holder.add(blade);
  const buckler = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8), dark);
  buckler.position.set(-0.38, 0.7, 0.1);
  buckler.rotation.z = Math.PI / 2;
  holder.add(buckler);
  return { holder, body, barY: 1.8 };
}
