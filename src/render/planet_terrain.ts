// The Wanderseed as a terrain (ADR 0031, docs/planet.md): the model drawn
// on the sphere, the height of its ground and the layout's places, behind
// the renderer's one terrain seam. A terrain carrying `planet` is the
// renderer's planet mode switch (planet_stage.ts): the host of a battle
// royale loads this instead of the Star Orchard and hands it over the same
// way. The shipped export lives in public/map/planet/ (planet.glb, its
// light twin for phones, layout.json, navigation.bin); without it a
// procedural stand-in is built, the six regions colored on a cube-sphere.

import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '../sim/geo';
import {
  cubeCorners,
  FACES,
  faceDir,
  faceOf,
  PLANET_RADIUS,
  PlanetHeights,
  type PlanetLayout,
  parseLayout,
} from './planet_ground';
import { duskTree } from './planet_dusk';
import type { RenderTerrain } from './terrain';

export interface PlanetGround {
  readonly radius: number;
  // The planet drawn on the sphere, in sphere coordinates: the renderer
  // turns it under its chart and never bends it.
  readonly model: THREE.Group;
  readonly layout: PlanetLayout;
  // True for the procedural stand-in.
  readonly placeholder: boolean;
  // Meters above the sim sphere at a sphere point.
  heightAt(p: Vec3): number;
  // Whether nothing can stand there (water, rock, a trunk), when known.
  blocked(p: Vec3): boolean;
  // The region a sphere point lies in, the face index (planet_ground.ts).
  regionAt(p: Vec3): number;
  // A region's color for the minimap, as CSS.
  regionColor(region: number): string;
}

// The regions' ground colors, the generator's own debug palette
// (scripts/planet/output.mjs), by face.
const REGION_RGB: readonly [number, number, number][] = [
  [196, 178, 140],
  [92, 132, 82],
  [214, 206, 170],
  [196, 172, 104],
  [128, 176, 110],
  [138, 150, 160],
];
const REGION_CSS = REGION_RGB.map(([r, g, b]) => `rgb(${r},${g},${b})`);

