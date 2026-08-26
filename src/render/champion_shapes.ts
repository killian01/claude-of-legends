// Distinct procedural silhouettes per champion so you can tell WHO is on
// screen at a glance. Each champion is a small articulated low-poly figure
// (legs, hips, torso, shoulder pads, arms, head) plus a signature prop,
// flat-shaded to match the map dressing. Colors come from the skin palette
// (src/sim/content/skins.ts); a team-colored base ring keeps allegiance
// readable when a skin recolors the body. Presentation only.

import * as THREE from 'three';
import { skinOf } from '../sim/content/skins';

interface ChampionLook {
  deco:
    | 'shield'
    | 'fists'
    | 'orb'
    | 'blades'
    | 'halo'
    | 'rifle'
    | 'bow'
    | 'staff'
    | 'horns'
    | 'claws';
  bulk: number;
}

const LOOKS: Readonly<Record<string, ChampionLook>> = {
  korrath: { deco: 'shield', bulk: 1.25 },
  dain: { deco: 'fists', bulk: 1.1 },
  sylra: { deco: 'orb', bulk: 0.95 },
  fenn: { deco: 'blades', bulk: 0.85 },
  elowen: { deco: 'halo', bulk: 0.95 },
  vesk: { deco: 'rifle', bulk: 0.9 },
  ashvyn: { deco: 'bow', bulk: 0.9 },
  maera: { deco: 'staff', bulk: 0.95 },
  torv: { deco: 'horns', bulk: 1.3 },
  rhoka: { deco: 'claws', bulk: 1.0 },
};

export function buildChampionMesh(
  championId: string | null,
  teamColor: number,
  skin = 0,
): THREE.Group {
  const holder = new THREE.Group();
  const look = (championId && LOOKS[championId]) || { deco: 'orb', bulk: 1 };
  const b = look.bulk;
  const palette = skinOf(championId, skin);
  const bodyColor = new THREE.Color(palette.body ?? teamColor);
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true });
  const darkMat = new THREE.MeshLambertMaterial({
    color: bodyColor.clone().multiplyScalar(0.6),
    flatShading: true,
  });
  const accentMat = new THREE.MeshLambertMaterial({ color: palette.accent, flatShading: true });

  // Legs, hips, torso, shoulders, arms, head: a figure, not a pill. Legs and
  // arms hang from pivot groups at hip and shoulder height so the renderer
  // can swing them in a walk cycle; the pivots (plus torso and head) are
  // published on holder.userData.anim.
  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.18 * b, 0.78, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13 * b, 0.4, 3, 6), darkMat);
    leg.position.y = -0.36;
    pivot.add(leg);
    holder.add(pivot);
    legs.push(pivot);
  }
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.52 * b, 0.26, 0.36 * b), darkMat);
  hips.position.y = 0.78;
  holder.add(hips);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * b, 0.44 * b, 0.85, 6), bodyMat);
  torso.position.y = 1.32;
  holder.add(torso);
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.18 * b, 6, 5), accentMat);
    pad.position.set(side * (0.42 * b + 0.06), 1.66, 0);
    holder.add(pad);
    const pivot = new THREE.Group();
    pivot.position.set(side * (0.5 * b + 0.06), 1.5, 0.04);
    pivot.rotation.z = side * 0.14;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1 * b, 0.42, 3, 6), bodyMat);
    arm.position.y = -0.28;
    pivot.add(arm);
    holder.add(pivot);
    arms.push(pivot);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26 * b, 8, 6), accentMat);
  head.position.y = 2.02;
  holder.add(head);
  holder.userData.anim = { legs, arms, torso, head };

  // Team allegiance survives any skin: a colored ring at the feet.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72 * b, 0.07, 6, 24),
    new THREE.MeshLambertMaterial({ color: teamColor }),
  );
  ring.position.y = 0.12;
  ring.rotation.x = Math.PI / 2;
  holder.add(ring);

  switch (look.deco) {
    case 'shield': {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.6, 0.14, 6), accentMat);
      plate.position.set(-0.72 * b, 1.2, 0.1);
      plate.rotation.z = Math.PI / 2;
      holder.add(plate);
      break;
    }
    case 'fists': {
      for (const side of [-1, 1]) {
        const fist = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 5), accentMat);
        fist.position.set(side * (0.52 * b + 0.08), 0.92, 0.16);
        holder.add(fist);
      }
      break;
    }
    case 'orb': {
      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2),
        new THREE.MeshLambertMaterial({
          color: palette.accent,
          emissive: palette.accent,
          emissiveIntensity: 0.7,
          flatShading: true,
        }),
      );
      orb.position.set(0.62 * b, 2.15, 0.1);
      holder.add(orb);
      break;
    }
    case 'blades': {
      for (const side of [-1, 1]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.16), accentMat);
        blade.position.set(side * (0.54 * b + 0.05), 0.95, -0.2);
        blade.rotation.z = side * 0.5;
        holder.add(blade);
      }
      break;
    }
    case 'halo': {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 20), accentMat);
      halo.position.y = 2.48;
      halo.rotation.x = Math.PI / 2;
      holder.add(halo);
      break;
    }
    case 'rifle': {
      const rifle = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.12), accentMat);
      rifle.position.set(0.42 * b, 1.32, 0.3);
      holder.add(rifle);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.14), darkMat);
      stock.position.set(-0.2, 1.28, 0.3);
      holder.add(stock);
      break;
    }
    case 'bow': {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 16, Math.PI), accentMat);
      bow.position.set(0.58 * b, 1.28, 0.1);
      bow.rotation.z = -Math.PI / 2;
      holder.add(bow);
      break;
    }
    case 'staff': {
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5), accentMat);
      staff.position.set(0.58 * b, 1.25, 0);
      holder.add(staff);
      const tip = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.17),
        new THREE.MeshLambertMaterial({
          color: palette.accent,
          emissive: palette.accent,
          emissiveIntensity: 0.6,
          flatShading: true,
        }),
      );
      tip.position.set(0.58 * b, 2.5, 0);
      holder.add(tip);
      break;
    }
    case 'horns': {
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 5), accentMat);
        horn.position.set(side * 0.26 * b, 2.32, 0);
        horn.rotation.z = -side * 0.45;
        holder.add(horn);
      }
      break;
    }
    case 'claws': {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.32, 4), accentMat);
          claw.position.set(side * (0.54 * b + 0.06), 0.82, -0.12 + i * 0.13);
          claw.rotation.x = Math.PI;
          holder.add(claw);
        }
      }
      break;
    }
  }
  return holder;
}
