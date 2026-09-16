// Geometry and growth poses exported from Sylra's Blender reference.
// The simulation owns targets, lifetime and damage; these are visual only.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHAMPION_VISUALS } from '../champions/manifest';
import { flatDisc, flatRing } from './shapes';
import type { VfxSystem } from './system';

const SAP = 0x39c768;
const POLLEN = 0xb3e447;
const GLOW = 0xc8ff9a;
const SOURCE_RADIUS = 0.76;
// The witch's file stands 1.095 source metres, staff included (measured by
// scripts/export_sylra.py), and the manifest height is what that becomes.
const SOURCE_HEIGHT = 1.095;
// One source metre in world units, so effects authored around her body
// scale with her and follow the manifest when her height moves.
export const CHARACTER_SCALE = (CHAMPION_VISUALS.sylra?.height ?? 4.35) / SOURCE_HEIGHT;
// The overgrowth's warning circle in the source, measured by the export.
const OVERGROWTH_RADIUS = 1.1025;
const FPS = 24;
let fieldTemplate: THREE.Group | undefined;
let seedTemplate: THREE.Group | undefined;
let boltTemplate: THREE.Group | undefined;
let shellTemplate: THREE.Group | undefined;
let overgrowthTemplate: THREE.Group | undefined;
let loading: Promise<void> | undefined;

export function preloadSylraEffects(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const load = (file: string, keep: (scene: THREE.Group) => void) =>
    loader.loadAsync(`/models/effects/${file}`).then((g) => keep(g.scene));
  loading = Promise.all([
    load('sylra_bramble.glb', (s) => {
      fieldTemplate = s;
    }),
    load('sylra_attack_seed.glb', (s) => {
      seedTemplate = s;
    }),
    load('sylra_thorn_bolt.glb', (s) => {
      boltTemplate = s;
    }),
    load('sylra_verdant_shell.glb', (s) => {
      shellTemplate = s;
    }),
    load('sylra_overgrowth.glb', (s) => {
      overgrowthTemplate = s;
    }),
  ])
    .then(() => {})
    .catch((error: unknown) => {
      console.warn('Sylra effects failed to load:', error);
    });
  return loading;
}

function cloneEffect(template: THREE.Group): THREE.Group {
  const group = template.clone(true);
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.userData.sharedGeo = true;
    node.frustumCulled = false;
    node.material = Array.isArray(node.material)
      ? node.material.map((m) => m.clone())
      : node.material.clone();
  });
  return group;
}

export function growthAt(frame: number, start: number): number {
  const t = THREE.MathUtils.clamp((frame - start) / 14, 0, 1);
  return t * t * (3 - 2 * t);
}

// Blender's absolute shape-key interpolation expressed as relative weights.
export function setMorphPose(root: THREE.Object3D, pose: number): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const weights = mesh.morphTargetInfluences;
    const names = mesh.morphTargetDictionary;
    if (!weights || !names) return;
    weights.fill(0);
    const first = Math.floor(pose);
    const a = names[`Pose_${String(first).padStart(2, '0')}`];
    const b = names[`Pose_${String(first + 1).padStart(2, '0')}`];
    if (a !== undefined) weights[a] = b === undefined ? 1 : 1 - (pose - first);
    if (b !== undefined) weights[b] = pose - first;
  });
}

interface FieldState {
  parts: THREE.Object3D[];
  loaded: boolean;
  lastPulse: number;
  hostile: boolean;
}
const fields = new WeakMap<THREE.Object3D, FieldState>();

export function buildBrambleField(radius: number, hostile: boolean): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Sylra_BrambleField';
  // The gameplay boundary remains readable even during the opening gesture.
  root.add(flatRing(radius - 0.055, radius + 0.035, hostile ? 0xff794e : SAP, 0.55, 0.015));
  root.add(flatDisc(radius, 0x123c1e, 0.18, 0.005));
  fields.set(root, { parts: [], loaded: false, lastPulse: -1, hostile });
  void preloadSylraEffects();
  attachField(root, radius);
  return root;
}

