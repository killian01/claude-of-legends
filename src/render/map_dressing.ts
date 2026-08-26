// Assembles the static map look: painted ground, forest skirt beyond the
// playable square, river water, vegetation, and fountain plinths. Owns the
// per-frame dressing animation (wind time, water scroll, pool glow).

import * as THREE from 'three';
import type { GameMap } from '../sim/content/map';
import { buildFlora } from './flora';
import { buildGround } from './ground';
import { buildMapPaint } from './map_paint';
import { buildFountain, type FountainDressing } from './structure_shapes';
import { buildRiver, type RiverWater } from './water_river';

export const SKIRT_COLOR = 0x1b2c14;

export interface MapDressing {
  animate(now: number): void;
}

export function buildMapDressing(
  scene: THREE.Scene,
  map: GameMap,
  teamColors: readonly number[],
  teamLight: readonly number[],
): MapDressing {
  const paint = buildMapPaint(map);
  scene.add(buildGround(map, paint));

  // The forest floor beyond the playable square: with the border tree belt
  // and the scene fog it replaces the old off-map void.
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshLambertMaterial({ color: SKIRT_COLOR }),
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(map.size / 2, -0.06, map.size / 2);
  skirt.receiveShadow = true;
  scene.add(skirt);

  const river: RiverWater = buildRiver(map);
  scene.add(river.group);

  const flora = buildFlora(map, paint);
  scene.add(flora.group);

  const fountains: FountainDressing[] = map.fountains.map((f) =>
    buildFountain(f.x, f.z, f.r, teamColors[f.team] ?? 0xffffff, teamLight[f.team] ?? 0xffffff),
  );
  for (const f of fountains) scene.add(f.group);

  const animate = (now: number): void => {
    flora.uTime.value = now * 0.001;
    river.animate(now);
    for (const f of fountains) f.animate(now);
  };
  return { animate };
}
