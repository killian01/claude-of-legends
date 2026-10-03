// The planet drawn by the piece (docs/plan-royale.md step 8): the whole
// Wanderseed is about 800k triangles in some two hundred draws, and from the
// play camera only a cap of it, a few thousand square meters on the near
// side, is ever in view. At load the model is baked into one mesh per
// material (every instance of every prop that wears it, the terrain's face,
// the water), its triangles sorted along the cube-sphere's gnomonic grid
// into tiles. Every frame each tile is tested against the horizon and the
// camera's frustum, and when the set of tiles in view changes each batch's
// index is rebuilt from those tiles alone: a few dozen draws for the whole
// planet, a material with nothing in view not drawn at all, and no
// extension needed (a multi-draw batch falls back to a draw per object on
// a browser without one).

import * as THREE from 'three';
import type { Vec3 } from '../sim/geo';
import { FACES, faceDir, faceOf, faceUV } from './planet_ground';

// Tiles along each face edge: 12 gives tiles of about 13 m at a face's
// middle, 864 over the planet.
export const TILE_K = 12;
// The tallest a tile counts as standing for the horizon: a tree's tip past
// the horizon pokes over its line by a sliver at the top of the screen,
// not worth drawing a whole tile of ground for.
export const HORIZON_TOP_M = 3;
// The small things (grass, flowers, pebbles, undergrowth): none bigger
// than this across, drawn only this near the focus, where they read.
export const DETAIL_SIZE_M = 1.3;
export const DETAIL_REACH_M = 38;

// The tile a direction falls in: face * k * k + j * k + i on the face's
// gnomonic grid (planet_ground.ts).
export function tileOf(d: Vec3, k = TILE_K): number {
  const f = faceOf(d);
  const { u, v } = faceUV(f, d);
  const i = Math.max(0, Math.min(k - 1, Math.floor(((u + 1) * k) / 2)));
  const j = Math.max(0, Math.min(k - 1, Math.floor(((v + 1) * k) / 2)));
  return f * k * k + j * k + i;
}

export interface TileBounds {
  // The unit direction of the tile's middle.
  dir: Vec3;
  // The angle from the middle to the farthest thing given to the tile.
  angle: number;
  // How far above the sphere its tallest thing reaches, meters.
  top: number;
}

function angleBetween(a: Vec3, b: Vec3): number {
  const cx = a.y * b.z - a.z * b.y;
  const cy = a.z * b.x - a.x * b.z;
  const cz = a.x * b.y - a.y * b.x;
  return Math.atan2(Math.hypot(cx, cy, cz), a.x * b.x + a.y * b.y + a.z * b.z);
}

// Every tile's middle and reach on the sphere, nothing on it yet.
export function tileGrid(k = TILE_K): TileBounds[] {
  const out: TileBounds[] = [];
  for (let f = 0; f < FACES.length; f++) {
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) {
        const u0 = (i / k) * 2 - 1;
        const u1 = ((i + 1) / k) * 2 - 1;
        const v0 = (j / k) * 2 - 1;
        const v1 = ((j + 1) / k) * 2 - 1;
        const dir = faceDir(f, (u0 + u1) / 2, (v0 + v1) / 2);
        let angle = 0;
        for (const [u, v] of [
          [u0, v0],
          [u1, v0],
          [u0, v1],
          [u1, v1],
        ] as const) {
          angle = Math.max(angle, angleBetween(dir, faceDir(f, u, v)));
        }
        out.push({ dir, angle, top: 0 });
      }
    }
  }
  return out;
}

// Whether anything of a tile can show over the horizon from an eye at
// `eye` (sphere coordinates, outside the sphere of `radius`): the ground
// is seen out to acos(R / d) from the eye's own direction, and a thing
// standing h tall a further acos(R / (R + h)) past that.
export function overHorizon(tile: TileBounds, eye: Vec3, radius: number, margin = 0.02): boolean {
  const d = Math.hypot(eye.x, eye.y, eye.z);
  if (d <= radius) return true;
  const dir = { x: eye.x / d, y: eye.y / d, z: eye.z / d };
  const ground = Math.acos(radius / d);
  const tall = Math.acos(radius / (radius + Math.min(HORIZON_TOP_M, Math.max(0, tile.top))));
  return angleBetween(dir, tile.dir) - tile.angle <= ground + tall + margin;
}