function attachField(root: THREE.Object3D, radius: number): void {
  const state = fields.get(root);
  if (!state || state.loaded || !fieldTemplate) return;
  const model = cloneEffect(fieldTemplate);
  model.scale.setScalar(radius / SOURCE_RADIUS);
  model.traverse((node) => {
    if (typeof node.userData.effectKind === 'string') state.parts.push(node);
  });
  root.add(model);
  state.loaded = true;
}

export function tickBrambleField(root: THREE.Object3D, radius: number, ageMs: number): void {
  attachField(root, radius);
  const state = fields.get(root);
  if (!state) return;
  const frame = Math.min(108, 1 + (ageMs * 24) / 1000);
  for (const part of state.parts) {
    const kind = part.userData.effectKind as string;
    if (kind === 'bramble') {
      const start = part.userData.growthStart as number;
      setMorphPose(part, 8 * growthAt(frame, start));
      part.rotation.z = 0.018 * Math.sin(frame * 0.13 + start);
    } else if (kind === 'pollen' || kind === 'petals') {
      setMorphPose(part, (frame - 1) / 3);
    } else {
      const start = kind === 'seed' ? 18 : 12;
      part.visible = frame >= start;
      // Roots unfurl below the independently growing stems.
      part.scale.setScalar(Math.max(0.001, growthAt(frame, start)));
    }
  }
}

export function bramblePulse(
  fx: VfxSystem,
  root: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  ageMs: number,
): void {
  const state = fields.get(root);
  if (!state || ageMs < 460) return;
  const beat = Math.floor((ageMs - 460) / 500);
  if (beat === state.lastPulse) return;
  state.lastPulse = beat;
  fx.rings.spawn(x, z, radius * 0.98, SAP, 500, { alpha: 0.3 });
  if (beat === 0) fx.lightPulse(x, z, SAP, 8, 450);
}

export function buildAttackSeed(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Sylra_AttackSeed';
  root.userData.stretch = false;
  if (seedTemplate) {
    const seed = cloneEffect(seedTemplate);
    seed.scale.setScalar(2.33);
    seed.rotation.z = -Math.PI / 2;
    root.add(seed);
  } else {
    const seed = new THREE.Mesh(
      new THREE.ConeGeometry(0.065, 0.34, 7),
      new THREE.MeshBasicMaterial({ color: POLLEN }),
    );
    seed.rotation.z = -Math.PI / 2;
    root.add(seed);
    void preloadSylraEffects();
  }
  return root;
}

export function attackSeedImpact(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1, z, 0.7, SAP, 0.14);
  fx.sparkBurst(x, 1, z, POLLEN, 12, 3.3, { life: 0.28, size: 0.12, gravity: 4 });
  fx.rings.spawn(x, z, 0.4, SAP, 240, { alpha: 0.4 });
}

// ------------------------------------------------------- shared helpers

// Smoothstep over a frame window, the source's own easing.
export function ramp(frame: number, start: number, frames: number): number {
  const t = THREE.MathUtils.clamp((frame - start) / frames, 0, 1);
  return t * t * (3 - 2 * t);
}

// The morph pose of a burst mesh at a source frame: Pose_00 is the
// collapsed first key, then one pose a frame from `poseStart`, held at the
// last one. Fractional frames blend two poses (setMorphPose).
export function burstPose(frame: number, poseStart: number, poses: number): number {
  return THREE.MathUtils.clamp(frame - poseStart + 1, 0, poses);
}

// One node of a template cloned on its own, with its own materials (the
// template's geometry stays shared) and its extras.
function cloneNode(node: THREE.Object3D): THREE.Object3D | undefined {
  const parent = node.parent;
  const wrapper = new THREE.Group();
  wrapper.add(node);
  const clone = cloneEffect(wrapper).children[0];
  wrapper.remove(node);
  if (parent) parent.add(node);
  if (clone) clone.userData = { ...node.userData };
  return clone;
}

// The first node of a template tagged with an effect kind, cloned.
function cloneKind(template: THREE.Group, kind: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  template.traverse((node) => {
    if (!found && node.userData.effectKind === kind) found = node;
  });
  return found ? cloneNode(found) : undefined;
}

// A template node by its name, cloned.
function cloneNamed(template: THREE.Group, name: string): THREE.Object3D | undefined {
  const found = template.getObjectByName(name);
  return found ? cloneNode(found) : undefined;
}

function setOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = opacity;
    }
  });
}

