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
import {
  captureRestPose,
  findBone,
  normalizeProp,
  type PropAnchor,
  syncPropAnchors,
} from '../render/champions/assets';
import {
  FORGED_DEFAULT_HEIGHT,
  forgedPropModel,
  guessHandBone,
  loadForgedClipFiles,
  prepareForgedRun,
} from '../render/champions/forged';
import { resolveForgedClips } from '../render/champions/forged_clips';
import type { ChampionClipNames } from '../render/champions/manifest';
import { gripAlignment, HAND_GRIP_AXIS, orientLongAxisY } from '../render/champions/orient';
import {
  DISPLAY_BOUNDS,
  DISPLAY_PROP_KINDS,
  type DisplayPropKind,
  type ForgedDisplay,
  type ForgedDisplayProp,
} from '../sim/forge/display';
import { createAxesOverlay, createWeaponGizmo, type GizmoMode } from './workshop_gizmo';

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
.ws-slider.with-steps { grid-template-columns: 62px 1fr 44px auto; }
.ws-slider label { color: #97854f; font-size: 11px; }
.ws-slider output { color: #d8cdb0; font-size: 11px; text-align: right; }
.ws-slider input[type=range] { width: 100%; accent-color: #c9a84a; margin: 0; }
.ws-steps { display: flex; gap: 2px; }
.ws-step {
  padding: 2px 5px; border-radius: 4px; border: 1px solid #4a3a1c; background: #1a130a;
  color: #d8cdb0; font-size: 10px; cursor: pointer;
}
.ws-step:hover { border-color: #a08030; }
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
  // Weapon family sealed at finalize (informational).
  family?: string | null;
  // The creator's exact clip pick per renderer role (baked names); labels
  // the clip buttons without name guessing when present.
  clips?: Record<string, string> | null;
  // Per-role animation-only GLBs (asset-route URLs) riding beside a
  // rigged model; merged into the playable clip set on load.
  clipFiles?: Record<string, string> | null;
  // The champion's own generated weapon GLB (asset-route URL), when built;
  // unlocks the 'generated' prop kind.
  weaponUrl?: string | null;
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

  // One free orbit in both views: match view only changes the starting
  // vantage (the in-match top-down angle) and shows the grid; dragging
  // still turns around the champion.
  const applyCamera = (): void => {
    const target = new THREE.Vector3(0, matchView ? 0.5 : tuning.height * 0.45, 0);
    camera.position.set(
      target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(target);
  };

  const canvas = renderer.domElement;
  let dragging = false;
  // True while a gizmo handle drags: orbit sleeps, clicks are not picks.
  let gizmoBusy = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    autoSpin = false;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || gizmoBusy) return;
    yaw -= (e.clientX - lastX) * 0.008;
    pitch = Math.min(1.2, Math.max(-0.1, pitch + (e.clientY - lastY) * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    // A still click (no orbit, no gizmo drag) selects or deselects the
    // weapon, editor style.
    if (!gizmoBusy && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) handleStillClick(e);
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

  // The measured facing fix (from the run clip's removed travel), the
  // exact rotation the match applies; the facing slider adjusts on top.
  let autoYaw = 0;

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
    yawGroup.rotation.y = autoYaw + tuning.yawOffset;
  };

  let anchors: PropAnchor[] = [];
  let propHolder: THREE.Group | null = null;
  // Weapon GLBs (the house library or the champion's own generated one),
  // fetched once per url and cloned per rebuild.
  const propScenes = new Map<string, Promise<THREE.Group | null>>();
  const loadPropScene = (url: string): Promise<THREE.Group | null> => {
    let cached = propScenes.get(url);
    if (!cached) {
      cached = new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync(url)
        .then((g) => g.scene)
        .catch(() => null);
      propScenes.set(url, cached);
    }
    return cached;
  };
  // Rebuilds are async (the GLB may still be fetching); the token drops a
  // stale build landing after a newer choice.
  let propBuildToken = 0;
  const rebuildProp = (keepRest: boolean): void => {
    const restInv = keepRest ? (anchors[0]?.restInv ?? null) : null;
    const wasAttached = gizmo?.attached() ?? false;
    gizmo?.detach();
    const token = ++propBuildToken;
    if (propHolder) {
      modelRoot.remove(propHolder);
      propHolder = null;
    }
    anchors = [];
    refreshMarkerBone();
    if (!model || prop.kind === 'none' || prop.bone === '') return;
    const spec = forgedPropModel(prop.kind, tuning.height, subject.weaponUrl ?? null);
    if (!spec) return;
    void loadPropScene(spec.url).then((source) => {
      if (!source || token !== propBuildToken || !model) return;
      const bone = findBone(model, prop.bone);
      if (!bone) return;
      // Long axis up before the wrap (orient.ts): +Y is 'along the
      // blade' for every weapon, generated ones included, and the match
      // renderer applies the exact same normalization.
      const built = normalizeProp(orientLongAxisY(source.clone(true)) as THREE.Group, spec.size);
      built.rotation.set(prop.rot[0], prop.rot[1], prop.rot[2]);
      built.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
      built.scale.setScalar(prop.scale ?? 1);
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
      if (wasAttached) gizmo?.attach(built);
    });
  };

  // Live grip updates (sliders and gizmo both land here): the built prop
  // is retransformed in place, no async rebuild, no gizmo detach.
  const applyPropTuning = (): void => {
    const built = anchors[0]?.prop;
    if (!built) return;
    built.rotation.set(prop.rot[0] ?? 0, prop.rot[1] ?? 0, prop.rot[2] ?? 0);
    built.position.set(prop.pos[0] ?? 0, prop.pos[1] ?? 0, prop.pos[2] ?? 0);
    built.scale.setScalar(prop.scale ?? 1);
  };

  // Assigned by buildWeaponControls once the rows exist; the gizmo calls
  // them to keep the numeric fields honest during a drag.
  let syncWeaponSliders: () => void = () => {};
  let highlightMode: (mode: GizmoMode) => void = () => {};

  const gizmo = createWeaponGizmo({
    camera,
    dom: canvas,
    scene,
    posLimit: DISPLAY_BOUNDS.propOffset.max,
    onChange: (obj) => {
      prop.rot[0] = obj.rotation.x;
      prop.rot[1] = obj.rotation.y;
      prop.rot[2] = obj.rotation.z;
      prop.pos[0] = obj.position.x;
      prop.pos[1] = obj.position.y;
      prop.pos[2] = obj.position.z;
      syncWeaponSliders();
    },
    onDragging: (active) => {
      gizmoBusy = active;
      if (active) dragging = false;
    },
    onModeChange: (mode) => highlightMode(mode),
  });

  const axesOverlay = createAxesOverlay();
  const pickRay = new THREE.Raycaster();
  const ndcOf = (e: PointerEvent): THREE.Vector2 => {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  };
  const tryPickWeapon = (e: PointerEvent): boolean => {
    const built = anchors[0]?.prop ?? null;
    if (!built || !propHolder || subject.editable !== true) return false;
    pickRay.setFromCamera(ndcOf(e), camera);
    if (pickRay.intersectObject(propHolder, true).length === 0) return false;
    gizmo.attach(built);
    return true;
  };

  // --- the rig view: skeleton overlay, mount-bone marker, joint picks ----

  let rigVisible = false;
  let skeletonHelper: THREE.SkeletonHelper | null = null;
  let markerBone: THREE.Object3D | null = null;
  const boneMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 8),
    new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false }),
  );
  boneMarker.renderOrder = 30;
  boneMarker.visible = false;
  scene.add(boneMarker);
  const refreshMarkerBone = (): void => {
    markerBone = model !== null && prop.bone !== '' ? findBone(model, prop.bone) : null;
  };
  const setRigVisible = (on: boolean): void => {
    rigVisible = on;
    if (on && skeletonHelper === null && model) {
      skeletonHelper = new THREE.SkeletonHelper(model);
      // Drawn through the mesh: a skeleton you cannot see is no help.
      (skeletonHelper.material as THREE.LineBasicMaterial).depthTest = false;
      skeletonHelper.renderOrder = 29;
      scene.add(skeletonHelper);
    }
    if (skeletonHelper) skeletonHelper.visible = on;
    refreshMarkerBone();
  };
  // Assigned by buildWeaponControls: a joint pick lands in the bone
  // select like any manual choice.
  let applyBonePick: (name: string) => void = () => {};
  const tryPickJoint = (e: PointerEvent): boolean => {
    if (!rigVisible || !model || subject.editable !== true) return false;
    const rect = canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let bestName: string | null = null;
    // Twist bones overlap the limb they smooth; picking them by click
    // would be noise. The bone select still lists everything.
    let bestD = 14;
    model.traverse((child) => {
      if (!(child as THREE.Bone).isBone || /twist/i.test(child.name)) return;
      child.getWorldPosition(v).project(camera);
      if (v.z >= 1) return;
      const px = ((v.x + 1) / 2) * rect.width + rect.left;
      const py = ((1 - v.y) / 2) * rect.height + rect.top;
      const d = Math.hypot(px - e.clientX, py - e.clientY);
      if (d < bestD) {
        bestD = d;
        bestName = child.name;
      }
    });
    if (bestName === null) return false;
    applyBonePick(bestName);
    return true;
  };

  // --- 'Hold it here': click the weapon where the hand should hold it ---

  let aiming = false;
  let setAimButton: (on: boolean) => void = () => {};
  const setAiming = (on: boolean): void => {
    aiming = on;
    canvas.style.cursor = on ? 'crosshair' : '';
    status.textContent = on ? 'Click the weapon where the hand should hold it.' : '';
    setAimButton(on);
  };
  const tryGripPick = (e: PointerEvent): void => {
    const a = anchors[0];
    if (!a || !propHolder) return;
    pickRay.setFromCamera(ndcOf(e), camera);
    const hit = pickRay.intersectObject(propHolder, true)[0];
    if (!hit) return; // Missed the weapon: stay armed, the player retries.
    const built = a.prop;
    const gripLocal = built.worldToLocal(hit.point.clone());
    // The hand's grip axis: a bone-local constant of the shared rig,
    // taken through the bone's CURRENT orientation into the holder's
    // frame, so the alignment is right in any pose, mid-clip included.
    const rootQ = modelRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
    const boneQ = a.hand.bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ);
    const axisHolder = new THREE.Vector3()
      .copy(HAND_GRIP_AXIS)
      .applyQuaternion(boneQ)
      .applyQuaternion(a.holder.quaternion.clone().invert());
    const fit = gripAlignment(gripLocal, axisHolder, built.scale.x);
    const euler = new THREE.Euler().setFromQuaternion(fit.quaternion, 'XYZ');
    prop.rot[0] = euler.x;
    prop.rot[1] = euler.y;
    prop.rot[2] = euler.z;
    const lim = DISPLAY_BOUNDS.propOffset;
    prop.pos[0] = Math.min(lim.max, Math.max(lim.min, fit.position.x));
    prop.pos[1] = Math.min(lim.max, Math.max(lim.min, fit.position.y));
    prop.pos[2] = Math.min(lim.max, Math.max(lim.min, fit.position.z));
    applyPropTuning();
    syncWeaponSliders();
    setAiming(false);
    gizmo.attach(built);
  };

  const handleStillClick = (e: PointerEvent): void => {
    if (aiming) {
      tryGripPick(e);
      return;
    }
    if (tryPickWeapon(e)) return;
    if (tryPickJoint(e)) return;
    gizmo.detach();
  };

  // --- the model and its clips -------------------------------------------

  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let activeAction: THREE.AnimationAction | null = null;
  let idleClipName = '';
  const clipsPanel = el('div', 'ws-panel');
  clipsPanel.append(el('h3', '', 'Animations'));
  const clipButtons = new Map<string, HTMLButtonElement>();
  const clipBox = el('div', '');
  clipsPanel.append(clipBox);

  // Freezing the pose (playtest: even the idle sway made the weapon a
  // moving target while aligning it). Frozen, the mixer's clock stops
  // and the model holds its current frame; the slider scrubs the frozen
  // clip so the hand is caught at any moment of a swing; a clip button
  // lands on that clip's first frame. Releasing resumes the clips. The
  // controls sit in the Weapon panel, where the grip is fitted (playtest:
  // nobody hunts under Animations while placing a weapon).
  let frozen = false;
  let fadingAction: THREE.AnimationAction | null = null;
  const freezeBtn = el('button', 'ws-btn', 'Freeze the pose') as HTMLButtonElement;
  freezeBtn.title = 'Hold the model still on this frame while you fit the weapon (F)';
  const frameRow = el('div', 'ws-slider');
  const frameInput = document.createElement('input');
  frameInput.type = 'range';
  frameInput.min = '0';
  frameInput.max = '1';
  frameInput.step = '0.01';
  frameInput.value = '0';
  const frameOut = el('output', '', '0.00 s');
  frameRow.append(el('label', '', 'Frame'), frameInput, frameOut);
  frameRow.hidden = true;
  const syncFrameRow = (): void => {
    if (!activeAction) return;
    frameInput.max = String(Math.max(0.01, activeAction.getClip().duration));
    frameInput.value = String(activeAction.time);
    frameOut.textContent = `${activeAction.time.toFixed(2)} s`;
  };
  frameInput.addEventListener('input', () => {
    if (!mixer || !activeAction || !frozen) return;
    activeAction.time = Number(frameInput.value);
    frameOut.textContent = `${activeAction.time.toFixed(2)} s`;
    mixer.update(0);
  });
  const setFrozen = (on: boolean): void => {
    frozen = on;
    freezeBtn.classList.toggle('picked', on);
    freezeBtn.textContent = on ? 'Release the pose' : 'Freeze the pose';
    frameRow.hidden = !on;
    if (!mixer) return;
    mixer.timeScale = on ? 0 : 1;
    if (on) {
      // A crossfade caught midway would hold a blend forever: finish it.
      fadingAction?.stop();
      fadingAction = null;
      if (activeAction) {
        activeAction.stopFading();
        activeAction.weight = 1;
      }
      mixer.update(0);
      syncFrameRow();
    }
  };
  freezeBtn.addEventListener('click', () => setFrozen(!frozen));
  const freezeBox = el('div', '');
  freezeBox.append(freezeBtn, frameRow);

  // Poses the rig on the reference frame (the idle at time zero), reads
  // the rest orientation there, and puts playback back untouched.
  const pinIdleAndCapture = (): void => {
    if (!mixer || anchors.length === 0) return;
    const clip = clips.find((c) => c.name === idleClipName) ?? clips[0];
    if (!clip) return;
    const idle = mixer.clipAction(clip);
    const wasActive = activeAction;
    const wasTime = idle.time;
    const wasWeight = idle.getEffectiveWeight();
    idle.reset().play();
    idle.time = 0;
    idle.setEffectiveWeight(1);
    mixer.update(0);
    captureRestPose(modelRoot, anchors);
    // Back exactly as it was: this must never be visible.
    idle.time = wasTime;
    idle.setEffectiveWeight(wasWeight);
    if (wasActive && wasActive !== idle) {
      idle.stop();
      wasActive.play();
    }
    mixer.update(0);
  };

  const playClip = (name: string): void => {
    if (!mixer) return;
    const clip = clips.find((c) => c.name === name);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    if (frozen) {
      // No crossfade while the clock is stopped: the first frame lands.
      activeAction?.stop();
      action.reset().play();
    } else {
      activeAction?.fadeOut(0.15);
      fadingAction = activeAction;
      action.reset().fadeIn(0.15).play();
    }
    activeAction = action;
    for (const [n, b] of clipButtons) b.classList.toggle('picked', n === name);
    if (frozen) {
      mixer.update(0);
      syncFrameRow();
    }
  };

  const buildClipButtons = (): void => {
    // Friendly labels first (Idle, Run, Attack...): the creator's exact
    // picks when the model carries them, name matching as the fallback
    // (models sealed before per-clip picks); unmatched clips keep their
    // raw names.
    const resolved = resolveForgedClips(clips.map((c) => c.name));
    const picked = subject.clips ?? null;
    const roleName = (role: keyof ChampionClipNames): string | undefined => {
      const want = picked?.[role];
      if (want !== undefined && clips.some((c) => c.name === want)) return want;
      return resolved?.[role];
    };
    // The run cycle plays on the spot here exactly as it will in match,
    // and the direction it traveled sets the model's true forward (the
    // same measured fix the match applies). Measured with the facing
    // slider zeroed so the saved tuning cannot pollute the reading.
    const runName = roleName('run');
    const runClip = runName !== undefined ? clips.find((c) => c.name === runName) : undefined;
    if (runClip && model) {
      // Measured with the facing slider zeroed so the saved tuning
      // cannot pollute the reading; when the match already stripped and
      // measured this very clip object, the stored fix comes back.
      const idleName = roleName('idle');
      const idleClip = idleName !== undefined ? clips.find((c) => c.name === idleName) : undefined;
      const prevYaw = yawGroup.rotation.y;
      yawGroup.rotation.y = 0;
      const fix = prepareForgedRun(model, runClip, idleClip, rawHeight);
      yawGroup.rotation.y = prevYaw;
      if (fix !== null) {
        autoYaw = fix;
        applyModelTuning();
      }
    }
    const labeled = new Map<string, string>();
    for (const { role, label } of CLIP_LABELS) {
      const name = roleName(role);
      if (name !== undefined && !labeled.has(name)) labeled.set(name, label);
    }
    for (const clip of clips) {
      if (!labeled.has(clip.name)) labeled.set(clip.name, clip.name);
    }
    for (const [name, label] of labeled) {
      const btn = el('button', 'ws-btn', label) as HTMLButtonElement;
      btn.title = name;
      btn.addEventListener('click', () => playClip(name));
      clipButtons.set(name, btn);
      clipBox.append(btn);
    }
    if (clips.length === 0) {
      clipBox.append(el('div', 'ws-note', 'This model carries no animation clips.'));
    }
    idleClipName = roleName('idle') ?? clips[0]?.name ?? '';
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
      // The rig toggle may have been armed while the model still loaded.
      if (rigVisible) setRigVisible(true);
      const rig = model;
      // A per-clip-baked champion keeps its animations in files beside
      // the rigged body; merge them before the buttons build.
      const extra =
        subject.clipFiles && Object.keys(subject.clipFiles).length > 0
          ? loadForgedClipFiles(subject.clipFiles, subject.clips ?? null)
          : Promise.resolve([]);
      void extra.then((loaded) => {
        mixer = new THREE.AnimationMixer(rig);
        mixer.timeScale = frozen ? 0 : 1;
        clips = [...gltf.animations, ...loaded];
        buildClipButtons();
      });
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
          // The weapon scales with the champion.
          rebuildProp(true);
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
        freezeBox,
      );
      return;
    }
    // No bones, nowhere to hang anything: a model that has not been
    // rigged yet gets the reason instead of an empty bone list. Only once
    // it is actually loaded: an empty list before that is just a load in
    // flight.
    if (model !== null && boneNames.length === 0) {
      weaponControls.append(
        el(
          'div',
          'ws-note',
          'This model has no skeleton, so there is no hand to hold a weapon. It was built ' +
            'before builds rigged: bake its animations once in the Forge (Step 5), which ' +
            'rigs it, then come back and place the weapon here.',
        ),
        freezeBox,
      );
      return;
    }
    const kindSelect = el('select', 'ws-select') as HTMLSelectElement;
    // Real 3D weapon models only: the roster's generated ones, plus the
    // champion's own forged weapon once it exists.
    const propLabels: Record<DisplayPropKind, string> = {
      none: 'No weapon',
      maul: 'Siege maul (Korrath)',
      shield: 'Tower shield (Korrath)',
      rifle: 'Long rifle (Vesk)',
      generated: 'My forged weapon',
    };
    for (const k of DISPLAY_PROP_KINDS) {
      if (k === 'generated' && !subject.weaponUrl) continue;
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = propLabels[k];
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
    applyBonePick = (name) => {
      prop.bone = name;
      boneSelect.value = name;
      rebuildProp(false);
    };
    weaponControls.append(kindSelect, boneSelect);

    // 'Hold it here' is the fast path: arm it, click the weapon where
    // the hand should hold it, and the grip snaps into the fist with the
    // blade along the hand's grip axis (orient.ts does the math).
    const holdBtn = el('button', 'ws-btn', 'Hold it here') as HTMLButtonElement;
    holdBtn.addEventListener('click', () => setAiming(!aiming));
    setAimButton = (on) => holdBtn.classList.toggle('picked', on);

    // The gizmo toolbar: the editor-grade path to the same numbers. A
    // click arms the gizmo on the weapon when nothing was selected yet.
    const modeBar = el('div', '');
    modeBar.append(holdBtn);
    const modeButtons = new Map<GizmoMode, HTMLButtonElement>();
    const modeDefs: readonly [GizmoMode, string][] = [
      ['translate', 'Move (G)'],
      ['rotate', 'Rotate (R)'],
    ];
    for (const [mode, label] of modeDefs) {
      const btn = el('button', 'ws-btn', label) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        const built = anchors[0]?.prop;
        if (built && !gizmo.attached()) gizmo.attach(built);
        gizmo.setMode(mode);
      });
      modeButtons.set(mode, btn);
      modeBar.append(btn);
    }
    highlightMode = (mode) => {
      for (const [m, b] of modeButtons) b.classList.toggle('picked', m === mode);
    };
    highlightMode('translate');

    // Slider rows that the gizmo can write back into: same numbers, two
    // hands on them.
    const weaponSetters = new Map<string, (v: number) => void>();
    const syncedRow = (
      key: string,
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
      row.append(el('label', '', label), input, out);
      weaponSetters.set(key, (v) => {
        input.value = String(v);
        out.textContent = format(v);
      });
      return row;
    };
    syncWeaponSliders = () => {
      for (let i = 0; i < 3; i++) {
        weaponSetters.get(`rot${i}`)?.(((prop.rot[i] ?? 0) * 180) / Math.PI);
        weaponSetters.get(`pos${i}`)?.(prop.pos[i] ?? 0);
      }
      weaponSetters.get('size')?.(prop.scale ?? 1);
    };
    // Size sits right under the selectors, alone: the one number the
    // gizmo does not touch (playtest: scaling by axis handles felt
    // wrong, a slider like the champion's Height is the way).
    weaponControls.append(
      syncedRow(
        'size',
        'Size',
        DISPLAY_BOUNDS.propScale.min,
        DISPLAY_BOUNDS.propScale.max,
        0.05,
        prop.scale ?? 1,
        (v) => `${v.toFixed(2)}x`,
        (v) => {
          prop.scale = v;
          applyPropTuning();
        },
      ),
    );
    // The frozen pose first, then the grip tools: a still hand is what
    // the tools below are aimed at.
    weaponControls.append(freezeBox, modeBar);
    // Quarter turns compose about the corner marker's axes, exactly like
    // the world-space rotate rings, so 'turn it 90 about X' means the
    // same thing everywhere.
    const quarter = (axisIndex: number, dir: 1 | -1): void => {
      const axis = new THREE.Vector3();
      axis.setComponent(axisIndex, 1);
      const turned = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(prop.rot[0], prop.rot[1], prop.rot[2]))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (dir * Math.PI) / 2));
      const euler = new THREE.Euler().setFromQuaternion(turned, 'XYZ');
      prop.rot[0] = euler.x;
      prop.rot[1] = euler.y;
      prop.rot[2] = euler.z;
      applyPropTuning();
      syncWeaponSliders();
    };
    const axes = ['X', 'Y', 'Z'] as const;
    for (let i = 0; i < 3; i++) {
      const row = syncedRow(
        `rot${i}`,
        `Turn ${axes[i]}`,
        -180,
        180,
        1,
        ((prop.rot[i] ?? 0) * 180) / Math.PI,
        (v) => `${Math.round(v)}`,
        (v) => {
          prop.rot[i] = (v * Math.PI) / 180;
          applyPropTuning();
        },
      );
      row.classList.add('with-steps');
      const steps = el('span', 'ws-steps');
      for (const dir of [-1, 1] as const) {
        const btn = el('button', 'ws-step', dir === 1 ? '+90' : '-90');
        btn.addEventListener('click', () => quarter(i, dir));
        steps.append(btn);
      }
      row.append(steps);
      weaponControls.append(row);
    }
    for (let i = 0; i < 3; i++) {
      weaponControls.append(
        syncedRow(
          `pos${i}`,
          `Slide ${axes[i]}`,
          DISPLAY_BOUNDS.propOffset.min,
          DISPLAY_BOUNDS.propOffset.max,
          0.01,
          prop.pos[i] ?? 0,
          (v) => v.toFixed(2),
          (v) => {
            prop.pos[i] = v;
            applyPropTuning();
          },
        ),
      );
    }
    const resetBtn = el('button', 'ws-btn', 'Reset grip');
    resetBtn.addEventListener('click', () => {
      prop.rot[0] = 0;
      prop.rot[1] = 0;
      prop.rot[2] = 0;
      prop.pos[0] = 0;
      prop.pos[1] = 0;
      prop.pos[2] = 0;
      prop.scale = 1;
      applyPropTuning();
      syncWeaponSliders();
    });
    weaponControls.append(resetBtn);
    weaponControls.append(
      el(
        'div',
        'ws-note',
        'Freeze the pose (F) to stop the idle sway; the Frame slider then holds the ' +
          'hand at any moment of a clip. Hold it here, then click the weapon where the ' +
          'hand should hold it: the grip snaps into the fist, blade along the hand. Or ' +
          'grab the weapon with a click and drag the arrows and rings (G move, R rotate, ' +
          'hold Ctrl to snap, Escape to release); the corner marker names the axes. ' +
          'Play Attack to check the swing.',
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
          ...(prop.scale !== undefined ? { scale: prop.scale } : {}),
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
    // Each view starts from its own vantage (match: the in-game top-down
    // angle) and stays freely orbitable from there.
    pitch = match ? 1.04 : 0.32;
    dist = match ? 13.4 : 6.2;
    if (match) autoSpin = false;
    podiumBtn.classList.toggle('picked', !match);
    matchBtn.classList.toggle('picked', match);
  };
  podiumBtn.addEventListener('click', () => setView(false));
  matchBtn.addEventListener('click', () => setView(true));
  const rigBtn = el('button', 'ws-btn', 'Show the rig');
  rigBtn.addEventListener('click', () => {
    setRigVisible(!rigVisible);
    rigBtn.classList.toggle('picked', rigVisible);
  });
  viewPanel.append(podiumBtn, matchBtn, rigBtn);
  viewPanel.append(
    el(
      'div',
      'ws-note',
      'Drag to orbit, wheel to zoom, in both views. Match view shows one map unit per cell. ' +
        'Show the rig draws the skeleton with the weapon bone marked; with it on, click a ' +
        'joint to hang the weapon there.',
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
    if (autoSpin && !matchView) yaw += dt * 0.35;
    mixer?.update(dt);
    // The grip's rest orientation is captured once the idle pose has
    // settled, in-match style, so the weapon swings with the hand during
    // attack clips instead of staying frozen.
    if (anchors.length > 0) {
      // One fixed reference frame, taken once: the idle at time zero. The
      // clip is pinned there, the pose read, and playback put back where
      // it was, so the grip a creator fits is read against the same rest
      // in every session instead of against whatever frame the wall clock
      // happened to land on (which is why a saved weapon moved).
      if (anchors[0]?.restInv === undefined || anchors[0]?.restInv === null) {
        pinIdleAndCapture();
      }
      syncPropAnchors(modelRoot, anchors, false);
    }
    // The mount-bone marker follows its joint (bones scale strangely on
    // these rigs, so it tracks by world position, never parents).
    boneMarker.visible = rigVisible && markerBone !== null;
    if (rigVisible && markerBone) markerBone.getWorldPosition(boneMarker.position);
    applyCamera();
    renderer.render(scene, camera);
    axesOverlay.render(renderer, camera);
  };
  resize();
  loop();

  const close = (): void => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('keydown', onKey);
    gizmo.dispose();
    renderer.dispose();
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    // Escape unwinds one layer at a time: the grip aim first, then the
    // gizmo selection, and only then the workshop itself.
    if (e.key === 'Escape' && aiming) {
      setAiming(false);
      return;
    }
    if (gizmo.handleKey(e)) return;
    if (e.key === 'Escape') close();
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setFrozen(!frozen);
    }
  };
  window.addEventListener('keydown', onKey);
  back.addEventListener('click', close);
}
