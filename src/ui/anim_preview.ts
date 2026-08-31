// The animation preview stage (playtest round 9): every pickable preset
// plays instantly on the neutral gray mannequin, so the player sees what
// an animation looks like BEFORE any credit is spent baking it onto
// their champion. The mannequin and its baked clip catalog are app
// assets built once by scripts/forge_mannequin.mjs and shipped under
// public/models/mannequin/; this module only reads them. When the
// mannequin is not built (or a preset's clip is not baked yet), the
// stage says so instead of pretending.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { prepareForgedRun } from '../render/champions/forged';

const BASE = '/models/mannequin/';

interface MannequinManifest {
  model: string;
  clips: Record<string, string>;
}

export interface AnimPreview {
  el: HTMLElement;
  // Plays one preset; role 'run' also strips its baked travel so the
  // mannequin runs on the spot, exactly as a champion will.
  show(preset: string, role: string): void;
  dispose(): void;
}

export function createAnimPreview(): AnimPreview {
  const root = document.createElement('div');
  root.style.cssText =
    'position:relative;width:100%;height:240px;border:1px solid #4a3a1c;' +
    'border-radius:8px;overflow:hidden;background:#14100a;margin:8px 0;';
  const note = document.createElement('div');
  note.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'color:#97854f;font-size:12px;text-align:center;padding:12px;pointer-events:none;';
  note.textContent = 'Loading the preview mannequin...';
  root.append(note);
  const caption = document.createElement('div');
  caption.style.cssText =
    'position:absolute;left:8px;bottom:6px;color:#97854f;font-size:11px;pointer-events:none;';
  root.append(caption);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  root.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xf0e6c8, 0x2a2013, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 6, 5);
  scene.add(key);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.95, 0.05, 40),
    new THREE.MeshLambertMaterial({ color: 0x2c2210 }),
  );
  disc.position.y = -0.025;
  scene.add(disc);

  const loader = new GLTFLoader();
  let manifest: MannequinManifest | null = null;
  let model: THREE.Group | null = null;
  let rawHeight = 1;
  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  // One clip batch file can carry several presets; fetched once each.
  const files = new Map<string, Promise<THREE.AnimationClip[] | null>>();
  // The facing fix, measured once from the run preset's baked travel.
  let facingYaw: number | null = null;
  let disposed = false;
  let pending = 0;

  const ready = fetch(`${BASE}mannequin.json`)
    .then((res) => (res.ok ? (res.json() as Promise<MannequinManifest>) : null))
    .then((m) => {
      if (!m || disposed) {
        note.textContent =
          'The preview mannequin is not built yet; previews light up once it ships.';
        return null;
      }
      manifest = m;
      return loader.loadAsync(BASE + m.model).then((gltf) => {
        if (disposed) return null;
        model = gltf.scene;
        // The mannequin ships untextured on purpose: neutral gray.
        model.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if ((mesh as { isMesh?: boolean }).isMesh) {
            mesh.material = new THREE.MeshLambertMaterial({ color: 0xb9b4a8 });
          }
        });
        const box = new THREE.Box3().setFromObject(model);
        rawHeight = Math.max(0.001, box.max.y - box.min.y);
        const scale = 1.6 / rawHeight;
        model.scale.setScalar(scale);
        model.position.y = -box.min.y * scale;
        scene.add(model);
        mixer = new THREE.AnimationMixer(model);
        note.textContent = '';
        return model;
      });
    })
    .catch(() => {
      note.textContent = 'The preview mannequin could not load.';
      return null;
    });

  const clipsOf = (file: string): Promise<THREE.AnimationClip[] | null> => {
    let cached = files.get(file);
    if (!cached) {
      cached = loader
        .loadAsync(BASE + file)
        .then((g) => g.animations)
        .catch(() => null);
      files.set(file, cached);
    }
    return cached;
  };

  const show = (preset: string, role: string): void => {
    const token = ++pending;
    caption.textContent = '';
    void ready.then((m) => {
      if (!m || !manifest || disposed || token !== pending) return;
      const file = manifest.clips[preset];
      if (file === undefined) {
        note.textContent = 'This preset has no baked preview yet.';
        action?.stop();
        action = null;
        return;
      }
      void clipsOf(file).then((anims) => {
        if (disposed || token !== pending || !mixer || !model) return;
        const clip = anims?.find((a) => a.name === preset) ?? null;
        if (!clip) {
          note.textContent = 'This preset has no baked preview yet.';
          return;
        }
        note.textContent = '';
        if (role === 'run') {
          const idle = manifest?.clips['preset:biped:idle'];
          void (idle !== undefined ? clipsOf(idle) : Promise.resolve(null)).then((idleAnims) => {
            if (disposed || token !== pending || !mixer || !model) return;
            const idleClip = idleAnims?.find((a) => a.name === 'preset:biped:idle');
            const fix = prepareForgedRun(model, clip, idleClip, rawHeight);
            if (fix !== null) facingYaw = fix;
            play(clip);
          });
          return;
        }
        play(clip);
      });
    });
  };

  const play = (clip: THREE.AnimationClip): void => {
    if (!mixer || !model) return;
    if (facingYaw !== null) model.rotation.y = facingYaw;
    const next = mixer.clipAction(clip);
    action?.fadeOut(0.1);
    next.reset().fadeIn(0.1).play();
    action = next;
    caption.textContent = clip.name.replace('preset:biped:', '');
  };

  const clock = new THREE.Clock();
  let frame = 0;
  const loop = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    mixer?.update(clock.getDelta());
    camera.position.set(0, 1.15, 3.4);
    camera.lookAt(0, 0.8, 0);
    renderer.render(scene, camera);
  };
  loop();

  return {
    el: root,
    show,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.dispose();
      root.remove();
    },
  };
}
