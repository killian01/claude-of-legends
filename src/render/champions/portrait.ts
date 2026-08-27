// Cinematic champion portraits: the rigged GLB frozen mid-clip (the pose is
// authored per champion in the manifest), lit with a warm key and an
// accent-colored rim, composed over a mood gradient with a glow and a
// vignette on a 2D canvas. Rendered offscreen once per (champion, skin,
// team) and cached as a data URL. Async because the GLBs load async; the
// menu shows the old figure portrait until this resolves.

import * as THREE from 'three';
import { skinOf } from '../../sim/content/skins';
import {
  type ChampionTemplate,
  instantiateChampion,
  preloadChampionAssets,
  syncPropAnchors,
  whenChampionTemplateReady,
} from './assets';

const W = 300;
const H = 400;

interface PortraitRig {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mount: THREE.Group;
  rim: THREE.DirectionalLight;
  compose: HTMLCanvasElement;
}

let rig: PortraitRig | null = null;
const cache = new Map<string, string>();

function ensureRig(): PortraitRig {
  if (rig) return rig;
  const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  gl.setSize(W, H);
  gl.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x2c3320, 0.9));
  const key = new THREE.DirectionalLight(0xffe8c0, 2.4);
  key.position.set(2.4, 3.2, 3.6);
  scene.add(key);
  // The rim wears the champion's accent color; re-tinted per render.
  const rim = new THREE.DirectionalLight(0xffffff, 3.2);
  rim.position.set(-2.6, 2.4, -3.2);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 50);
  const mount = new THREE.Group();
  scene.add(mount);
  const compose = document.createElement('canvas');
  compose.width = W;
  compose.height = H;
  rig = { gl, scene, camera, mount, rim, compose };
  return rig;
}

// Kicks the champion GLB loads from the menu, before any game renderer
// exists; the game's later preload call is a no-op thanks to the guard.
export function ensurePortraitAssets(): void {
  preloadChampionAssets(ensureRig().gl);
}

const css = (c: THREE.Color, alpha: number): string =>
  `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;

// The background mood is the accent pushed to a saturated mid tone, so even
// a muted steel accent (Korrath) still reads as an atmosphere, not as murk.
function moodColor(accent: number): THREE.Color {
  const c = new THREE.Color(accent);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.max(hsl.s, 0.55), 0.42);
  return c;
}

// Per-instance materials and skeletons die with the portrait; geometry is
// the template's and survives.
function disposeInstance(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
      if (!mesh.userData.sharedGeo) mesh.geometry.dispose();
    }
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
  });
}

function renderPortrait(
  championId: string,
  template: ChampionTemplate,
  skin: number,
  teamColor: number,
): string {
  const r = ensureRig();
  const def = template.def;
  const pose = def.portrait ?? {};
  const accent = skinOf(championId, skin).accent;

  const inst = instantiateChampion(championId, template, teamColor, skin, { ring: false });
  // Freeze the champion mid-clip: play the authored pose clip and step the
  // mixer to its time fraction once.
  const clipName = def.clips[pose.clip ?? 'idle'];
  const clip = clipName ? template.clips.get(clipName) : undefined;
  const mixer = new THREE.AnimationMixer(inst.rig);
  if (clip) {
    mixer.clipAction(clip).play();
    mixer.update(clip.duration * (pose.time ?? 0));
  }
  inst.root.rotation.y = pose.yaw ?? 0.55;
  r.mount.add(inst.root);
  inst.root.updateMatrixWorld(true);
  syncPropAnchors(inst.root, inst.anchors);

  // Heroic low-ish framing driven by the silhouette's height.
  const h = def.height;
  const dist = (1.5 * h) / (pose.zoom ?? 1);
  r.camera.position.set(0.1 * h, 0.52 * h, dist);
  r.camera.lookAt(0, 0.53 * h, 0);
  const mood = moodColor(accent);
  r.rim.color.copy(mood);
  r.gl.render(r.scene, r.camera);

  // 2D composition: mood gradient, glow behind the figure, the render,
  // then a vignette. The name scrim belongs to the card CSS, not the image.
  const ctx = r.compose.getContext('2d');
  if (!ctx) return r.gl.domElement.toDataURL();
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1108');
  bg.addColorStop(0.55, css(mood, 0.5));
  bg.addColorStop(1, '#050803');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.42, W * 0.62);
  glow.addColorStop(0, css(mood, 0.6));
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(r.gl.domElement, 0, 0, W, H);
  const vig = ctx.createRadialGradient(W * 0.5, H * 0.46, H * 0.32, W * 0.5, H * 0.5, H * 0.78);
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  mixer.stopAllAction();
  mixer.uncacheRoot(inst.rig);
  r.mount.remove(inst.root);
  disposeInstance(inst.root);
  return r.compose.toDataURL('image/png');
}

// Resolves to the cinematic portrait data URL, or null when the champion has
// no rigged def or its asset failed to load (callers keep their fallback).
export async function cinematicPortraitUrl(
  championId: string,
  skin = 0,
  teamColor = 0x4a7dd6,
): Promise<string | null> {
  const key = `${championId}|${skin}|${teamColor}`;
  const hit = cache.get(key);
  if (hit) return hit;
  ensurePortraitAssets();
  const template = await whenChampionTemplateReady(championId);
  if (!template) return null;
  const url = renderPortrait(championId, template, skin, teamColor);
  cache.set(key, url);
  return url;
}