// ------------------------------------------------------- Q: thorn bolt

// The thorn of the reference, authored along +Z in Blender (+Y in the
// file), laid down the flight axis. A cone stands in until the file lands.
export function buildThornBolt(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Sylra_ThornBolt';
  root.userData.stretch = false;
  const bolt = boltTemplate ? cloneKind(boltTemplate, 'bolt') : undefined;
  if (bolt) {
    bolt.scale.setScalar(CHARACTER_SCALE);
    bolt.rotation.z = -Math.PI / 2;
    root.add(bolt);
  } else {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.75, 7),
      new THREE.MeshBasicMaterial({ color: POLLEN }),
    );
    cone.rotation.z = -Math.PI / 2;
    root.add(cone);
    void preloadSylraEffects();
  }
  return root;
}

// The hit: the reference's burst expands through its poses at chest height
// (19 frames), over a flash, pollen and a ground ring.
export function thornBoltImpact(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1.1, z, 1.6, GLOW, 0.2);
  fx.sparkBurst(x, 1.0, z, POLLEN, 10, 4, { life: 0.35, size: 0.2, gravity: 6 });
  fx.rings.spawn(x, z, 0.7, SAP, 420, { alpha: 0.5 });
  fx.lightPulse(x, z, SAP, 7, 380);
  const burst = boltTemplate ? cloneKind(boltTemplate, 'burst') : undefined;
  if (!burst) return;
  burst.scale.setScalar(CHARACTER_SCALE);
  burst.position.set(x, fx.groundAt(x, z) + 1.1, z);
  const start = burst.userData.poseStart as number;
  fx.timed.attach(burst, 780, (age) => {
    setMorphPose(burst, burstPose(start + (age * FPS) / 1000, start, 19));
  });
}

// ---------------------------------------------------- E: verdant shell

// The shell around its holder: the membrane, the veins and the leaves of
// the reference, closed over eight frames once the cast lands. A plain
// translucent dome stands in until the file lands.
export function buildVerdantShell(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Sylra_VerdantShell';
  const membrane = shellTemplate ? cloneKind(shellTemplate, 'membrane') : undefined;
  if (membrane && shellTemplate) {
    membrane.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      // The source membrane is a fresnel mix of sap and glass; the match
      // reads it as a soft additive dome.
      mesh.material = new THREE.MeshBasicMaterial({
        color: SAP,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      mesh.renderOrder = 3;
    });
    root.add(membrane);
    // Both vein layers wear the same tag; each is cloned by name.
    for (const name of ['Sylra_ShellVeins', 'Sylra_ShellLeaves']) {
      const clone = cloneNamed(shellTemplate, name);
      if (clone) root.add(clone);
    }
  } else {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 18, 12),
      new THREE.MeshBasicMaterial({
        color: SAP,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    dome.position.y = 0.55;
    root.add(dome);
    void preloadSylraEffects();
  }
  root.scale.setScalar(0.01);
  return root;
}

// Closes over the source's eight frames, breathes, and swells in the
// quarter second before it goes (the reference's 72 to 78).
export function tickVerdantShell(root: THREE.Object3D, ageMs: number, remainingMs: number): void {
  const frame = 12 + (ageMs * FPS) / 1000;
  let s = ramp(frame, 12, 8);
  if (remainingMs < 250) s *= 1 + 0.15 * (1 - Math.max(0, remainingMs) / 250);
  s = Math.max(0.01, s) * CHARACTER_SCALE;
  root.scale.set(s, s * (1 + 0.02 * Math.sin(ageMs * 0.006)), s);
}

// The cast beat at the caster: the formation ring and the light.
export function verdantShellCast(fx: VfxSystem, x: number, z: number): void {
  fx.rings.spawn(x, z, 1.25, SAP, 620, { alpha: 0.55 });
  fx.glowFlash(x, 1.3, z, 1.8, GLOW, 0.22);
  fx.lightPulse(x, z, SAP, 6, 380);
}

// The shell going, by break or expiry: the shards burst through their
// poses and fourteen thorns fly out of the shell over eight frames, on a
// wave, a flash and the light.
export function verdantShellBurst(fx: VfxSystem, x: number, z: number): void {
  fx.rings.spawn(x, z, 1.9, POLLEN, 480, { alpha: 0.55 });
  fx.glowFlash(x, 1.3, z, 2.4, GLOW, 0.24);
  fx.sparkBurst(x, 1.2, z, POLLEN, 12, 5, { life: 0.4, size: 0.2, gravity: 5 });
  fx.lightPulse(x, z, SAP, 9, 420);
  if (!shellTemplate) return;
  const y = fx.groundAt(x, z);
  const shards = cloneKind(shellTemplate, 'burst');
  if (shards) {
    shards.scale.setScalar(CHARACTER_SCALE);
    shards.position.set(x, y, z);
    const start = shards.userData.poseStart as number;
    fx.timed.attach(shards, 1080, (age) => {
      setMorphPose(shards, burstPose(start + (age * FPS) / 1000, start, 26));
    });
  }
  const thorn = cloneKind(shellTemplate, 'thorn');
  if (!thorn) return;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const up = new THREE.Vector3(0, 1, 0);
  const flights: { holder: THREE.Object3D; dir: THREE.Vector3 }[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0.12 * Math.sin(i * 2.4), Math.sin(a)).normalize();
    const holder = new THREE.Group();
    const copy = i === 0 ? thorn : thorn.clone();
    copy.quaternion.setFromUnitVectors(up, dir);
    copy.scale.setScalar(CHARACTER_SCALE);
    holder.add(copy);
    group.add(holder);
    flights.push({ holder, dir });
  }
  const from = 0.35 * CHARACTER_SCALE;
  const to = 0.83 * CHARACTER_SCALE;
  const height = 0.57 * CHARACTER_SCALE;
  fx.timed.attach(group, 420, (age) => {
    const t = Math.min(1, age / 333);
    const r = from + (to - from) * t;
    const fade = age < 333 ? 1 : Math.max(0.01, 1 - (age - 333) / 87);
    for (const f of flights) {
      f.holder.position.set(f.dir.x * r, height + f.dir.y * r, f.dir.z * r);
      f.holder.scale.setScalar(fade);
    }
  });
}

