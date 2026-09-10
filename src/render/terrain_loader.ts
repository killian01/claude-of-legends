// Loads an authored terrain model (the Star Orchard, docs/star-orchard.md)
// into the RenderTerrain the renderer draws instead of its procedural
// dressing: the static scenery batched by material, the painted towers kept
// apart so each one can take damage and fall, a minimap painted from the
// walkability grid, and the ground height every unit and effect is lifted
// by. Presentation only; the sim never sees any of it.

import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameMap } from '../sim/content/map';
import { STAR_ORCHARD_TOWERS } from '../sim/content/star_orchard';
import type { TerrainNavGrid } from '../sim/terrain_nav';
import type { TeamId } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { RenderTerrain } from './terrain';

// The export marks the attackable towers with this role in the node extras.
const TOWER_ROLE = 'defensive_tower';

const TEAM_RING_COLORS = [0x59bdff, 0xff7970];

// The export's astral Sanctum is modeled whole: a dais with a cup at its
// heart, a spike rising from the cup and four spikes leaning in over it,
// their tips 5.3 m above the ground. The renderer's own Sanctum, a plinth
// under a crystal, used to be drawn through it as a second object inside
// the first; a Sanctum unit now wears only the team ring around the dais,
// and its bar above the crown.
const SANCTUM_RING = { inner: 3.4, outer: 3.6 };
const SANCTUM_BAR_Y = 6;
const TOWER_RING = { inner: 2.15, outer: 2.35 };

// The bright ring under a team's structure, on the authored ground.
function teamRing(team: TeamId, size: { inner: number; outer: number }): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(size.inner, size.outer, 48),
    new THREE.MeshBasicMaterial({
      color: TEAM_RING_COLORS[team] ?? 0xffffff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  return ring;
}

function sanctumFigure(team: TeamId): { holder: THREE.Group; barY: number } {
  const holder = new THREE.Group();
  holder.userData.authoredTerrain = true;
  holder.add(teamRing(team, SANCTUM_RING));
  return { holder, barY: SANCTUM_BAR_Y };
}

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

// The shipped model is quantized (KHR_mesh_quantization under meshopt):
// positions and normals arrive as normalized integers that only make sense
// through their node's transform. A float copy, read through the
// attribute's own denormalization, is what a world-space merge can work
// on; writing transformed meters back into an int16 array is not.
function floatAttribute(attribute: Attribute, itemSize: number): THREE.Float32BufferAttribute {
  const out = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    out[i * itemSize] = attribute.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attribute.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attribute.getZ(i);
  }
  return new THREE.Float32BufferAttribute(out, itemSize);
}

// One mesh per material: 259 authored objects become a few dozen draw
// calls. Every geometry is flattened into world space first (the export
// nests nothing the renderer needs to keep), and only the attributes the
// materials read survive the merge: position, normal, the uv channel the
// color map reads, and a vertex color (white where the export has none).
function batchByMaterial(source: THREE.Group): THREE.Group {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  source.updateMatrixWorld(true);
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) throw new Error('multi-material terrain mesh');
    const material = object.material as THREE.MeshStandardMaterial;
    const src = object.geometry as THREE.BufferGeometry;
    const count = src.getAttribute('position').count;
    const flat = new THREE.BufferGeometry();
    if (src.index) flat.setIndex(src.index.clone());
    flat.setAttribute('position', floatAttribute(src.getAttribute('position'), 3));
    const normal = src.getAttribute('normal');
    if (normal) flat.setAttribute('normal', floatAttribute(normal, 3));
    const uv = src.getAttribute(material.map?.channel ? `uv${material.map.channel}` : 'uv');
    flat.setAttribute(
      'uv',
      uv ? floatAttribute(uv, 2) : new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2),
    );
    const color = src.getAttribute('color');
    flat.setAttribute(
      'color',
      color
        ? floatAttribute(color, 3)
        : new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3),
    );
    flat.applyMatrix4(object.matrixWorld);
    if (!normal) flat.computeVertexNormals();
    const geometry = flat.index ? flat.toNonIndexed() : flat;
    if (geometry !== flat) flat.dispose();
    const batch = batches.get(material) ?? [];
    batch.push(geometry);
    batches.set(material, batch);
  });
  const result = new THREE.Group();
  for (const [material, geometries] of batches) {
    const batched = material.clone();
    // The merged geometry carries its coordinates as uv channel 0.
    for (const [key, value] of Object.entries(batched)) {
      if (!(value instanceof THREE.Texture) || value.channel === 0) continue;
      const texture = value.clone();
      texture.channel = 0;
      Object.assign(batched, { [key]: texture });
    }
    const merged = mergeGeometries(geometries, false);
    if (!merged) throw new Error('terrain batch could not be merged');
    const mesh = new THREE.Mesh(merged, batched);
    mesh.receiveShadow = true;
    result.add(mesh);
    for (const geometry of geometries) geometry.dispose();
  }
  // The export is glTF Y-up with the sim's z negated.
  result.scale.z = -1;
  return result;
}