const WATER_LEVEL = -0.4;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// How much of each region a direction holds: one near a face's middle,
// blended over a few meters at the cube's edges.
function regionWeights(d: Vec3): number[] {
  const w = FACES.map((F) => Math.exp(24 * (dot(d, F.N) - 1)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

// The stand-in's relief: a gentle roll per region, a few lakes in the
// Lakes, a plateau or two in the Cliffs. Smooth, deterministic, cheap.
const RELIEF = [0.6, 1.1, 0.45, 1.4, 0.8, 1.6];
const LAKES: readonly Vec3[] = [
  { x: 0.18, y: 0.1, z: 0.98 },
  { x: -0.35, y: -0.22, z: 0.91 },
  { x: 0.42, y: -0.38, z: 0.82 },
];
function unit(v: Vec3): Vec3 {
  const d = Math.sqrt(dot(v, v));
  return { x: v.x / d, y: v.y / d, z: v.z / d };
}
const LAKE_DIRS = LAKES.map(unit);

function standInHeight(d: Vec3): number {
  const w = regionWeights(d);
  const roll =
    Math.sin(d.x * 9.1 + d.y * 3.7) * Math.cos(d.z * 7.3 - d.x * 2.1) * 0.6 +
    Math.sin(d.y * 17.3 + d.z * 11.9) * 0.25 +
    Math.cos(d.x * 23.1 - d.z * 19.7 + d.y * 5.3) * 0.15;
  let h = 0;
  for (let f = 0; f < 6; f++) h += w[f]! * RELIEF[f]! * roll;
  for (const lake of LAKE_DIRS) {
    const a = Math.acos(Math.min(1, dot(d, lake))) * PLANET_RADIUS;
    h -= 2.6 * Math.exp(-(a * a) / (2 * 7 * 7));
  }
  // The poles stay level: the spire and the monolith stand there.
  const pole = Math.abs(d.y);
  if (pole > 0.95) h *= (1 - pole) / 0.05;
  return h;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random direction inside a face, away from its edges.
function inFace(f: number, rand: () => number, reach = 0.9): Vec3 {
  return faceDir(f, (rand() * 2 - 1) * reach, (rand() * 2 - 1) * reach);
}

// A tangent frame at a direction: the normal and a turn about it.
function standing(dir: Vec3, lift: number, turn: number): THREE.Matrix4 {
  const up = new THREE.Vector3(dir.x, dir.y, dir.z);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
  const r = PLANET_RADIUS + standInHeight(dir) + lift;
  return new THREE.Matrix4().compose(up.clone().multiplyScalar(r), q, new THREE.Vector3(1, 1, 1));
}

function scatter(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  spots: { dir: Vec3; lift: number; turn: number; scale: number }[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  const m = new THREE.Matrix4();
  for (const [i, s] of spots.entries()) {
    m.copy(standing(s.dir, s.lift, s.turn));
    m.multiply(new THREE.Matrix4().makeScale(s.scale, s.scale, s.scale));
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// The stand-in's ground: a cube-sphere, each face a grid, lifted by the
// relief and colored by region with a little noise.
function standInGround(segments: number): THREE.Mesh {
  const verts = (segments + 1) * (segments + 1);
  const positions = new Float32Array(6 * verts * 3);
  const colors = new Float32Array(6 * verts * 3);
  const indices: number[] = [];
  const rand = seeded(7);
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        const u = (i / segments) * 2 - 1;
        const v = (j / segments) * 2 - 1;
        const d = faceDir(f, u, v);
        const h = standInHeight(d);
        const r = PLANET_RADIUS + h;
        const k = (f * verts + j * (segments + 1) + i) * 3;
        positions[k] = d.x * r;
        positions[k + 1] = d.y * r;
        positions[k + 2] = d.z * r;
        const w = regionWeights(d);
        let cr = 0;
        let cg = 0;
        let cb = 0;
        for (let g = 0; g < 6; g++) {
          const [rr, gg, bb] = REGION_RGB[g]!;
          cr += (w[g]! * rr) / 255;
          cg += (w[g]! * gg) / 255;
          cb += (w[g]! * bb) / 255;
        }
        const shade = 0.9 + 0.1 * Math.sin(d.x * 41 + d.y * 37 + d.z * 29) + (rand() - 0.5) * 0.06;
        // Lake shores darken and the beds turn to sand under the water.
        const wet = h < WATER_LEVEL + 0.3 ? 0.75 : 1;
        colors[k] = cr * shade * wet;
        colors[k + 1] = cg * shade * wet;
        colors[k + 2] = cb * shade * wet;
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = f * verts + j * (segments + 1) + i;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        // U x V = N: counter-clockwise seen from outside.
        indices.push(a, b, d, a, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

// The stand-in planet: the ground, the lakes' water, and enough of each
// region's furniture to read where one is (cypresses, ruined columns,
// rocks, the Sanctuary's spire and the Open ground's monolith).
export function standInModel(segments = 72): THREE.Group {
  const root = new THREE.Group();
  root.name = 'planet-stand-in';
  root.add(standInGround(segments));
  const water = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS + WATER_LEVEL, 96, 64),
    new THREE.MeshLambertMaterial({ color: 0x3f86b0, transparent: true, opacity: 0.88 }),
  );
  water.name = 'water';
  root.add(water);
  const rand = seeded(11);
  const pick = (f: number, count: number, reach = 0.85) =>
    Array.from({ length: count }, () => ({
      dir: inFace(f, rand, reach),
      lift: 0,
      turn: rand() * Math.PI * 2,
      scale: 0.75 + rand() * 0.6,
    })).filter((s) => standInHeight(s.dir) > WATER_LEVEL + 0.2);
  const cypress = new THREE.ConeGeometry(0.75, 5.2, 7);
  cypress.translate(0, 2.6, 0);
  root.add(scatter(cypress, new THREE.MeshLambertMaterial({ color: 0x2d5a34 }), pick(1, 380)));
  const trees = new THREE.IcosahedronGeometry(1.4, 0);
  trees.translate(0, 2.2, 0);
  const lush = [...pick(4, 90), ...pick(3, 40)];
  root.add(scatter(trees, new THREE.MeshLambertMaterial({ color: 0x4f8a3e, flatShading: true }), lush));
  const column = new THREE.CylinderGeometry(0.45, 0.55, 3.4, 8);
  column.translate(0, 1.7, 0);
  root.add(scatter(column, new THREE.MeshLambertMaterial({ color: 0xd9ceb0 }), pick(0, 140)));
  const rock = new THREE.IcosahedronGeometry(1.2, 0);
  rock.translate(0, 0.5, 0);
  root.add(
    scatter(
      rock,
      new THREE.MeshLambertMaterial({ color: 0x8a8f96, flatShading: true }),
      [...pick(5, 220), ...pick(3, 30)],
    ),
  );
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 18, 6),
    new THREE.MeshLambertMaterial({ color: 0xf2ecd8, emissive: 0x3a3320 }),
  );
  spire.position.set(0, PLANET_RADIUS + 9, 0);
  root.add(spire);
  const monolith = new THREE.Mesh(
    new THREE.BoxGeometry(3, 12, 3),
    new THREE.MeshLambertMaterial({ color: 0x4a4650 }),
  );
  monolith.position.set(0, -(PLANET_RADIUS + 6), 0);
  root.add(monolith);
  for (const o of [spire, monolith]) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
  return root;
}

// The stand-in's layout: a crossroads at every cube corner, a pad at each
// throwing 50 m toward the next region's heart, caches over every face.
export function standInLayout(): PlanetLayout {
  const crossroads = cubeCorners();
  const pads = crossroads.map((c) => {
    const d = unit(c);
    // Toward the nearest face center, 50 m along the great circle.
    const f = faceOf({ x: d.x * 1.001, y: d.y, z: d.z });
    const toward = FACES[f]!.N;
    const k = dot(toward, d);
    const t = unit({ x: toward.x - k * d.x, y: toward.y - k * d.y, z: toward.z - k * d.z });
    const a = 50 / PLANET_RADIUS;
    const at = { x: d.x * PLANET_RADIUS, y: d.y * PLANET_RADIUS, z: d.z * PLANET_RADIUS };
    const to = {
      x: (d.x * Math.cos(a) + t.x * Math.sin(a)) * PLANET_RADIUS,
      y: (d.y * Math.cos(a) + t.y * Math.sin(a)) * PLANET_RADIUS,
      z: (d.z * Math.cos(a) + t.z * Math.sin(a)) * PLANET_RADIUS,
    };
    return { at, to };
  });
  const rand = seeded(23);
  const caches: PlanetLayout['caches'] = [];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 26; i++) {
      const d = inFace(f, rand, 0.95);
      if (standInHeight(d) < WATER_LEVEL + 0.2) continue;
      caches.push({
        at: { x: d.x * PLANET_RADIUS, y: d.y * PLANET_RADIUS, z: d.z * PLANET_RADIUS },
        golden: i < 2,
      });
    }
  }
  return { radius: PLANET_RADIUS, crossroads, pads, caches, bushes: [], blockers: [] };
}

// The stand-in drawn from the shipped grid while the model is not there
// (docs/planet.md: the model ships apart from the layout): the ground of
// navigation.bin itself, each region's color, the blocked cells as water
// where the ground around them dips and as rock where it does not, the
// sight blockers as trees, columns or boulders by region, the bushes.
export function gridModel(heights: PlanetHeights, layout: PlanetLayout, segments = 120): THREE.Group {
  const root = new THREE.Group();
  root.name = 'planet-grid-stand-in';
  const verts = (segments + 1) * (segments + 1);
  const positions = new Float32Array(6 * verts * 3);
  const colors = new Float32Array(6 * verts * 3);
  const indices: number[] = [];
  const water: [number, number, number] = [0.16, 0.32, 0.36];
  const rock: [number, number, number] = [0.36, 0.34, 0.33];
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        const d = faceDir(f, (i / segments) * 2 - 1, (j / segments) * 2 - 1);
        const p = { x: d.x * PLANET_RADIUS, y: d.y * PLANET_RADIUS, z: d.z * PLANET_RADIUS };
        let h = heights.heightAt(p);
        const w = regionWeights(d);
        let c: [number, number, number] = [0, 0, 0];
        for (let g = 0; g < 6; g++) {
          const rgb = REGION_RGB[g]!;
          c = [c[0] + (w[g]! * rgb[0]) / 255, c[1] + (w[g]! * rgb[1]) / 255, c[2] + (w[g]! * rgb[2]) / 255];
        }
        const shade = 0.88 + 0.12 * Math.sin(d.x * 41 + d.y * 37 + d.z * 29) + h * 0.05;
        c = [c[0] * shade, c[1] * shade, c[2] * shade];
        if (heights.blocked(p)) {
          if (h < 0.1) {
            h = -1.4;
            c = water;
          } else {
            h += 1.1;
            c = rock;
          }
        }
        const k = (f * verts + j * (segments + 1) + i) * 3;
        const r = PLANET_RADIUS + h;
        positions[k] = d.x * r;
        positions[k + 1] = d.y * r;
        positions[k + 2] = d.z * r;
        colors[k] = c[0];
        colors[k + 1] = c[1];
        colors[k + 2] = c[2];
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = f * verts + j * (segments + 1) + i;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.name = 'ground';
  ground.receiveShadow = true;
  root.add(ground);
  const sea = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS + WATER_LEVEL, 128, 96),
    new THREE.MeshLambertMaterial({ color: 0x3f86b0, transparent: true, opacity: 0.86 }),
  );
  sea.name = 'water';
  root.add(sea);
  // Tall solid things by region: cypresses in the groves, columns in the
  // Ruins, boulders on the Cliffs and the Open ground, round trees else.
  const rand = seeded(31);
  const kinds: { dir: Vec3; lift: number; turn: number; scale: number }[][] = [[], [], [], []];
  for (const s of layout.blockers) {
    const d = unit(s.at);
    const f = faceOf(d);
    const kind = f === 1 ? 0 : f === 0 ? 1 : f === 5 || f === 3 ? 2 : 3;
    kinds[kind]!.push({ dir: d, lift: 0, turn: rand() * Math.PI * 2, scale: Math.max(0.5, s.r * 0.75) });
  }
  const at = (dir: Vec3, lift: number, turn: number, scale: number): THREE.Matrix4 => {
    const up = new THREE.Vector3(dir.x, dir.y, dir.z);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
    const r = PLANET_RADIUS + heights.heightAt({ x: dir.x * 80, y: dir.y * 80, z: dir.z * 80 }) + lift;
    return new THREE.Matrix4().compose(up.multiplyScalar(r), q, new THREE.Vector3(scale, scale, scale));
  };
  const shapes: [THREE.BufferGeometry, number][] = [
    [new THREE.ConeGeometry(0.8, 4.6, 7).translate(0, 2.3, 0), 0x2d5a34],
    [new THREE.CylinderGeometry(0.5, 0.6, 3.2, 8).translate(0, 1.6, 0), 0xd9ceb0],
    [new THREE.IcosahedronGeometry(1, 0).translate(0, 0.45, 0), 0x8a8f96],
    [new THREE.IcosahedronGeometry(1.2, 0).translate(0, 2, 0), 0x4f8a3e],
  ];
  for (const [k, list] of kinds.entries()) {
    if (list.length === 0) continue;
    const [geo, color] = shapes[k]!;
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color, flatShading: k >= 2 }),
      list.length,
    );
    for (const [i, s] of list.entries()) mesh.setMatrixAt(i, at(s.dir, s.lift, s.turn, s.scale));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (layout.bushes.length > 0) {
    const bush = new THREE.IcosahedronGeometry(1, 1);
    bush.scale(1, 0.55, 1);
    const mesh = new THREE.InstancedMesh(
      bush,
      new THREE.MeshLambertMaterial({ color: 0x3e7a3a, flatShading: true }),
      layout.bushes.length,
    );
    for (const [i, b] of layout.bushes.entries()) {
      mesh.setMatrixAt(i, at(unit(b.at), 0.2, rand() * 6, b.r));
    }
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

function groundOf(
  model: THREE.Group,
  layout: PlanetLayout,
  heightAt: (p: Vec3) => number,
  placeholder: boolean,
  blocked: (p: Vec3) => boolean = () => false,
): PlanetGround {
  duskTree(model);
  return {
    radius: PLANET_RADIUS,
    model,
    layout,
    placeholder,
    heightAt,
    blocked,
    regionAt: (p) => faceOf(p),
    regionColor: (r) => REGION_CSS[r] ?? '#666',
  };
}

// The stand-in as a planet ground.
export function standInGroundPlanet(): PlanetGround {
  return groundOf(
    standInModel(),
    standInLayout(),
    (p) => standInHeight(unit(p)),
    true,
  );
}

// A planet ground as the renderer's terrain. Its own heightAt is never
// called: on the planet the renderer reads heights through its chart.
export function planetTerrain(planet: PlanetGround): RenderTerrain {
  const minimap = document.createElement('canvas');
  minimap.width = 168;
  minimap.height = 168;
  return {
    root: new THREE.Group(),
    minimap,
    planet,
    heightAt: () => 0,
    structure: () => null,
    dispose: () => {
      planet.model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      });
    },
  };
}

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    // The dev server answers a missing file with the page itself.
    if (type.includes('text/html')) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