// ------------------------------------------------------ R: overgrowth

interface OvergrowthTelegraph {
  ring?: THREE.Object3D;
  sap?: THREE.Object3D;
  seed?: THREE.Object3D;
  loaded: boolean;
  radius: number;
}
const telegraphs = new WeakMap<THREE.Object3D, OvergrowthTelegraph>();

// The warning: the readable rim every telegraph gets, then the reference's
// ring, its sap converging on the center and the primal seed rising there
// over the fuse.
export function buildOvergrowthTelegraph(radius: number, hostile: boolean): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Sylra_Overgrowth';
  root.add(flatRing(radius - 0.5, radius + 0.12, 0x0a0a0a, 0.5, 0.09));
  const rim = flatRing(radius - 0.3, radius, hostile ? 0xff7a4a : SAP, 0.9, 0.1);
  root.add(rim);
  root.userData.rim = rim;
  root.add(flatDisc(radius, SAP, 0.12, 0.08));
  telegraphs.set(root, { loaded: false, radius });
  void preloadSylraEffects();
  attachTelegraph(root);
  return root;
}

function attachTelegraph(root: THREE.Object3D): void {
  const state = telegraphs.get(root);
  if (!state || state.loaded || !overgrowthTemplate) return;
  const model = new THREE.Group();
  model.scale.setScalar(state.radius / OVERGROWTH_RADIUS);
  state.ring = cloneKind(overgrowthTemplate, 'ring');
  state.sap = cloneKind(overgrowthTemplate, 'sap');
  state.seed = cloneKind(overgrowthTemplate, 'seed');
  for (const part of [state.ring, state.sap, state.seed]) {
    if (!part) continue;
    part.scale.setScalar(0.01);
    model.add(part);
  }
  if (state.sap) setOpacity(state.sap, 0);
  root.add(model);
  state.loaded = true;
}