// One material's share of the whole model, every instance baked in and
// its triangles sorted by tile, drawn through an index rebuilt from the
// tiles in view.
export interface PlanetBatch {
  mesh: THREE.Mesh;
  // A batch of small things, drawn near the focus only.
  detail: boolean;
  sorted: Uint32Array;
  runs: { tile: number; start: number; count: number }[];
  index: THREE.BufferAttribute;
}

interface Source {
  mesh: THREE.Mesh;
  // Into the model's space, one per instance (one for a plain mesh).
  matrices: THREE.Matrix4[];
  // A small thing, drawn near the focus only.
  detail: boolean;
}

function signatureDetail(sources: readonly Source[]): boolean {
  return sources.every((s) => s.detail);
}

const V = new THREE.Vector3();
const N = new THREE.Vector3();
const C = new THREE.Vector3();
const NM = new THREE.Matrix3();
const PM = new THREE.Matrix4();

// The attributes baked: what a lit, textured, maybe vertex-colored
// material reads. A tangent is left out (three derives one when needed).
const BAKED = ['position', 'normal', 'uv', 'uv1', 'color'] as const;

// How big the biggest of a mesh's copies is, meters across.
function sizeOf(mesh: THREE.Mesh, matrices: readonly THREE.Matrix4[]): number {
  mesh.geometry.computeBoundingSphere();
  const r = mesh.geometry.boundingSphere?.radius ?? 0;
  let size = 0;
  for (const m of matrices) size = Math.max(size, 2 * r * m.getMaxScaleOnAxis());
  return size;
}

function signature(mesh: THREE.Mesh, detail: boolean): string {
  const geo = mesh.geometry;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const kind = mesh.userData.ground === true ? 'ground' : detail ? 'detail' : 'prop';
  const parts = [mat?.uuid ?? 'none', kind];
  for (const name of BAKED) {
    const a = geo.getAttribute(name);
    if (a) parts.push(`${name}${a.itemSize}`);
  }
  return parts.join('|');
}

// A tile's sphere in world space, for the frustum, padded so a caster just
// off screen still throws its shadow in.
function worldSphere(
  b: TileBounds,
  radius: number,
  world: THREE.Matrix4,
  pad: number,
  out: THREE.Sphere,
): THREE.Sphere {
  const r = radius + b.top / 2;
  out.center.set(b.dir.x * r, b.dir.y * r, b.dir.z * r).applyMatrix4(world);
  out.radius = radius * b.angle + b.top + pad;
  return out;
}

export class PlanetCuller {
  readonly tiles: TileBounds[];
  readonly batches: PlanetBatch[] = [];
  private shown: Uint8Array;
  private near: Uint8Array;
  private readonly frustum = new THREE.Frustum();
  private readonly inverse = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private first = true;

