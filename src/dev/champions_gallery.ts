// Dev-only champion gallery (/dev_champions.html): every rigged champion
// side by side over a flat ground, cycling idle, run, attack, and cast, so
// scale, facing, props, and clips can be eyeballed without booting a match.
// ?portraits shows the cinematic portrait cards instead (?portraits=<id,id>
// limits which). Never imported by the game; Vite serves it as its own entry.

import * as THREE from 'three';
import {
  cinematicPortraitUrl,
  createChampionVisual,
  preloadChampionAssets,
} from '../render/champions';
import { CHAMPION_VISUALS } from '../render/champions/manifest';
import type { ChampionVisual } from '../render/champions/visual';
import { createOutlineRenderer, toonifyMaterials } from '../render/toon';

const params = new URLSearchParams(location.search);

function runPortraitsMode(list: string): void {
  document.body.style.cssText =
    'margin:0;background:#0c120a;display:flex;flex-wrap:wrap;' +
    'gap:16px;padding:16px;align-items:flex-start';
  const wanted = list ? list.split(',') : Object.keys(CHAMPION_VISUALS);
  for (const id of wanted) {
    const holder = document.createElement('div');
    holder.style.cssText = 'color:#cfe;font:12px monospace;text-align:center';
    const img = document.createElement('img');
    img.style.cssText = 'width:300px;height:400px;border-radius:10px;display:block';
    holder.append(img, document.createTextNode(id));
    document.body.appendChild(holder);
    void cinematicPortraitUrl(id).then((url) => {
      if (url) img.src = url;
    });
  }
}

function runLineup(): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x223522);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 14, 8);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 20),
    new THREE.MeshLambertMaterial({ color: 0x33502f }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const ids = Object.keys(CHAMPION_VISUALS);
  const spacing = 4.2;
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  // ?focus=<championId> frames one champion up close instead of the lineup;
  // ?yaw=<radians> spins the focused champion's root on top of its manifest
  // yawOffset, for calibrating facing empirically.
  const focus = params.get('focus');
  const extraYaw = Number.parseFloat(params.get('yaw') ?? '0') || 0;
  const focusIdx = focus ? ids.indexOf(focus) : -1;
  if (focusIdx >= 0) {
    const fx = (focusIdx - (ids.length - 1) / 2) * spacing;
    camera.position.set(fx, 3.2, 5.5);
    camera.lookAt(fx, 1.3, 0);
  } else {
    camera.position.set(0, 12, 26);
    camera.lookAt(0, 1.2, 0);
  }

  preloadChampionAssets(renderer);
  const visuals = new Map<string, ChampionVisual>();
  for (const [i, id] of ids.entries()) {
    void createChampionVisual(id, i % 2 === 0 ? 0x4a7dd6 : 0xd65c5c, 0).then((v) => {
      if (!v) return;
      v.root.position.x = (i - (ids.length - 1) / 2) * spacing;
      if (id === focus) v.root.rotation.y = extraYaw;
      toonifyMaterials(v.root);
      scene.add(v.root);
      visuals.set(id, v);
      const label = document.createElement('div');
      label.textContent = id;
      label.style.cssText = 'position:fixed;bottom:6px;color:#cfe;left:0;font:12px monospace';
      label.style.left = `${((i + 0.5) / ids.length) * 100 - 3}%`;
      document.body.appendChild(label);
    });
  }

  toonifyMaterials(scene);
  const outline = createOutlineRenderer(renderer);

  // Phase cycle so a screenshot at a known time shows a known pose.
  let last = performance.now();
  let lastPhase = -1;
  function frame(now: number): void {
    const dt = Math.min(100, now - last);
    last = now;
    const phase = Math.floor((now / 3000) % 4);
    for (const v of visuals.values()) {
      if (phase !== lastPhase && phase === 2) v.playAttack();
      if (phase !== lastPhase && phase === 3) v.playCast();
      v.update(dt, { moving: phase === 1, windingUp: false, dead: false, speed: 3.7 });
    }
    lastPhase = phase;
    outline.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

const portraitsParam = params.get('portraits');
if (portraitsParam !== null) runPortraitsMode(portraitsParam);
else runLineup();
