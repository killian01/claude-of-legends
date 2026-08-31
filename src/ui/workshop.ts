// The workshop (plan-forge phase 4, ADR 0010): the finalized champion's
// generated model on a turntable, plus the live adjustment studio the ADR
// promised: scale, facing and ground offset sliders, the weapon prop
// attached to a rig bone with a hand-tuned grip, and the clip set under
// readable names. Every change applies live on the stage; Save stores the
// tuning server-side (/api/forge/display) and the in-match renderer reads
// the exact same numbers, so what you see here is what plays. Owners tune;
// visitors only look. Renders only, never touches the sim.

import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findBone, type PropAnchor, syncPropAnchors } from '../render/champions/assets';
import { FORGED_DEFAULT_HEIGHT, guessHandBone } from '../render/champions/forged';
import { resolveForgedClips, stripTravel } from '../render/champions/forged_clips';
import type { ChampionClipNames } from '../render/champions/manifest';
import { buildChampionProp } from '../render/champions/props';
import {
  DISPLAY_BOUNDS,
  DISPLAY_PROP_KINDS,
  type DisplayPropKind,
  type ForgedDisplay,
  type ForgedDisplayProp,
} from '../sim/forge/display';

const CSS = `
.ws, .ws * { box-sizing: border-box; }
.ws {
  position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column;
  background: radial-gradient(ellipse at center, #241c10 0%, #0f0a04 80%);
  font-family: system-ui, sans-serif; color: #d8cdb0; font-size: 12px;
}
.ws *::-webkit-scrollbar { width: 10px; height: 10px; }
.ws *::-webkit-scrollbar-track { background: #120d06; }
.ws *::-webkit-scrollbar-thumb { background: #4a3a1c; border-radius: 5px; }
.ws *::-webkit-scrollbar-thumb:hover { background: #a08030; }
.ws * { scrollbar-width: thin; scrollbar-color: #4a3a1c #120d06; }
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
.ws-rail { width: 280px; flex: none; overflow-y: auto; padding: 12px; border-left: 1px solid #4a3a1c; }
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
.ws-save {
  display: block; width: 100%; margin-top: 8px; padding: 9px; border-radius: 6px;
  border: 1px solid #f0deae; font-size: 13px; font-weight: 700; cursor: pointer;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%); color: #241a08;
}
.ws-save:disabled { opacity: 0.5; cursor: default; }
.ws-art { width: 100%; border-radius: 8px; border: 1px solid #4a3a1c; display: block; margin-bottom: 8px; }
.ws-note { color: #97854f; font-size: 11px; line-height: 1.5; }
.ws-status { min-height: 15px; color: #aac2dd; font-size: 11px; margin-top: 6px; }
.ws-slider { display: grid; grid-template-columns: 62px 1fr 44px; gap: 6px; align-items: center; margin: 4px 0; }
.ws-slider label { color: #97854f; font-size: 11px; }
.ws-slider output { color: #d8cdb0; font-size: 11px; text-align: right; }
.ws-slider input[type=range] { width: 100%; accent-color: #c9a84a; margin: 0; }
.ws-select {
  width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #4a3a1c;
  background: #120d06; color: #e0d5b8; font-size: 12px; margin-bottom: 4px;
}
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
  // The forged champion id (the display route's key).
  id: string;
  name: string;
  title?: string;
  // Asset-route URLs; the model is required, the 2D pieces optional.
  modelUrl: string;
  splashUrl?: string | null;
  sheetUrl?: string | null;
  // Weapon family sealed at finalize; picks the default prop kind.
  family?: string | null;
  // The saved display tuning, when any; the sliders start from it.
  display?: ForgedDisplay | null;
  // Owners tune and save; visitors get the stage without the controls.
  editable?: boolean;
  onSaved?: (display: ForgedDisplay) => void;
}

// Prop and stage accent, the Forge gold.
const ACCENT = 0xc9a84a;
// A cool rim light so the silhouette reads; deliberately not a team
// color, allegiance is a match concern.
const RIM_COLOR = 0x7d8bb0;

// Friendly names over the provider's clip spellings, in play order.
const CLIP_LABELS: readonly { role: keyof ChampionClipNames; label: string }[] = [
  { role: 'idle', label: 'Idle' },
  { role: 'run', label: 'Run' },
  { role: 'attack', label: 'Attack' },
  { role: 'cast', label: 'Cast' },
  { role: 'death', label: 'Death' },
];

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
  const rim = new THREE.DirectionalLight(RIM_COLOR, 1.2);
  rim.position.set(-5, 4, -6);
  scene.add(rim);

  // The podium: a disc underfoot plus a gold ground ring at the in-match
  // radius, so the footprint previews where the team ring will draw.
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.7, 0.08, 48),
    new THREE.MeshLambertMaterial({ color: 0x2c2210 }),
  );
  disc.position.y = -0.04;
  scene.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.05, 10, 48),
    new THREE.MeshBasicMaterial({ color: ACCENT }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // The size reference: a roster-height silhouette (2.4 units, the middle
  // of the range) standing beside the podium, toggled from the View panel.
  const reference = new THREE.Group();
  {
    const mat = new THREE.MeshLambertMaterial({ color: 0x596070, transparent: true, opacity: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.25, 6, 14), mat);
    body.position.y = 0.925;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), mat);
    head.position.y = 2.1;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.55, 0.05, 24),
      new THREE.MeshLambertMaterial({ color: 0x33270f }),
    );
    base.position.y = 0.025;
    reference.add(body, head, base);
    const measured = new THREE.Box3().setFromObject(reference);
    reference.scale.setScalar(FORGED_DEFAULT_HEIGHT / Math.max(0.001, measured.max.y));
    reference.position.set(2.3, 0, 0);
    reference.visible = false;
    scene.add(reference);
  }

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
    const target = new THREE.Vector3(0, tuning.height * 0.45, 0);
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

  // --- the live tuning state ---------------------------------------------

  const saved = subject.display ?? {};
  const tuning = {
    height: saved.height ?? FORGED_DEFAULT_HEIGHT,
    yOffset: saved.yOffset ?? 0,
    yawOffset: saved.yawOffset ?? 0,
  };
  // The weapon starts from the saved grip; without one, from the weapon
  // family's default on the best-guess hand (the in-match rule).
  const copyTriple = (t: readonly [number, number, number]): [number, number, number] => [
    t[0],
    t[1],
    t[2],
  ];
  const prop: ForgedDisplayProp = saved.prop
    ? { ...saved.prop, rot: copyTriple(saved.prop.rot), pos: copyTriple(saved.prop.pos) }
    : { kind: 'none', bone: '', rot: [0, 0, 0], pos: [0, 0, 0] };

  // Wrapping: modelRoot > yawGroup > model. The prop holder hangs off
  // modelRoot and follows its bone every frame, in-match style.
  const modelRoot = new THREE.Group();
  const yawGroup = new THREE.Group();
  modelRoot.add(yawGroup);
  scene.add(modelRoot);
  let model: THREE.Group | null = null;
  let rawHeight = 1;
  let rawMinY = 0;
  const rawCenter = new THREE.Vector3();
  let boneNames: string[] = [];

  const applyModelTuning = (): void => {
    if (!model) return;
    const scale = tuning.height / rawHeight;
    model.scale.setScalar(scale);
    // The centering offset was measured on the raw model, so it scales
    // with it; the y correction grounds the feet, then lifts by yOffset.
    model.position.set(
      -rawCenter.x * scale,
      -rawMinY * scale + tuning.yOffset,
      -rawCenter.z * scale,
    );
    yawGroup.rotation.y = tuning.yawOffset;
  };

  let anchors: PropAnchor[] = [];
  let propHolder: THREE.Group | null = null;
  const rebuildProp = (keepRest: boolean): void => {
    const restInv = keepRest ? (anchors[0]?.restInv ?? null) : null;
    if (propHolder) {
      modelRoot.remove(propHolder);
      propHolder = null;
    }
    anchors = [];
    if (!model || prop.kind === 'none' || prop.bone === '') return;
    const bone = findBone(model, prop.bone);
    if (!bone) return;
    const built = buildChampionProp(prop.kind, ACCENT);
    built.rotation.set(prop.rot[0], prop.rot[1], prop.rot[2]);
    built.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
    propHolder = new THREE.Group();
    propHolder.add(built);
    modelRoot.add(propHolder);
    anchors = [
      {
        holder: propHolder,
        prop: built,
        hand: { bone, rot: prop.rot, pos: prop.pos },
        armed: true,
        fixedPose: false,
        tip: null,
        restInv,
      },
    ];
  };

  // --- the model and its clips -------------------------------------------

  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let activeAction: THREE.AnimationAction | null = null;
  let activeClipName = '';
  let idleClipName = '';
  let ageMs = 0;
  const clipsPanel = el('div', 'ws-panel');
  clipsPanel.append(el('h3', '', 'Animations'));
  const clipButtons = new Map<string, HTMLButtonElement>();

  const playClip = (name: string): void => {
    if (!mixer) return;
    const clip = clips.find((c) => c.name === name);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    activeAction?.fadeOut(0.15);
    action.reset().fadeIn(0.15).play();
    activeAction = action;
    activeClipName = name;
    for (const [n, b] of clipButtons) b.classList.toggle('picked', n === name);
  };

  const buildClipButtons = (): void => {
    // Friendly labels first (Idle, Run, Attack...), resolved the same way
    // the in-match renderer does; unmatched clips keep their raw names.
    const resolved = resolveForgedClips(clips.map((c) => c.name));
    // The run cycle plays on the spot here exactly as it will in match.
    const runClip = resolved ? clips.find((c) => c.name === resolved.run) : undefined;
    if (runClip) stripTravel(runClip);
    const labeled = new Map<string, string>();
    if (resolved) {
      for (const { role, label } of CLIP_LABELS) {
        const name = resolved[role];
        if (name !== undefined && !labeled.has(name)) labeled.set(name, label);
      }
    }
    for (const clip of clips) {
      if (!labeled.has(clip.name)) labeled.set(clip.name, clip.name);
    }
    for (const [name, label] of labeled) {
      const btn = el('button', 'ws-btn', label) as HTMLButtonElement;
      btn.title = name;
      btn.addEventListener('click', () => playClip(name));
      clipButtons.set(name, btn);
      clipsPanel.append(btn);
    }
    if (clips.length === 0) {
      clipsPanel.append(el('div', 'ws-note', 'This model carries no animation clips.'));
    }
    idleClipName = resolved?.idle ?? clips[0]?.name ?? '';
    playClip(idleClipName);
  };

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    subject.modelUrl,
    (gltf) => {
      loading.remove();
      model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      rawHeight = Math.max(0.001, size.y);
      rawMinY = box.min.y;
      box.getCenter(rawCenter);
      yawGroup.add(model);
      boneNames = [];
      model.traverse((child) => {
        if ((child as THREE.Bone).isBone) boneNames.push(child.name);
      });
      applyModelTuning();
      rebuildProp(false);
      buildWeaponControls();
      mixer = new THREE.AnimationMixer(model);
      clips = gltf.animations;
      buildClipButtons();
    },
    undefined,
    () => {
      loading.textContent = 'The model could not be loaded.';
    },
  );

  // --- rail: tuning, weapon, clips, view, art ----------------------------

  const status = el('div', 'ws-status', '');

  const sliderRow = (
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    format: (v: number) => string,
    onInput: (v: number) => void,
  ): HTMLElement => {
    const row = el('div', 'ws-slider');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = el('output', '', format(value));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = format(v);
      onInput(v);
    });
    const name = el('label', '', label);
    row.append(name, input, out);
    return row;
  };

  const editable = subject.editable === true;

  const modelPanel = el('div', 'ws-panel');
  modelPanel.append(el('h3', '', 'Model'));
  if (editable) {
    modelPanel.append(
      sliderRow(
        'Height',
        DISPLAY_BOUNDS.height.min,
        DISPLAY_BOUNDS.height.max,
        0.05,
        tuning.height,
        (v) => v.toFixed(2),
        (v) => {
          tuning.height = v;
          applyModelTuning();
        },
      ),
      sliderRow(
        'Facing',
        -180,
        180,
        1,
        (tuning.yawOffset * 180) / Math.PI,
        (v) => `${Math.round(v)}`,
        (v) => {
          tuning.yawOffset = (v * Math.PI) / 180;
          applyModelTuning();
        },
      ),
      sliderRow(
        'Ground',
        DISPLAY_BOUNDS.yOffset.min,
        DISPLAY_BOUNDS.yOffset.max,
        0.02,
        tuning.yOffset,
        (v) => v.toFixed(2),
        (v) => {
          tuning.yOffset = v;
          applyModelTuning();
        },
      ),
      el(
        'div',
        'ws-note',
        'Height against the roster: 1.6 (small) to 3.6 (colossus). Facing turns the model if it was generated sideways.',
      ),
    );
  } else {
    modelPanel.append(el('div', 'ws-note', 'Only the creator can tune this champion.'));
  }

  const weaponPanel = el('div', 'ws-panel');
  weaponPanel.append(el('h3', '', 'Weapon'));
  const weaponControls = el('div', '');
  weaponPanel.append(weaponControls);
  const buildWeaponControls = (): void => {
    weaponControls.textContent = '';
    if (!editable) {
      weaponControls.append(
        el('div', 'ws-note', 'The weapon rides a hand bone; the creator tunes the grip.'),
      );
      return;
    }
    const kindSelect = el('select', 'ws-select') as HTMLSelectElement;
    for (const k of DISPLAY_PROP_KINDS) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k === 'none' ? 'No weapon' : k;
      kindSelect.append(opt);
    }
    kindSelect.value = prop.kind;
    kindSelect.addEventListener('change', () => {
      prop.kind = kindSelect.value as DisplayPropKind;
      if (prop.kind !== 'none' && prop.bone === '') {
        prop.bone = guessHandBone(boneNames) ?? '';
        boneSelect.value = prop.bone;
      }
      rebuildProp(true);
    });
    const boneSelect = el('select', 'ws-select') as HTMLSelectElement;
    // Hand bones first (where a weapon belongs), then the whole rig for
    // the odd model whose rig names surprise us. Labels are human words
    // ('Left hand'), the rig's raw spelling stays the stored value.
    const prettyBone = (raw: string): string => {
      let s = raw;
      if (/^l[_.-]/i.test(s)) s = `Left ${s.slice(2)}`;
      else if (/^r[_.-]/i.test(s)) s = `Right ${s.slice(2)}`;
      else if (/^left/i.test(s)) s = `Left ${s.slice(4)}`;
      else if (/^right/i.test(s)) s = `Right ${s.slice(5)}`;
      else if (/[_.-]l$/i.test(s)) s = `Left ${s.slice(0, -2)}`;
      else if (/[_.-]r$/i.test(s)) s = `Right ${s.slice(0, -2)}`;
      s = s
        .replace(/[_.-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/(\d+)/g, ' $1')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return s === '' ? raw : s.charAt(0).toUpperCase() + s.slice(1);
    };
    const hands = boneNames.filter((n) => /hand/i.test(n));
    const rest = boneNames.filter((n) => !/hand/i.test(n)).slice(0, 60);
    const listed = [...hands, ...rest];
    if (prop.bone !== '' && !listed.includes(prop.bone)) listed.push(prop.bone);
    for (const n of listed) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = prettyBone(n);
      opt.title = n;
      boneSelect.append(opt);
    }
    boneSelect.value = prop.bone;
    boneSelect.addEventListener('change', () => {
      prop.bone = boneSelect.value;
      rebuildProp(false);
    });
    weaponControls.append(kindSelect, boneSelect);
    const axes = ['X', 'Y', 'Z'] as const;
    for (let i = 0; i < 3; i++) {
      weaponControls.append(
        sliderRow(
          `Turn ${axes[i]}`,
          -180,
          180,
          1,
          ((prop.rot[i] ?? 0) * 180) / Math.PI,
          (v) => `${Math.round(v)}`,
          (v) => {
            prop.rot[i] = (v * Math.PI) / 180;
            rebuildProp(true);
          },
        ),
      );
    }
    for (let i = 0; i < 3; i++) {
      weaponControls.append(
        sliderRow(
          `Slide ${axes[i]}`,
          -1,
          1,
          0.01,
          prop.pos[i] ?? 0,
          (v) => v.toFixed(2),
          (v) => {
            prop.pos[i] = v;
            rebuildProp(true);
          },
        ),
      );
    }
    weaponControls.append(
      el(
        'div',
        'ws-note',
        'Pick the weapon and the bone it rides, then turn and slide it until the grip sits in the hand. Play Attack to check the swing.',
      ),
    );
  };
  buildWeaponControls();

  if (editable) {
    const save = el('button', 'ws-save', 'Save the tuning') as HTMLButtonElement;
    save.addEventListener('click', () => {
      save.disabled = true;
      status.textContent = 'Saving...';
      const display: ForgedDisplay = {
        height: tuning.height,
        yOffset: tuning.yOffset,
        yawOffset: tuning.yawOffset,
        prop: {
          kind: prop.kind,
          bone: prop.bone,
          rot: copyTriple(prop.rot),
          pos: copyTriple(prop.pos),
        },
      };
      void fetch('/api/forge/display', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: subject.id, display }),
      })
        .then((res) => res.json() as Promise<{ ok?: boolean; error?: string }>)
        .then((r) => {
          save.disabled = false;
          if (r?.ok) {
            status.textContent = 'Saved: matches now use this tuning.';
            subject.onSaved?.(display);
          } else {
            status.textContent = r?.error ?? 'save failed';
          }
        })
        .catch(() => {
          save.disabled = false;
          status.textContent = 'save failed';
        });
    });
    weaponPanel.append(save, status);
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
  const refBtn = el('button', 'ws-btn', 'Size reference');
  refBtn.addEventListener('click', () => {
    reference.visible = !reference.visible;
    refBtn.classList.toggle('picked', reference.visible);
  });
  viewPanel.append(podiumBtn, matchBtn, refBtn);
  viewPanel.append(
    el(
      'div',
      'ws-note',
      'Drag to orbit, wheel to zoom. Match view shows one map unit per cell. The size ' +
        'reference is a roster-average silhouette (2.4 units) to judge your height against.',
    ),
  );

  const artPanel = el('div', 'ws-panel');
  artPanel.append(el('h3', '', 'Art'));
  let anyArt = false;
  for (const [label, url] of [
    ['Splash', subject.splashUrl],
    ['Model reference', subject.sheetUrl],
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

  rail.append(modelPanel, weaponPanel, clipsPanel, viewPanel, artPanel);

  // --- loop and teardown --------------------------------------------------

  const clock = new THREE.Clock();
  let frame = 0;
  const loop = (): void => {
    frame = requestAnimationFrame(loop);
    const dt = clock.getDelta();
    ageMs += dt * 1000;
    if (autoSpin && !matchView) yaw += dt * 0.35;
    mixer?.update(dt);
    // The grip's rest orientation is captured once the idle pose has
    // settled, in-match style, so the weapon swings with the hand during
    // attack clips instead of staying frozen.
    if (anchors.length > 0) {
      const settled = ageMs > 400 && activeClipName === idleClipName;
      syncPropAnchors(modelRoot, anchors, settled);
    }
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
