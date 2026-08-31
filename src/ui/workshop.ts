// The workshop view (plan-forge phase 4, ADR 0010): the finalized
// champion's generated model on a turntable. Orbit and zoom, playback of
// the clip set, team color preview on the ring, and a match-view camera
// that shows the model at in-match scale over a lane-width grid. Prop
// grip adjustment joins when the weapon prop pipeline lands (Tripo half).
// Reads assets over the server's asset route; renders only, never
// touches the sim.

import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const CSS = `
.ws, .ws * { box-sizing: border-box; }
.ws {
  position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column;
  background: radial-gradient(ellipse at center, #241c10 0%, #0f0a04 80%);
  font-family: system-ui, sans-serif; color: #d8cdb0; font-size: 12px;
}
.ws-head {
  display: flex; align-items: baseline; gap: 14px; padding: 14px 22px 10px;
  border-bottom: 1px solid #4a3a1c;
}
.ws-title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #e8cc74; }
.ws-sub { color: #97854f; font-size: 12px; }
.ws-back {
  margin-left: auto; padding: 6px 16px; border-radius: 6px; border: 1px solid #6b5a2e;
  background: #241c10; color: #d8cdb0; font-size: 13px; font-weight: 700; cursor: pointer;
}
.ws-back:hover { border-color: #d8b45a; }
.ws-body { flex: 1; display: flex; min-height: 0; }
.ws-stage { flex: 1; position: relative; min-width: 0; }
.ws-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
.ws-stage canvas:active { cursor: grabbing; }
.ws-rail { width: 240px; flex: none; overflow-y: auto; padding: 12px; border-left: 1px solid #4a3a1c; }
.ws-panel {
  background: rgba(14, 10, 4, 0.85); border: 1px solid #4a3a1c; border-radius: 10px;
  padding: 10px 12px; margin-bottom: 10px;
}
.ws-panel h3 { margin: 0 0 8px; font-size: 12px; color: #c9a84a; letter-spacing: 0.6px; text-transform: uppercase; }
.ws-btn {
  display: inline-block; margin: 2px 4px 2px 0; padding: 5px 10px; border-radius: 6px;
  border: 1px solid #4a3a1c; background: #1a130a; color: #d8cdb0; font-size: 12px; cursor: pointer;
}
.ws-btn:hover { border-color: #a08030; }
.ws-btn.picked { border-color: #d8b45a; background: #2c2210; color: #e8cc74; }
.ws-art { width: 100%; border-radius: 8px; border: 1px solid #4a3a1c; display: block; margin-bottom: 8px; }
.ws-note { color: #97854f; font-size: 11px; line-height: 1.5; }
.ws-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #97854f; font-size: 14px;
}
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface WorkshopSubject {
  name: string;
  title?: string;
  // Asset-route URLs; the model is required, the 2D pieces optional.
  modelUrl: string;
  splashUrl?: string | null;
  sheetUrl?: string | null;
}

// The height forged models are normalized to in previews, in the middle
// of the roster's range (manifest heights run 1.6 to 3.6).
const PREVIEW_HEIGHT = 2.4;
const TEAM_COLORS = { blue: 0x4a7dd6, red: 0xd65c5c } as const;

export function openWorkshop(container: HTMLElement, subject: WorkshopSubject): void {
  ensureCss();
  const root = el('div', 'ws');

  const head = el('div', 'ws-head');
  const back = el('button', 'ws-back', 'Back');
  head.append(
    el('h1', 'ws-title', 'Workshop'),
    el('span', 'ws-sub', subject.title ? `${subject.name}, ${subject.title}` : subject.name),
    back,
  );

  const body = el('div', 'ws-body');
  const stage = el('div', 'ws-stage');
  const rail = el('div', 'ws-rail');
  body.append(stage, rail);
  root.append(head, body);
  container.appendChild(root);

  // --- three.js stage ----------------------------------------------------

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xf0e6c8, 0x2a2013, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 7, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(TEAM_COLORS.blue, 1.2);
  rim.position.set(-5, 4, -6);
  scene.add(rim);

  // The podium: a disc underfoot plus the team ring the in-match renderer
  // draws, so allegiance previews exactly where it shows in play.
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.7, 0.08, 48),
    new THREE.MeshLambertMaterial({ color: 0x2c2210 }),
  );
  disc.position.y = -0.04;
  scene.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.05, 10, 48),
    new THREE.MeshBasicMaterial({ color: TEAM_COLORS.blue }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // The match-scale reference: one unit per cell, the way the map grid
  // runs; visible only in match view.
  const grid = new THREE.GridHelper(24, 24, 0x4a3a1c, 0x33270f);
  grid.visible = false;
  scene.add(grid);

  const loading = el('div', 'ws-loading', 'Loading the model...');
  stage.appendChild(loading);

  // Turntable state: yaw is auto-advanced until the first drag.
  let yaw = 0.7;
  let pitch = 0.32;
  let dist = 6.2;
  let autoSpin = true;
  let matchView = false;

  const applyCamera = (): void => {
    if (matchView) {
      // The in-match top-down framing, near enough for a size read.
      camera.position.set(0, 11.5, 6.8);
      camera.lookAt(0, 0.5, 0);
      return;
    }
    const target = new THREE.Vector3(0, PREVIEW_HEIGHT * 0.45, 0);
    camera.position.set(
      target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(target);
  };

  const canvas = renderer.domElement;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    autoSpin = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.008;
    pitch = Math.min(1.2, Math.max(-0.1, pitch + (e.clientY - lastY) * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      dist = Math.min(16, Math.max(2.5, dist + e.deltaY * 0.004));
    },
    { passive: false },
  );

  const resize = (): void => {
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(stage);

  // --- the model and its clips -------------------------------------------

  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let activeAction: THREE.AnimationAction | null = null;
  const clipsPanel = el('div', 'ws-panel');
  clipsPanel.append(el('h3', '', 'Clips'));
  const clipButtons = new Map<string, HTMLButtonElement>();

  const playClip = (name: string): void => {
    if (!mixer) return;
    const clip = clips.find((c) => c.name === name);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    activeAction?.fadeOut(0.15);
    action.reset().fadeIn(0.15).play();
    activeAction = action;
    for (const [n, b] of clipButtons) b.classList.toggle('picked', n === name);
  };

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    subject.modelUrl,
    (gltf) => {
      loading.remove();
      const model = gltf.scene;
      // Normalize like the in-match loader: scale to the preview height,
      // feet on the ground.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = size.y > 0 ? PREVIEW_HEIGHT / size.y : 1;
      model.scale.setScalar(scale);
      const scaled = new THREE.Box3().setFromObject(model);
      model.position.y -= scaled.min.y;
      const center = scaled.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      scene.add(model);
      mixer = new THREE.AnimationMixer(model);
      clips = gltf.animations;
      for (const clip of clips) {
        const btn = el('button', 'ws-btn', clip.name) as HTMLButtonElement;
        btn.addEventListener('click', () => playClip(clip.name));
        clipButtons.set(clip.name, btn);
        clipsPanel.append(btn);
      }
      if (clips.length === 0) {
        clipsPanel.append(el('div', 'ws-note', 'This model carries no animation clips.'));
      }
      playClip(clips.find((c) => c.name === 'idle')?.name ?? clips[0]?.name ?? '');
    },
    undefined,
    () => {
      loading.textContent = 'The model could not be loaded.';
    },
  );

  // --- rail: team color, view, art ---------------------------------------

  const teamPanel = el('div', 'ws-panel');
  teamPanel.append(el('h3', '', 'Team color'));
  const teamButtons: HTMLButtonElement[] = [];
  for (const [name, color] of Object.entries(TEAM_COLORS)) {
    const btn = el('button', 'ws-btn', name === 'blue' ? 'Blue side' : 'Red side');
    btn.classList.toggle('picked', name === 'blue');
    btn.addEventListener('click', () => {
      (ring.material as THREE.MeshBasicMaterial).color.setHex(color);
      rim.color.setHex(color);
      for (const b of teamButtons) b.classList.toggle('picked', b === btn);
    });
    teamButtons.push(btn as HTMLButtonElement);
    teamPanel.append(btn);
  }

  const viewPanel = el('div', 'ws-panel');
  viewPanel.append(el('h3', '', 'View'));
  const podiumBtn = el('button', 'ws-btn picked', 'Podium');
  const matchBtn = el('button', 'ws-btn', 'Match view (in-game scale)');
  const setView = (match: boolean): void => {
    matchView = match;
    grid.visible = match;
    podiumBtn.classList.toggle('picked', !match);
    matchBtn.classList.toggle('picked', match);
  };
  podiumBtn.addEventListener('click', () => setView(false));
  matchBtn.addEventListener('click', () => setView(true));
  viewPanel.append(podiumBtn, matchBtn);
  viewPanel.append(
    el('div', 'ws-note', 'Drag to orbit, wheel to zoom. Match view shows one map unit per cell.'),
  );

  const artPanel = el('div', 'ws-panel');
  artPanel.append(el('h3', '', 'Art'));
  let anyArt = false;
  for (const [label, url] of [
    ['Splash', subject.splashUrl],
    ['Model sheet', subject.sheetUrl],
  ] as const) {
    if (!url) continue;
    anyArt = true;
    const img = document.createElement('img');
    img.className = 'ws-art';
    img.src = url;
    img.alt = label;
    img.title = label;
    artPanel.append(img);
  }
  if (!anyArt) artPanel.append(el('div', 'ws-note', 'No 2D art recorded for this champion.'));

  rail.append(clipsPanel, teamPanel, viewPanel, artPanel);

  // --- loop and teardown --------------------------------------------------

  const clock = new THREE.Clock();
  let frame = 0;
  const loop = (): void => {
    frame = requestAnimationFrame(loop);
    const dt = clock.getDelta();
    if (autoSpin && !matchView) yaw += dt * 0.35;
    mixer?.update(dt);
    applyCamera();
    renderer.render(scene, camera);
  };
  resize();
  loop();

  const close = (): void => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('keydown', onKey);
    renderer.dispose();
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  back.addEventListener('click', close);
}
