// The planet drawn by the piece (src/render/planet_tiles.ts): the tiles of
// the cube-sphere grid, the horizon test, and the model baked into one
// batch per material whose index holds only the tiles in view.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { faceDir } from '../src/render/planet_ground';
import {
  DETAIL_REACH_M,
  overHorizon,
  PlanetCuller,
  TILE_K,
  tileGrid,
  tileOf,
} from '../src/render/planet_tiles';

const R = 80;

function at(d: { x: number; y: number; z: number }, h = 0): THREE.Vector3 {
  const n = Math.hypot(d.x, d.y, d.z);
  return new THREE.Vector3((d.x / n) * (R + h), (d.y / n) * (R + h), (d.z / n) * (R + h));
}

describe('the planet tiles', () => {
  it('cut every face into k by k tiles, each direction in exactly one', () => {
    const grid = tileGrid();
    expect(grid).toHaveLength(6 * TILE_K * TILE_K);
    for (const [i, t] of grid.entries()) expect(tileOf(t.dir)).toBe(i);
    // A tile's middle is within its reach of all its corners, about 20 m
    // at a face's middle.
    const middle = grid[2 * TILE_K * TILE_K + 3 * TILE_K + 3]!;
    expect(middle.angle * R).toBeGreaterThan(8);
    expect(middle.angle * R).toBeLessThan(20);
    expect(tileOf(faceDir(4, -0.99, 0.99))).toBe(4 * TILE_K * TILE_K + 7 * TILE_K);
  });

  it('see over the horizon what stands near, not what lies beyond', () => {
    const grid = tileGrid();
    const eye = at({ x: 0, y: 1, z: 0 }, 35);
    const below = grid[tileOf({ x: 0.05, y: 1, z: 0.02 })]!;
    const far = grid[tileOf({ x: 0, y: -1, z: 0.1 })]!;
    expect(overHorizon(below, eye, R)).toBe(true);
    expect(overHorizon(far, eye, R)).toBe(false);
    // Just past the ground's horizon, a tall thing still pokes over it.
    const past = grid[tileOf({ x: 1, y: 0.62, z: 0 })]!;
    const flat = { ...past, top: 0 };
    const tall = { ...past, top: 5 };
    expect(overHorizon(tall, eye, R)).toBe(true);
    expect(overHorizon(flat, eye, R, 0)).toBe(false);
  });
});

// A small planet: a ground sphere, a few hundred instanced trees and a few
// hundred instanced pebbles, all over.
function model(): THREE.Group {
  const root = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 64),
    new THREE.MeshLambertMaterial(),
  );
  ground.name = 'Terrain';
  ground.userData.ground = true;
  root.add(ground);
  const place = (geo: THREE.BufferGeometry, n: number, seed: number): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i + seed) * 2.399963;
      const y = 1 - (2 * (i + 0.5)) / n;
      const s = Math.sqrt(1 - y * y);
      const p = at({ x: s * Math.cos(a), y, z: s * Math.sin(a) });
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    return mesh;
  };
  const tree = place(new THREE.ConeGeometry(0.8, 5, 6).translate(0, 2.5, 0), 400, 0);
  tree.name = 'cypress';
  const pebble = place(new THREE.IcosahedronGeometry(0.2, 0), 300, 7);
  pebble.name = 'pebbles';
  root.add(tree, pebble);
  return root;
}

function cameraOver(d: { x: number; y: number; z: number }): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 500);
  const target = at(d);
  const up = target.clone().normalize();
  cam.position.copy(target).addScaledVector(up, 36);
  cam.up.set(1, 0, 0);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('the planet culler', () => {
  it('bakes the model into one batch per material, small things apart', () => {
    const root = model();
    const culler = new PlanetCuller(root, R);
    expect(culler.batches).toHaveLength(3);
    // The originals are gone, the batches stand in their place.
    expect(root.children.every((c) => c.name.startsWith('tiles:'))).toBe(true);
    const byName = new Map(culler.batches.map((b) => [b.mesh.name, b]));
    expect(byName.get('tiles:pebbles')?.detail).toBe(true);
    expect(byName.get('tiles:cypress')?.detail).toBe(false);
    expect(byName.get('tiles:Terrain')?.mesh.castShadow).toBe(false);
    expect(byName.get('tiles:cypress')?.mesh.castShadow).toBe(true);
    // Every triangle kept, sorted by tile.
    const cone = new THREE.ConeGeometry(0.8, 5, 6);
    expect(byName.get('tiles:cypress')!.sorted.length).toBe(cone.index!.count * 400);
  });

  it('draws only the tiles in view, the small things only near the focus', () => {
    const root = model();
    const culler = new PlanetCuller(root, R);
    const focus = { x: 0.2, y: 1, z: 0.1 };
    const n = Math.hypot(focus.x, focus.y, focus.z);
    const dir = { x: focus.x / n, y: focus.y / n, z: focus.z / n };
    culler.update(cameraOver(focus), new THREE.Matrix4(), dir);
    const shown = culler.shownTiles;
    expect(shown).toBeGreaterThan(4);
    expect(shown).toBeLessThan(6 * TILE_K * TILE_K * 0.35);
    for (const b of culler.batches) {
      const drawn = b.mesh.geometry.drawRange.count;
      expect(drawn).toBeLessThan(b.sorted.length);
      expect(b.mesh.visible).toBe(drawn > 0);
      // Every index drawn is a triangle of a tile in view, near the focus
      // for the small things.
      const idx = b.mesh.geometry.index!.array as Uint32Array;
      const pos = b.mesh.geometry.getAttribute('position');
      const reach = b.detail ? (DETAIL_REACH_M + 25) / R : Math.PI / 2;
      for (let i = 0; i < drawn; i += 3) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, idx[i]!).normalize();
        expect(p.angleTo(new THREE.Vector3(dir.x, dir.y, dir.z))).toBeLessThan(reach);
      }
    }
    // The far side is not drawn at all.
    const ground = culler.batches.find((b) => b.mesh.name === 'tiles:Terrain')!;
    expect(ground.mesh.geometry.drawRange.count).toBeLessThan(ground.sorted.length / 3);
    // Seen from the antipode, a different set.
    culler.update(cameraOver({ x: -0.2, y: -1, z: -0.1 }), new THREE.Matrix4(), {
      x: -dir.x,
      y: -dir.y,
      z: -dir.z,
    });
    const idx = ground.mesh.geometry.index!.array as Uint32Array;
    const p = new THREE.Vector3().fromBufferAttribute(
      ground.mesh.geometry.getAttribute('position'),
      idx[0]!,
    );
    expect(p.y).toBeLessThan(0);
  });
});
