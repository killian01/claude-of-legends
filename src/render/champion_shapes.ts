// Distinct procedural silhouettes per champion so you can tell WHO is on
// screen at a glance (review finding: all ten champions were identical
// capsules). Presentation data only; the sim never reads this.

import * as THREE from 'three';

interface ChampionLook {
  accent: number;
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
  korrath: { accent: 0x8f9aa8, deco: 'shield', bulk: 1.25 },
  dain: { accent: 0xe07a3a, deco: 'fists', bulk: 1.1 },
  sylra: { accent: 0x64c95e, deco: 'orb', bulk: 0.95 },
  fenn: { accent: 0x9a63d8, deco: 'blades', bulk: 0.85 },
  elowen: { accent: 0xbfe4f0, deco: 'halo', bulk: 0.95 },
  vesk: { accent: 0xc9b458, deco: 'rifle', bulk: 0.9 },
  ashvyn: { accent: 0x5f5f8a, deco: 'bow', bulk: 0.9 },
  maera: { accent: 0x4fb8c9, deco: 'staff', bulk: 0.95 },
  torv: { accent: 0xb0733a, deco: 'horns', bulk: 1.3 },
  rhoka: { accent: 0xd85e5e, deco: 'claws', bulk: 1.0 },
};

export function buildChampionMesh(championId: string | null, teamColor: number): THREE.Group {
  const holder = new THREE.Group();
  const look = (championId && LOOKS[championId]) || { accent: 0xffffff, deco: 'orb', bulk: 1 };
  const bodyMat = new THREE.MeshLambertMaterial({ color: teamColor });
  const accentMat = new THREE.MeshLambertMaterial({ color: look.accent });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6 * look.bulk, 1.0, 4, 12), bodyMat);
  body.position.y = 1.1;
  holder.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32 * look.bulk, 10, 8), accentMat);
  head.position.y = 2.05;
  holder.add(head);

  switch (look.deco) {
    case 'shield': {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.9), accentMat);
      plate.position.set(0.75, 1.1, 0);
      holder.add(plate);
      break;
    }
    case 'fists': {
      for (const side of [-1, 1]) {
        const fist = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), accentMat);
        fist.position.set(side * 0.75, 0.9, 0.2);
        holder.add(fist);
      }
      break;
    }
    case 'orb': {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), accentMat);
      orb.position.set(0.7, 1.9, 0);
      holder.add(orb);
      break;
    }
    case 'blades': {
      for (const side of [-1, 1]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.2), accentMat);
        blade.position.set(side * 0.6, 1.0, -0.25);
        blade.rotation.z = side * 0.5;
        holder.add(blade);
      }
      break;
    }
    case 'halo': {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 20), accentMat);
      halo.position.y = 2.45;
      halo.rotation.x = Math.PI / 2;
      holder.add(halo);
      break;
    }
    case 'rifle': {
      const rifle = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.12), accentMat);
      rifle.position.set(0.5, 1.5, 0.3);
      holder.add(rifle);
      break;
    }
    case 'bow': {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 16, Math.PI), accentMat);
      bow.position.set(0.6, 1.3, 0);
      bow.rotation.z = -Math.PI / 2;
      holder.add(bow);
      break;
    }
    case 'staff': {
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), accentMat);
      staff.position.set(0.6, 1.3, 0);
      holder.add(staff);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), accentMat);
      tip.position.set(0.6, 2.6, 0);
      holder.add(tip);
      break;
    }
    case 'horns': {
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 6), accentMat);
        horn.position.set(side * 0.3, 2.45, 0);
        horn.rotation.z = -side * 0.45;
        holder.add(horn);
      }
      break;
    }
    case 'claws': {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const claw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 5), accentMat);
          claw.position.set(side * 0.7, 0.75, -0.15 + i * 0.15);
          claw.rotation.x = Math.PI;
          holder.add(claw);
        }
      }
      break;
    }
  }
  return holder;
}