export function tickOvergrowthTelegraph(
  fx: VfxSystem,
  root: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  ageMs: number,
): void {
  attachTelegraph(root);
  const rim = root.userData.rim as THREE.Mesh | undefined;
  if (rim) {
    const mat = rim.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.82 + 0.18 * Math.sin(ageMs * (0.008 + Math.min(1, ageMs / 1250) * 0.02));
  }
  const state = telegraphs.get(root);
  // The zone appears on the cast, the source's frame 12.
  const frame = 12 + (ageMs * FPS) / 1000;
  if (state?.ring) state.ring.scale.setScalar(Math.max(0.01, ramp(frame, 11, 4)));
  if (state?.seed) state.seed.scale.setScalar(Math.max(0.01, ramp(frame, 12, 26)));
  if (state?.sap) {
    state.sap.scale.setScalar(1);
    setOpacity(state.sap, ramp(frame, 12, 26));
  }
  if (ageMs < 60) fx.lightPulse(x, z, SAP, 6, 1300);
  if (Math.random() < 0.5) return;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radius;
  fx.particles.spawn({
    x: x + Math.cos(a) * r,
    y: 0.2,
    z: z + Math.sin(a) * r,
    vy: 1.8 + Math.random(),
    life: 0.5,
    size0: 0.28,
    size1: 0.1,
    color0: GLOW,
    alpha0: 0.8,
    sprite: 3,
  });
}

// The eruption, the reference's frames 42 to 100: sixteen giant roots in
// three beats push through their poses over nine frames and sink back
// after 80, the torn roots and glowing cracks spread with them, the pollen
// bursts up and the spores fall, over the waves, the debris and the light.
export function overgrowthDetonate(fx: VfxSystem, x: number, z: number, radius: number): void {
  fx.glowFlash(x, 1, z, radius * 1.2, GLOW, 0.28);
  fx.sparkBurst(x, 0.6, z, POLLEN, 20, 9, { life: 0.6, up: 11 });
  fx.debris.burst(x, z, 0x2e5a28, 11, { speed: 6, up: 10, size: 0.2 });
  fx.rings.spawn(x, z, radius * 1.05, POLLEN, 520);
  fx.schedule(200, () => fx.rings.spawn(x, z, radius * 1.25, SAP, 600, { alpha: 0.5 }));
  fx.decals.spawn(x, z, radius, 'cracks', 6000, { alpha: 0.7 });
  fx.lightPulse(x, z, SAP, 20, 900);
  fx.onShake(0.3);
  if (!overgrowthTemplate) return;
  const model = new THREE.Group();
  model.position.set(x, fx.groundAt(x, z), z);
  model.scale.setScalar(radius / OVERGROWTH_RADIUS);
  const roots: { part: THREE.Object3D; beat: number }[] = [];
  const spreads: THREE.Object3D[] = [];
  const bursts: { part: THREE.Object3D; start: number; poses: number }[] = [];
  for (const name of ['Sylra_GiantRoots_0', 'Sylra_GiantRoots_1', 'Sylra_GiantRoots_2']) {
    const part = cloneNamed(overgrowthTemplate, name);
    if (!part) continue;
    roots.push({ part, beat: part.userData.beat as number });
    model.add(part);
  }
  for (const kind of ['roots', 'cracks']) {
    const part = cloneKind(overgrowthTemplate, kind);
    if (!part) continue;
    spreads.push(part);
    model.add(part);
  }
  for (const [name, poses] of [
    ['Sylra_OvergrowthPollen', 34],
    ['Sylra_OvergrowthSpores', 27],
  ] as const) {
    const part = cloneNamed(overgrowthTemplate, name);
    if (!part) continue;
    bursts.push({ part, start: part.userData.poseStart as number, poses });
    model.add(part);
  }
  fx.timed.attach(model, 2420, (age) => {
    const frame = 42 + (age * FPS) / 1000;
    const sink = ramp(frame, 80, 20);
    for (const { part, beat } of roots) {
      const grow = ramp(frame, 42 + beat, 3);
      part.scale.setScalar(Math.max(0.01, grow * (1 - sink)));
      setMorphPose(part, 8 * ramp(frame, 42 + beat, 9) * (1 - ramp(frame, 80, 19)));
    }
    for (const part of spreads) {
      part.scale.setScalar(Math.max(0.01, ramp(frame, 42, 7) * (1 - sink)));
    }
    for (const { part, start, poses } of bursts) {
      part.visible = frame >= start;
      setMorphPose(part, burstPose(frame, start, poses));
    }
  });
}