  constructor(
    model: THREE.Object3D,
    private readonly radius: number,
    private readonly k = TILE_K,
  ) {
    this.tiles = tileGrid(k);
    this.shown = new Uint8Array(this.tiles.length);
    this.near = new Uint8Array(this.tiles.length);
    model.updateMatrixWorld(true);
    const toModel = model.matrixWorld.clone().invert();
    const groups = new Map<string, Source[]>();
    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (
        m.isMesh &&
        !(m as THREE.SkinnedMesh).isSkinnedMesh &&
        m.geometry.getAttribute('position')
      ) {
        meshes.push(m);
      }
    });
    for (const mesh of meshes) {
      const rel = new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld);
      const inst = mesh as THREE.InstancedMesh;
      const matrices: THREE.Matrix4[] = [];
      if (inst.isInstancedMesh) {
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, PM);
          matrices.push(new THREE.Matrix4().multiplyMatrices(rel, PM));
        }
      } else matrices.push(rel);
      const size = sizeOf(mesh, matrices);
      // The caches' plinths and the pads stay at any distance: the
      // renderer's chests and glows stand on them.
      const anchor = /cache|pad/i.test(mesh.name) || /cache|pad/i.test(mesh.parent?.name ?? '');
      const detail = mesh.userData.ground !== true && !anchor && size < DETAIL_SIZE_M;
      const key = signature(mesh, detail);
      const list = groups.get(key) ?? [];
      list.push({ mesh, matrices, detail });
      groups.set(key, list);
    }
    for (const sources of groups.values()) {
      const batch = this.bake(sources);
      if (batch) this.batches.push(batch);
    }
    for (const mesh of meshes) mesh.removeFromParent();
    for (const b of this.batches) model.add(b.mesh);
  }

  private bake(sources: Source[]): PlanetBatch | null {
    const first = sources[0]!.mesh;
    const names = BAKED.filter((n) => first.geometry.getAttribute(n));
    let vertices = 0;
    let indices = 0;
    for (const s of sources) {
      const geo = s.mesh.geometry;
      const n = geo.getAttribute('position').count;
      const idx = geo.index ? geo.index.count : n;
      vertices += n * s.matrices.length;
      indices += idx * s.matrices.length;
    }
    if (indices === 0) return null;
    const arrays = new Map<string, Float32Array>();
    for (const name of names) {
      arrays.set(name, new Float32Array(vertices * first.geometry.getAttribute(name).itemSize));
    }
    const raw = new Uint32Array(indices);
    let vBase = 0;
    let iAt = 0;
    const outP = arrays.get('position')!;
    const outN = arrays.get('normal');
    for (const s of sources) {
      const geo = s.mesh.geometry;
      const pos = geo.getAttribute('position');
      const nrm = geo.getAttribute('normal');
      const n = pos.count;
      for (const m of s.matrices) {
        NM.getNormalMatrix(m);
        for (let i = 0; i < n; i++) {
          V.fromBufferAttribute(pos, i).applyMatrix4(m);
          outP[(vBase + i) * 3] = V.x;
          outP[(vBase + i) * 3 + 1] = V.y;
          outP[(vBase + i) * 3 + 2] = V.z;
        }
        if (outN && nrm) {
          for (let i = 0; i < n; i++) {
            N.fromBufferAttribute(nrm, i).applyMatrix3(NM).normalize();
            outN[(vBase + i) * 3] = N.x;
            outN[(vBase + i) * 3 + 1] = N.y;
            outN[(vBase + i) * 3 + 2] = N.z;
          }
        }
        for (const name of names) {
          if (name === 'position' || name === 'normal') continue;
          const a = geo.getAttribute(name);
          const out = arrays.get(name);
          if (!a || !out) continue;
          const size = a.itemSize;
          for (let i = 0; i < n; i++) {
            const o = (vBase + i) * size;
            out[o] = a.getX(i);
            if (size > 1) out[o + 1] = a.getY(i);
            if (size > 2) out[o + 2] = a.getZ(i);
            if (size > 3) out[o + 3] = a.getW(i);
          }
        }
        if (geo.index) {
          for (let i = 0; i < geo.index.count; i++) raw[iAt++] = vBase + geo.index.getX(i);
        } else {
          for (let i = 0; i < n; i++) raw[iAt++] = vBase + i;
        }
        vBase += n;
      }
    }
    // Each triangle to the tile of its middle; each tile's reach and top
    // grown to hold every vertex given to it.
    const tris = indices / 3;
    const tileOfTri = new Int32Array(tris);
    const counts = new Map<number, number>();
    for (let t = 0; t < tris; t++) {
      C.set(0, 0, 0);
      for (let c = 0; c < 3; c++) {
        const v = raw[t * 3 + c]! * 3;
        C.x += outP[v]!;
        C.y += outP[v + 1]!;
        C.z += outP[v + 2]!;
      }
      const r = C.length();
      const tile = r > 0 ? tileOf({ x: C.x / r, y: C.y / r, z: C.z / r }, this.k) : 0;
      tileOfTri[t] = tile;
      counts.set(tile, (counts.get(tile) ?? 0) + 1);
      const b = this.tiles[tile]!;
      for (let c = 0; c < 3; c++) {
        const v = raw[t * 3 + c]! * 3;
        V.set(outP[v]!, outP[v + 1]!, outP[v + 2]!);
        const len = V.length();
        if (len <= 0) continue;
        b.top = Math.max(b.top, len - this.radius);
        V.divideScalar(len);
        b.angle = Math.max(b.angle, angleBetween(b.dir, { x: V.x, y: V.y, z: V.z }));
      }
    }
    const runs: PlanetBatch['runs'] = [];
    const runOf = new Map<number, { tile: number; start: number; count: number }>();
    let at = 0;
    for (const tile of [...counts.keys()].sort((a, b) => a - b)) {
      const run = { tile, start: at, count: 0 };
      runs.push(run);
      runOf.set(tile, run);
      at += counts.get(tile)!;
    }
    const sorted = new Uint32Array(indices);
    for (let t = 0; t < tris; t++) {
      const run = runOf.get(tileOfTri[t]!)!;
      const o = (run.start + run.count) * 3;
      sorted[o] = raw[t * 3]!;
      sorted[o + 1] = raw[t * 3 + 1]!;
      sorted[o + 2] = raw[t * 3 + 2]!;
      run.count++;
    }
    const geo = new THREE.BufferGeometry();
    for (const name of names) {
      const size = first.geometry.getAttribute(name).itemSize;
      geo.setAttribute(name, new THREE.BufferAttribute(arrays.get(name)!, size));
    }
    const index = new THREE.BufferAttribute(new Uint32Array(indices), 1);
    index.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(index);
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, first.material);
    mesh.name = `tiles:${first.name}`;
    mesh.castShadow = sources.some((s) => s.mesh.castShadow);
    mesh.receiveShadow = sources.some((s) => s.mesh.receiveShadow);
    mesh.userData.ground = first.userData.ground === true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return { mesh, detail: signatureDetail(sources), sorted, runs, index };
  }

  // How many tiles are drawn now, of how many.
  get shownTiles(): number {
    let n = 0;
    for (const s of this.shown) n += s;
    return n;
  }

  // Per frame, the camera placed: the tiles in view, and the batches
  // rebuilt when they changed. `world` is the planet's world matrix,
  // `focus` the direction (sphere coordinates) the camera looks at.
  update(camera: THREE.Camera, world: THREE.Matrix4, focus: Vec3): void {
    this.inverse.copy(world).invert();
    const eyeV = camera.getWorldPosition(V).applyMatrix4(this.inverse);
    const eye = { x: eyeV.x, y: eyeV.y, z: eyeV.z };
    PM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(PM);
    const next = new Uint8Array(this.tiles.length);
    const nearNext = new Uint8Array(this.tiles.length);
    const reach = DETAIL_REACH_M / this.radius;
    let changed = this.first;
    for (const [i, t] of this.tiles.entries()) {
      const show =
        overHorizon(t, eye, this.radius) &&
        this.frustum.intersectsSphere(worldSphere(t, this.radius, world, 3, this.sphere));
      next[i] = show ? 1 : 0;
      nearNext[i] = show && angleBetween(focus, t.dir) - t.angle <= reach ? 1 : 0;
      if (next[i] !== this.shown[i] || nearNext[i] !== this.near[i]) changed = true;
    }
    if (!changed) return;
    this.first = false;
    this.shown = next;
    this.near = nearNext;
    for (const b of this.batches) {
      const out = b.index.array as Uint32Array;
      const mask = b.detail ? this.near : this.shown;
      let n = 0;
      for (const run of b.runs) {
        if (!mask[run.tile]) continue;
        out.set(b.sorted.subarray(run.start * 3, (run.start + run.count) * 3), n);
        n += run.count * 3;
      }
      b.mesh.geometry.setDrawRange(0, n);
      b.mesh.visible = n > 0;
      b.index.clearUpdateRanges();
      b.index.addUpdateRange(0, Math.max(1, n));
      b.index.needsUpdate = true;
    }
  }
}
