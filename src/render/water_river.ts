// The river: a translucent teal sheet over the painted riverbed with two
// counter-scrolled shimmer layers, breathing gently. Cheap and assetless;
// the depth gradient lives in the ground's vertex colors underneath.

import * as THREE from 'three';
import type { GameMap } from '../sim/content/map';
import { waterStreakTexture } from './proc';

// The sheet overhangs the painted bed a touch so no seam of grass shows at
// the waterline; everything else about the band comes from the map record.
const BANK_OVERHANG = 0.4;
// Streak repeats per unit of river, kept from the 56-long sheet this started
// as, so a longer river gets more streaks rather than stretched ones.
const STREAKS_PER_UNIT = 4 / 56;

export interface RiverWater {
  group: THREE.Group;
  animate(now: number): void;
}

export function buildRiver(map: GameMap): RiverWater {
  const group = new THREE.Group();
  const { a, b } = map.river;
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const width = map.river.width + BANK_OVERHANG;
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;

  const sheetMat = new THREE.MeshLambertMaterial({
    color: 0x3585a8,
    transparent: true,
    opacity: 0.72,
    emissive: 0x1c5570,
    emissiveIntensity: 0.65,
    depthWrite: false,
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(length, width), sheetMat);
  sheet.rotation.x = -Math.PI / 2;
  sheet.rotation.z = Math.PI / 4;
  sheet.position.set(cx, 0.08, cz);
  group.add(sheet);

  const streaks = waterStreakTexture();
  streaks.repeat.set(length * STREAKS_PER_UNIT, 1);
  const shimmerA = new THREE.MeshBasicMaterial({
    map: streaks,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const layerA = new THREE.Mesh(new THREE.PlaneGeometry(length, width), shimmerA);
  layerA.rotation.x = -Math.PI / 2;
  layerA.rotation.z = Math.PI / 4;
  layerA.position.set(cx, 0.12, cz);
  group.add(layerA);

  const streaksB = waterStreakTexture();
  streaksB.repeat.set(length * STREAKS_PER_UNIT * 0.6, 1.4);
  const shimmerB = new THREE.MeshBasicMaterial({
    map: streaksB,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const layerB = new THREE.Mesh(new THREE.PlaneGeometry(length, width), shimmerB);
  layerB.rotation.x = -Math.PI / 2;
  layerB.rotation.z = Math.PI / 4;
  layerB.position.set(cx, 0.15, cz);
  group.add(layerB);

  const animate = (now: number): void => {
    streaks.offset.x = (now * 0.000022) % 1;
    streaks.offset.y = (now * 0.000006) % 1;
    streaksB.offset.x = 1 - ((now * 0.000015) % 1);
    streaksB.offset.y = (now * 0.000009) % 1;
    // The sheet breathes a little so still water never reads as paint.
    sheetMat.opacity = 0.72 + 0.05 * Math.sin(now * 0.0011);
  };

  return { group, animate };
}
