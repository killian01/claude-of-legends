// Instanced vegetation and rocks: a swaying blade-grass carpet, primitive
// trees ringing the jungle walls and the map border, boulder outcrops on
// the wall blobs, and tall tufts on brush patches. A handful of draw calls
// total; every placement is seeded and deterministic.

import * as THREE from 'three';
import type { GameMap } from '../sim/content/map';
import type { MapPaint } from './map_paint';
import { makeRnd } from './proc';

const TRUNK_COLOR = 0x4a3620;
const CONIFER_COLOR = 0x2f6023;
const PUFF_COLOR = 0x477e2b;
const ROCK_COLOR = 0x7a7a72;
const BRUSH_TINT = new THREE.Color(0x6cbc49);

export interface Flora {
  group: THREE.Group;
  uTime: { value: number };
}

// Five tapered blades per cluster, vertex colors doing the root-to-tip
// brighten, every normal forced up so grass takes the ground's lighting.
function grassClusterGeometry(rnd: () => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (let blade = 0; blade < 5; blade++) {
    const yaw = rnd() * Math.PI * 2;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ox = (rnd() - 0.5) * 0.5;
    const oz = (rnd() - 0.5) * 0.5;
    const tilt = rnd() * 0.38;
    const bow = 0.1 + rnd() * 0.45;
    const len = 0.55 + rnd() * 0.55;
    const w0 = 0.05 + rnd() * 0.025;
    const px = -sin;
    const pz = cos;
    const base = positions.length / 3;
    const put = (wx: number, t: number, shade: number): void => {
      // Quadratic lean: roots stay planted, tips arc over.
      const lean = (tilt * t + bow * t * t) * len;
      positions.push(ox + px * wx + cos * lean, len * t, oz + pz * wx + sin * lean);
      colors.push(shade, shade, shade);
      normals.push(0, 1, 0);
    };
    put(-w0, 0, 0.6);
    put(w0, 0, 0.6);
    put(-w0 * 0.62, 0.45, 0.85);
    put(w0 * 0.62, 0.45, 0.85);
    put(-w0 * 0.34, 0.76, 1.02);
    put(w0 * 0.34, 0.76, 1.02);
    put(0, 1, 1.15);
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    index.push(base + 2, base + 3, base + 4, base + 3, base + 5, base + 4);
    index.push(base + 4, base + 5, base + 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(index);
  return geo;
}

// Wind sway shared by grass and canopies: a travelling gust SCALES the
// amplitude so vegetation swells and calms in coherent waves across the
// map instead of every plant flapping at one fixed rate. Weight rises with
// height squared so roots stay planted.
function applyWind(
  mat: THREE.Material,
  uTime: { value: number },
  amplitude: number,
  heightNorm: number,
): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = `uniform float uTime;\n${sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 wOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float wPhase = wOrigin.x * 1.7 + wOrigin.z * 2.3;
        float wGust = 0.6 + 0.4 * sin(uTime * 0.6 + wOrigin.x * 0.05 + wOrigin.z * 0.04);
        float wH = position.y / ${heightNorm.toFixed(2)};
        float wSway = (sin(uTime * 2.1 + wPhase) + 0.4 * sin(uTime * 3.7 + wPhase * 1.31))
          * ${amplitude.toFixed(3)} * wGust * wH * wH;
        transformed.x += wSway;
        transformed.z += wSway * 0.7;
      #endif`,
    )}`;
  };
}

interface TreeSpot {
  x: number;
  z: number;
  s: number;
  puff: boolean;
}

function planTrees(map: GameMap, rnd: () => number): TreeSpot[] {
  const spots: TreeSpot[] = [];
  // A ring of trees on each jungle wall blob, outside its rock mound.
  for (const w of map.walls) {
    const count = 3 + Math.floor(w.r / 3);
    const start = rnd() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const angle = start + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const dist = w.r * (0.55 + rnd() * 0.3);
      spots.push({
        x: w.x + Math.cos(angle) * dist,
        z: w.z + Math.sin(angle) * dist,
        s: 0.9 + rnd() * 0.6,
        puff: rnd() < 0.5,
      });
    }
  }
  // A dense forest belt outside the playable square: this is what replaces
  // the off-map void at the spawn corners.
  const bands: [number, number][] = [];
  for (let t = -30; t <= map.size + 30; t += 3.4) bands.push([t + (rnd() - 0.5) * 2, 0]);
  for (const [t] of bands) {
    for (const side of [0, 1, 2, 3]) {
      const off = 3.5 + rnd() * 20;
      const s = 1.3 + rnd() * 1.1;
      const puff = rnd() < 0.45;
      if (side === 0) spots.push({ x: t, z: -off, s, puff });
      else if (side === 1) spots.push({ x: t, z: map.size + off, s, puff });
      else if (side === 2) spots.push({ x: -off, z: t, s, puff });
      else spots.push({ x: map.size + off, z: t, s, puff });
    }
  }
  return spots;
}

export function buildFlora(map: GameMap, paint: MapPaint): Flora {
  const group = new THREE.Group();
  const uTime = { value: 0 };
  const rnd = makeRnd(7);
  const color = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  // Grass carpet: rejection-sampled over open ground.
  const clusterGeo = grassClusterGeometry(rnd);
  const grassMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  applyWind(grassMat, uTime, 0.14, 1.1);
  const blocked = [
    ...map.fountains.map((f) => ({ x: f.x, z: f.z, r: f.r + 4 })),
    ...map.sanctums.map((s) => ({ x: s.x, z: s.z, r: 8 })),
    ...map.towers.map((t) => ({ x: t.x, z: t.z, r: 3 })),
  ];
  const spots: { x: number; z: number }[] = [];
  for (let tries = 0; tries < 9000 && spots.length < 1900; tries++) {
    const x = 3 + rnd() * (map.size - 6);
    const z = 3 + rnd() * (map.size - 6);
    if (paint.laneDist(x, z) < 5.2) continue;
    if (paint.riverDist(x, z) < 7.2) continue;
    if (paint.wallDist(x, z) < 0.4) continue;
    if (blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.r)) continue;
    spots.push({ x, z });
  }
  const carpet = new THREE.InstancedMesh(clusterGeo, grassMat, spots.length);
  spots.forEach((p, i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const s = 0.8 + rnd() * 0.5;
    m.compose(pos.set(p.x, 0, p.z), q, scl.set(s, s * (0.85 + rnd() * 0.5), s));
    carpet.setMatrixAt(i, m);
    paint.grassColorAt(p.x, p.z, color);
    color.multiplyScalar(1.35);
    carpet.setColorAt(i, color);
  });
  carpet.frustumCulled = false;
  carpet.receiveShadow = true;
  group.add(carpet);

  // Brush patches: taller, brighter tufts plus a soft base disc, so hiding
  // spots pop against the carpet.
  const brushSpots: { x: number; z: number }[] = [];
  const discMat = new THREE.MeshLambertMaterial({
    color: 0x4d9032,
    transparent: true,
    opacity: 0.4,
  });
  for (const b of map.brush) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(b.r, 18), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(b.x, 0.045, b.z);
    group.add(disc);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * b.r * 0.85;
      brushSpots.push({ x: b.x + Math.cos(a) * d, z: b.z + Math.sin(a) * d });
    }
  }
  const tufts = new THREE.InstancedMesh(clusterGeo, grassMat, brushSpots.length);
  brushSpots.forEach((p, i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const s = 1.7 + rnd() * 0.9;
    m.compose(pos.set(p.x, 0, p.z), q, scl.set(s, s * (1.0 + rnd() * 0.4), s));
    tufts.setMatrixAt(i, m);
    color.copy(BRUSH_TINT).multiplyScalar(0.85 + rnd() * 0.3);
    tufts.setColorAt(i, color);
  });
  tufts.frustumCulled = false;
  group.add(tufts);

  // Trees: shared trunks, then cone canopies for conifers and icosahedron
  // puff clouds for broadleaves, all per-instance tinted.
  const trees = planTrees(map, rnd);
  const conifers = trees.filter((t) => !t.puff);
  const puffTrees = trees.filter((t) => t.puff);

  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.28, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: TRUNK_COLOR, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trees.forEach((t, i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m.compose(pos.set(t.x, 0, t.z), q, scl.set(t.s * 0.9, t.s * 2.1, t.s * 0.9));
    trunks.setMatrixAt(i, m);
    color.setScalar(0.85 + rnd() * 0.3);
    trunks.setColorAt(i, color);
  });
  trunks.frustumCulled = false;
  trunks.castShadow = true;
  group.add(trunks);

  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  coneGeo.translate(0, 0.5, 0);
  const coniferMat = new THREE.MeshLambertMaterial({ color: CONIFER_COLOR, flatShading: true });
  applyWind(coniferMat, uTime, 0.05, 1.0);
  const cones = new THREE.InstancedMesh(coneGeo, coniferMat, conifers.length * 2);
  conifers.forEach((t, i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const jitter = 0.82 + rnd() * 0.36;
    m.compose(pos.set(t.x, t.s * 1.3, t.z), q, scl.set(t.s * 1.55, t.s * 2.4, t.s * 1.55));
    cones.setMatrixAt(i * 2, m);
    m.compose(pos.set(t.x, t.s * 2.7, t.z), q, scl.set(t.s * 1.05, t.s * 1.8, t.s * 1.05));
    cones.setMatrixAt(i * 2 + 1, m);
    color.setScalar(jitter);
    color.g *= 1.05;
    cones.setColorAt(i * 2, color);
    cones.setColorAt(i * 2 + 1, color.multiplyScalar(1.08));
  });
  cones.frustumCulled = false;
  cones.castShadow = true;
  group.add(cones);

  const puffGeo = new THREE.IcosahedronGeometry(1, 0);
  puffGeo.scale(1.15, 0.85, 1.15);
  const puffMat = new THREE.MeshLambertMaterial({ color: PUFF_COLOR });
  applyWind(puffMat, uTime, 0.06, 1.0);
  const puffs = new THREE.InstancedMesh(puffGeo, puffMat, puffTrees.length * 4);
  puffTrees.forEach((t, i) => {
    const offsets: [number, number, number, number][] = [
      [0, 2.4, 0, 1.25],
      [0.85, 2.0, 0.3, 0.8],
      [-0.7, 2.1, -0.45, 0.85],
      [0.2, 2.9, -0.1, 0.7],
    ];
    const jitter = 0.82 + rnd() * 0.36;
    offsets.forEach((o, j) => {
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const r = o[3] * t.s * (0.9 + rnd() * 0.25);
      m.compose(pos.set(t.x + o[0] * t.s, o[1] * t.s, t.z + o[2] * t.s), q, scl.set(r, r, r));
      puffs.setMatrixAt(i * 4 + j, m);
      color.setScalar(jitter * (0.92 + rnd() * 0.16));
      color.g *= 1.06;
      puffs.setColorAt(i * 4 + j, color);
    });
  });
  puffs.frustumCulled = false;
  puffs.castShadow = true;
  group.add(puffs);

  // Boulder outcrops covering each wall blob's blocked footprint, plus a
  // scatter of small river rocks.
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: ROCK_COLOR, flatShading: true });
  const rockSpots: { x: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (const w of map.walls) {
    rockSpots.push({ x: w.x, z: w.z, sx: w.r * 0.78, sy: w.r * 0.5, sz: w.r * 0.78 });
    const count = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const d = w.r * (0.4 + rnd() * 0.35);
      const s = w.r * (0.28 + rnd() * 0.18);
      rockSpots.push({
        x: w.x + Math.cos(a) * d,
        z: w.z + Math.sin(a) * d,
        sx: s,
        sy: s * (0.7 + rnd() * 0.5),
        sz: s,
      });
    }
  }
  // River stones, along the WHOLE band the map record declares rather than
  // the middle of it: the scatter used to be nine boulders hard-coded around
  // the map center, sized for a river that only spanned mid, and they stayed
  // sitting there once the water ran corner to corner. They are also small
  // and low on purpose. Every cell of the river is walkable by construction,
  // so anything champion-sized standing in it reads as cover you can hide
  // behind and then walk straight through. These are pebbles: half sunk,
  // well inside the clear band, never mistakable for terrain.
  const river = map.river;
  const riverLen = Math.hypot(river.b.x - river.a.x, river.b.z - river.a.z);
  const dirX = (river.b.x - river.a.x) / riverLen;
  const dirZ = (river.b.z - river.a.z) / riverLen;
  const stoneCount = Math.round(riverLen / 6);
  for (let i = 0; i < stoneCount; i++) {
    const along = ((i + 0.5) / stoneCount) * riverLen + (rnd() - 0.5) * 3;
    const side = i % 2 === 0 ? 1 : -1;
    const off = side * river.width * (0.12 + rnd() * 0.33);
    // Capped under a champion's own 0.6 radius, with margin: pinned by
    // tests/river.test.ts.
    const s = 0.26 + rnd() * 0.26;
    rockSpots.push({
      x: river.a.x + dirX * along - dirZ * off,
      z: river.a.z + dirZ * along + dirX * off,
      sx: s,
      sy: s * 0.45,
      sz: s,
    });
  }
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
  rockSpots.forEach((r, i) => {
    q.setFromAxisAngle(
      new THREE.Vector3(rnd() - 0.5, 1, rnd() - 0.5).normalize(),
      rnd() * Math.PI * 2,
    );
    m.compose(pos.set(r.x, r.sy * 0.35, r.z), q, scl.set(r.sx, r.sy, r.sz));
    rocks.setMatrixAt(i, m);
    const mossy = rnd() < 0.4;
    color.setScalar(0.8 + rnd() * 0.25);
    if (mossy) {
      color.r *= 0.85;
      color.b *= 0.8;
    }
    rocks.setColorAt(i, color);
  });
  rocks.frustumCulled = false;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);

  return { group, uTime };
}