// Loads the shipped Wanderseed from `base`, or builds the stand-in when
// the export is not there: the light model on a phone (`light`).
export async function loadPlanetGround(
  base = '/map/planet/',
  opts: { light?: boolean } = {},
): Promise<PlanetGround> {
  const [layoutBytes, navBytes] = await Promise.all([
    fetchBytes(`${base}layout.json`),
    fetchBytes(`${base}navigation.bin`),
  ]);
  const modelBytes =
    (opts.light ? await fetchBytes(`${base}planet-light.glb`) : null) ??
    (await fetchBytes(`${base}planet.glb`));
  if (!layoutBytes || !navBytes) return standInGroundPlanet();
  try {
    const layout = parseLayout(JSON.parse(new TextDecoder().decode(layoutBytes)));
    const heights = new PlanetHeights(new Int16Array(navBytes));
    if (!modelBytes) {
      return groundOf(
        gridModel(heights, layout),
        layout,
        (p) => heights.heightAt(p),
        true,
        (p) => heights.blocked(p),
      );
    }
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const asset = await loader.parseAsync(modelBytes, '');
    const model = new THREE.Group();
    model.name = 'planet';
    model.add(asset.scene);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
    });
    return groundOf(
      model,
      layout,
      (p) => heights.heightAt(p),
      false,
      (p) => heights.blocked(p),
    );
  } catch (err) {
    console.warn('planet export unreadable, drawing the stand-in', err);
    return standInGroundPlanet();
  }
}
