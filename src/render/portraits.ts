// Offscreen champion portraits: the articulated champion mesh rendered once
// per champion and skin to a small transparent canvas and cached as a data
// URL. Used by champion select and the roster browser; zero image assets.

import * as THREE from 'three';
import { buildChampionMesh } from './champion_shapes';

const SIZE = 96;
const cache = new Map<string, string>();

interface Rig {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mount: THREE.Group;
}

let rig: Rig | null = null;

function ensureRig(): Rig {
  if (rig) return rig;
  const gl = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  gl.setSize(SIZE, SIZE);
  gl.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x465f39, 1.2));
  const sun = new THREE.DirectionalLight(0xffdfaa, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(1.7, 2.0, 2.7);
  camera.lookAt(0, 1.25, 0);
  const mount = new THREE.Group();
  // Turned so the signature prop side (+x) faces the camera.
  mount.rotation.y = 0.65;
  scene.add(mount);
  rig = { gl, scene, camera, mount };
  return rig;
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const c = child as THREE.Mesh;
    if (c.isMesh) {
      c.geometry.dispose();
      const mat = c.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
  });
}

export function championPortraitUrl(championId: string, skin = 0, teamColor = 0x4a7dd6): string {
  const key = `${championId}|${skin}|${teamColor}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = ensureRig();
  const mesh = buildChampionMesh(championId, teamColor, skin);
  r.mount.add(mesh);
  r.gl.render(r.scene, r.camera);
  const url = r.gl.domElement.toDataURL();
  r.mount.remove(mesh);
  disposeTree(mesh);
  cache.set(key, url);
  return url;
}
