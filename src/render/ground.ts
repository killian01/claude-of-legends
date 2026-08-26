// The painted ground: one plane whose vertex colors carry the whole map
// tint (grass, jungle, lanes, riverbed, plazas) over a near-gray tiling
// detail texture. Replaces the flat single-color plane plus box lane strips.

import * as THREE from 'three';
import type { GameMap } from '../sim/content/map';
import type { MapPaint } from './map_paint';
import { groundDetailTexture } from './proc';

const SEGMENTS = 150;

export function buildGround(map: GameMap, paint: MapPaint): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(map.size, map.size, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  geo.translate(map.size / 2, 0, map.size / 2);

  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    paint.colorAt(pos.getX(i), pos.getZ(i), c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const detail = groundDetailTexture();
  // Keep the detail period near 2.2 world units so grain reads at MOBA zoom.
  detail.repeat.set(68, 68);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: detail,
    // A tiny emissive floor so shadowed ground never crushes to black.
    emissive: 0x182014,
    emissiveIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
