// The home screen's living backdrop: a handful of champions idling on a
// dark stage behind the menu card, drawn with the game's toon pass, camera
// drifting slowly, one of them swinging now and then. Pure presentation;
// the returned stop() tears the canvas and the GPU resources down when the
// home screen resolves.

import * as THREE from 'three';
import { createChampionVisual, preloadChampionAssets } from '../render/champions';
import { CHAMPION_VISUALS } from '../render/champions/manifest';
import type { ChampionVisual } from '../render/champions/visual';
import { toonifyMaterials } from '../render/toon';

export function startHomeShowcase(host: HTMLElement): () => void {
  const gl = new THREE.WebGLRenderer({ antialias: true });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gl.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
  gl.domElement.className = 'menu-showcase-canvas';
  host.appendChild(gl.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1509);
  scene.fog = new THREE.Fog(0x0d1509, 15, 36);
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x2c3320, 0.85));
  const key = new THREE.DirectionalLight(0xffe0b0, 1.9);
  key.position.set(6, 10, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x86b8f0, 1.6);
  rim.position.set(-6, 6, -8);
  scene.add(rim);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(70, 48),
    new THREE.MeshLambertMaterial({ color: 0x1c2c14 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  toonifyMaterials(scene);

  const camera = new THREE.PerspectiveCamera(
    38,
    (host.clientWidth || 1) / (host.clientHeight || 1),
    0.1,
    80,
  );

  preloadChampionAssets(gl);
  const visuals: ChampionVisual[] = [];
  // A fresh honor guard every visit; slots fan out to the right of the
  // menu card, front row closer and larger.
  const ids = Object.keys(CHAMPION_VISUALS)
    .map((id) => ({ id, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 4)
    .map((x) => x.id);
  const slots = [
    { x: 1.8, z: 2.2, yaw: -0.25 },
    { x: 5.2, z: -0.2, yaw: -0.4 },
    { x: 8.6, z: 2.4, yaw: -0.55 },
    { x: 11.6, z: -0.6, yaw: -0.7 },
  ];
  for (const [i, id] of ids.entries()) {
    void createChampionVisual(id, i % 2 === 0 ? 0x4a7dd6 : 0xd65c5c, 0).then((v) => {
      if (!v || stopped) return;
      const slot = slots[i] ?? slots[0]!;
      v.root.position.set(slot.x, 0, slot.z);
      v.root.rotation.y = slot.yaw;
      toonifyMaterials(v.root);
      scene.add(v.root);
      visuals.push(v);
    });
  }

  let stopped = false;
  let raf = 0;
  let last = performance.now();
  let nextSwing = last + 2500;
  const frame = (now: number): void => {
    if (stopped) return;
    const dt = Math.min(100, now - last);
    last = now;
    // Slow cinematic drift around the lineup.
    const t = now * 0.00006;
    camera.position.set(6.4 + Math.sin(t) * 1.4, 2.9, 11.2 + Math.cos(t * 1.3) * 0.9);
    camera.lookAt(6.4, 1.6, 0);
    if (now > nextSwing && visuals.length > 0) {
      nextSwing = now + 2800 + Math.random() * 2600;
      visuals[Math.floor(Math.random() * visuals.length)]?.playAttack();
    }
    for (const v of visuals) v.update(dt, { moving: false, windingUp: false, dead: false });
    gl.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const onResize = (): void => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    gl.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    for (const v of visuals) {
      v.dispose();
      v.root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) for (const m of mat) m.dispose();
          else mat.dispose();
        }
        const skinned = child as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      });
    }
    gl.dispose();
    gl.domElement.remove();
  };
}
