// Structure meshes: towers, Sanctums, and fountain plinths. Stone reads as
// faceted flat-shaded rock; allegiance reads as an emissive team crystal.
// Presentation only; footprints and stats live in the sim.

import * as THREE from 'three';

const STONE = 0x8a887e;
const STONE_DARK = 0x5f5d55;

export function buildTowerMesh(teamColor: number): THREE.Group {
  const holder = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: STONE, flatShading: true });
  const stoneDark = new THREE.MeshLambertMaterial({ color: STONE_DARK, flatShading: true });

  const foundation = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.4, 0.9, 9), stoneDark);
  foundation.position.y = 0.45;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 4.4, 9), stone);
  shaft.position.y = 3.0;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.05, 0.55, 9), stoneDark);
  collar.position.y = 5.3;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.25, 0.75, 9), stone);
  crown.position.y = 5.95;
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85),
    new THREE.MeshLambertMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 0.85,
      flatShading: true,
    }),
  );
  crystal.scale.y = 1.5;
  crystal.position.y = 7.2;
  crystal.userData.spin = true;
  holder.add(foundation, shaft, collar, crown, crystal);
  return holder;
}

export function buildSanctumMesh(teamColor: number): THREE.Group {
  const holder = new THREE.Group();
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 3.3, 1.1, 10),
    new THREE.MeshLambertMaterial({ color: STONE_DARK, flatShading: true }),
  );
  plinth.position.y = 0.55;
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.1),
    new THREE.MeshLambertMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 0.6,
      flatShading: true,
    }),
  );
  crystal.scale.y = 1.4;
  crystal.position.y = 4.2;
  crystal.userData.spin = true;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.6, 4.4, 32),
    new THREE.MeshBasicMaterial({
      color: teamColor,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  holder.add(plinth, crystal, ring);
  return holder;
}

export interface FountainDressing {
  group: THREE.Group;
  animate(now: number): void;
}

export function buildFountain(
  x: number,
  z: number,
  r: number,
  teamColor: number,
  teamLight: number,
): FountainDressing {
  const group = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: STONE, flatShading: true });
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.6, r + 2.1, 0.55, 22), stone);
  platform.position.set(x, 0.27, z);
  platform.receiveShadow = true;

  const poolMat = new THREE.MeshLambertMaterial({
    color: 0x2d8077,
    emissive: 0x1c5a54,
    emissiveIntensity: 0.7,
  });
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.6, 0.62, 22), poolMat);
  pool.position.set(x, 0.31, z);

  const spire = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85),
    new THREE.MeshLambertMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: 0.8,
      flatShading: true,
    }),
  );
  spire.scale.y = 1.8;
  spire.position.set(x, 2.3, z);
  spire.castShadow = true;
  spire.userData.spin = true;

  const glow = new THREE.Mesh(
    new THREE.RingGeometry(r + 2.2, r + 3.0, 32),
    new THREE.MeshBasicMaterial({
      color: teamLight,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, 0.07, z);

  group.add(platform, pool, spire, glow);
  const animate = (now: number): void => {
    poolMat.emissiveIntensity = 0.7 + 0.2 * Math.sin(now * 0.0016);
    spire.rotation.y = now * 0.0004;
  };
  return { group, animate };
}