// The minimap background: walkable cells in two tones (stone above the
// forest floor, grass on it) over the void.
function paintMinimap(nav: TerrainNavGrid, map: GameMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('minimap canvas 2d context unavailable');
  g.fillStyle = '#102434';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / map.size;
  const cell = nav.cellSize * scale + 0.5;
  for (let cz = 0; cz < nav.cells; cz++) {
    for (let cx = 0; cx < nav.cells; cx++) {
      if (!nav.isWalkableCell(cx, cz)) continue;
      const p = nav.cellToWorld(cx, cz);
      g.fillStyle = nav.heightAt(p.x, p.z) > 1 ? '#b5aa92' : '#657753';
      g.fillRect(p.x * scale, (map.size - p.z) * scale, cell, cell);
    }
  }
  return canvas;
}

// Parses a downloaded model into the terrain of one match. The caller owns
// the bytes (they are cached across matches); the parsed scene, its
// geometries and textures belong to the returned terrain and go with its
// dispose().
export async function loadTerrain(
  model: ArrayBuffer,
  nav: TerrainNavGrid,
  map: GameMap,
): Promise<RenderTerrain> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const asset = await loader.parseAsync(model, '');
  const towers: THREE.Object3D[] = [];
  asset.scene.traverse((object) => {
    if (object.userData.role === TOWER_ROLE) towers.push(object);
  });
  if (towers.length !== STAR_ORCHARD_TOWERS) {
    throw new Error(`terrain model holds ${towers.length} towers, expected ${STAR_ORCHARD_TOWERS}`);
  }
  for (const tower of towers) {
    tower.removeFromParent();
    tower.traverse((object) => {
      if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
        object.material = object.material.clone();
      }
    });
  }
  const root = batchByMaterial(asset.scene);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const source of [asset.scene, root, ...towers]) {
    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
  }
  return {
    root,
    minimap: paintMinimap(nav, map),
    heightAt: (x, z) => nav.heightAt(x, z),
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      const bitmaps = new Set<ImageBitmap>();
      for (const texture of textures) {
        if (texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
        texture.dispose();
      }
      for (const bitmap of bitmaps) bitmap.close();
    },
    // A tower unit wears the painted tower standing at its spot, a Sanctum
    // is its authored dais already standing there; any other unit keeps the
    // renderer's own figure.
    structure: (unit: Readonly<Unit>) => {
      if (unit.kind === 'sanctum') return sanctumFigure(unit.team);
      if (unit.kind !== 'tower') return null;
      const tower = towers.find(
        (o) => Math.hypot(o.position.x - unit.pos.x, -o.position.z - unit.pos.z) < 0.05,
      );
      if (!tower) throw new Error(`no painted tower at ${unit.pos.x},${unit.pos.z}`);
      const holder = new THREE.Group();
      holder.userData.authoredTerrain = true;
      const reflected = new THREE.Group();
      reflected.scale.z = -1;
      reflected.position.set(-unit.pos.x, -nav.heightAt(unit.pos.x, unit.pos.z), -unit.pos.z);
      reflected.add(tower);
      holder.add(reflected, teamRing(unit.team, TOWER_RING));
      const bounds = new THREE.Box3().setFromObject(holder);
      return { holder, barY: bounds.max.y + 0.65 };
    },
  };
}
