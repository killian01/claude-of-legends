// Elowen's authored spell effects: the five files modelled in Blender and
// exported by scripts/export_elowen_effects.py (the auto's wisp, the lance,
// the veil, the step, the whiteout). Every part carries its extras (effectKind, poses,
// spin) and every material its blend mode; this module clones them, grows
// them through their poses at the source's 24 fps, spins and bobs them,
// fades them out, and adds a few light accents. The simulation owns
// targets, timing and damage; every hook here is presentation only.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ELOWEN } from '../../sim/content/champions/elowen';
import { CHAMPION_VISUALS } from '../champions/manifest';
import { flatDisc, flatRing } from './shapes';
import { ramp } from './sylra_fx';
import type { VfxSystem } from './system';

// The accents' palette: the pale light the mist gives off and its body.
export const MIST = { light: 0xdff2ff, body: 0xbfe8ff } as const;

// The blink's true reach: the kit's own E range, so the arrival lands
// where she does.
export const BLINK_RANGE = ELOWEN.abilities.E.castRange;

// Her file stands 1.055 source metres to the halo (scripts/export_elowen.py)
// and the manifest height is what that becomes: one source metre in world
// units, so the effects authored around her body follow her height.
const SOURCE_HEIGHT = 1.055;
export const CHARACTER_SCALE = (CHAMPION_VISUALS.elowen?.height ?? 4.2) / SOURCE_HEIGHT;
// The zones' authored radii in source metres (the export report).
const VEIL_SOURCE_RADIUS = 0.879;
const WHITEOUT_SOURCE_RADIUS = 1.256;

export const FPS = 24;
// A zone fades over its last beats; the sim's durations say when.
export const ZONE_FADE_MS = 400;
function zoneDurationMs(key: 'W' | 'R'): number {
  const spec = ELOWEN.abilities[key].spec;
  return spec.kind === 'zone' ? spec.duration * 1000 : 0;
}
export const VEIL_MS = zoneDurationMs('W');
export const WHITEOUT_MS = zoneDurationMs('R');
// The impact: the petals and the wave grow through their poses, then fade.
export const IMPACT = { fadeMs: 250, lifeMs: 850 } as const;
// The step is a blink: the same flash at both ends (a quarter second of
// growth, then a fade), the arrival one beat after the departure, and the
// streak between them laid at chest height (in source metres), gone in a
// third of a second.
export const STEP = {
  fadeMs: 160,
  lifeMs: 420,
  arrivalDelayMs: 90,
  trailMs: 340,
  trailHoldMs: 120,
  height: 0.55,
} as const;
// The auto's impact: the petals burst through their poses, then fade, at
// the height the wisp flew.
export const WISP = { fadeMs: 160, lifeMs: 520, impactY: 1.1 } as const;

let wispTemplate: THREE.Group | undefined;
let lanceTemplate: THREE.Group | undefined;
let veilTemplate: THREE.Group | undefined;
let stepTemplate: THREE.Group | undefined;
let whiteoutTemplate: THREE.Group | undefined;
let loading: Promise<void> | undefined;

export function preloadElowenEffects(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const load = (file: string, keep: (scene: THREE.Group) => void) =>
    loader.loadAsync(`/models/effects/${file}`).then((g) => keep(g.scene));
  loading = Promise.all([
    load('elowen_attack_wisp.glb', (s) => {
      wispTemplate = s;
    }),
    load('elowen_mist_lance.glb', (s) => {
      lanceTemplate = s;
    }),
    load('elowen_veil.glb', (s) => {
      veilTemplate = s;
    }),
    load('elowen_step.glb', (s) => {
      stepTemplate = s;
    }),
    load('elowen_whiteout.glb', (s) => {
      whiteoutTemplate = s;
    }),
  ])
    .then(() => {})
    .catch((error: unknown) => {
      console.warn('Elowen effects failed to load:', error);
    });
  return loading;
}

// ------------------------------------------------------- pose and clock

// The file's morph convention: the mesh's base shape is the collapsed
// state and Pose_00..Pose_{n-1} are the growth. A pose `p` in [0, n] gives
// target i the weight 1 - |p - (i + 1)|, so p = 0 is the base and p = n
// the fully grown last pose; fractional poses blend two neighbours.
export function elowenPoseWeight(p: number, target: number): number {
  return Math.max(0, 1 - Math.abs(p - (target + 1)));
}

export function setElowenPose(root: THREE.Object3D, p: number): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const weights = mesh.morphTargetInfluences;
    const names = mesh.morphTargetDictionary;
    if (!weights || !names) return;
    for (const [name, index] of Object.entries(names)) {
      const target = name.startsWith('Pose_') ? Number(name.slice(5)) : Number.NaN;
      weights[index] = Number.isNaN(target) ? 0 : elowenPoseWeight(p, target);
    }
  });
}

// The growth clock: a part reaches its last pose `poses` frames after the
// effect's start, eased (smoothstep) like the source's own keys.
export function grownPose(ageMs: number, poses: number): number {
  return poses * ramp((ageMs * FPS) / 1000, 0, poses);
}

// The fade factor of an effect that lives `durationMs`: whole until its
// last `fadeMs`, then down to nothing.
export function fadeAt(ageMs: number, durationMs: number, fadeMs: number): number {
  const left = durationMs - ageMs;
  if (left >= fadeMs) return 1;
  return THREE.MathUtils.clamp(left / fadeMs, 0, 1);
}

// --------------------------------------------------------- the clones

// The loaded materials are standard: a black base, the mist's colour as
// emission and its alpha in the base texture. The match draws each layer
// as an unlit basic material, additive where the file says so, so the
// mist glows over whatever stands inside it.
export function mistMaterial(loaded: THREE.Material): THREE.MeshBasicMaterial {
  const std = loaded as Partial<THREE.MeshStandardMaterial>;
  const additive = loaded.userData.additive !== false;
  const color = std.emissive ? std.emissive.clone() : new THREE.Color(0xffffff);
  color.multiplyScalar(std.emissiveIntensity ?? 1);
  const opacity = loaded.opacity;
  const mat = new THREE.MeshBasicMaterial({
    color,
    map: std.map ?? null,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.toneMapped = false;
  mat.userData.additive = additive;
  mat.userData.opacity = opacity;
  return mat;
}

// Every part of an effect: its node, how many growth poses it has (0 for
// none), how fast it turns, and whether it bobs (the flecks).
export interface MistPart {
  node: THREE.Object3D;
  poses: number;
  spin: number;
  bob: number;
  baseY: number;
}

export interface MistEffect {
  root: THREE.Group;
  parts: MistPart[];
}

// The blended layers draw first, the additive ones over them.
const ORDER_BLENDED = 4;
const ORDER_ADDITIVE = 5;

function describePart(node: THREE.Object3D, bob: number): MistPart {
  const poses = typeof node.userData.poses === 'number' ? node.userData.poses : 0;
  const spin = typeof node.userData.spin === 'number' ? node.userData.spin : 0;
  return {
    node,
    poses,
    spin,
    bob: node.userData.effectKind === 'flecks' ? bob : 0,
    baseY: node.position.y,
  };
}

// The template's tagged root nodes (the export lays every part at the
// root), each cloned with its own materials over the shared geometry.
// `bob` is the flecks' bob amplitude in source units.
export function cloneMist(
  template: THREE.Group,
  bob = 0,
  keep: (node: THREE.Object3D) => boolean = () => true,
): MistEffect {
  const root = new THREE.Group();
  const parts: MistPart[] = [];
  for (const source of template.children) {
    if (typeof source.userData.effectKind !== 'string' || !keep(source)) continue;
    const node = source.clone(true);
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      mesh.userData.sharedGeo = true;
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const replaced = materials.map(mistMaterial);
      mesh.material = Array.isArray(mesh.material) ? replaced : (replaced[0] as THREE.Material);
      mesh.renderOrder = replaced.some((m) => m.userData.additive) ? ORDER_ADDITIVE : ORDER_BLENDED;
    });
    parts.push(describePart(node, bob));
    root.add(node);
  }
  return { root, parts };
}

// One frame of an effect at `ageMs`: every posed part at the pose `poseOf`
// gives for its count, every turning part turned, the flecks bobbing.
export function animateMist(
  effect: MistEffect,
  ageMs: number,
  poseOf: (poses: number) => number,
): void {
  const s = ageMs / 1000;
  for (const part of effect.parts) {
    if (part.poses > 0) setElowenPose(part.node, poseOf(part.poses));
    if (part.spin !== 0) part.node.rotation.y = part.spin * s;
    if (part.bob > 0) part.node.position.y = part.baseY + part.bob * Math.sin(s * 1.7);
  }
}

// Multiplies every material's authored opacity by `k`.
export function setMistFade(root: THREE.Object3D, k: number): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      const authored = typeof m.userData.opacity === 'number' ? m.userData.opacity : 1;
      m.opacity = authored * k;
    }
  });
}

// ------------------------------------------------ the missiles: A and Q

const MISSILE_BODY = new Set(['core', 'spin', 'sheath']);
const isMissileBody = (node: THREE.Object3D) => MISSILE_BODY.has(String(node.userData.effectKind));
// The spinning mist of each missile in flight.
const spinners = new WeakMap<THREE.Object3D, MistPart>();

// A missile of a file (its core, its spinning mist, its sheath if any),
// authored along +Z in Blender (+Y in the file), laid down the flight
// axis. A cone of `length` stands in until the file lands.
function buildMissile(name: string, template: THREE.Group | undefined, length: number) {
  const holder = new THREE.Group();
  holder.name = name;
  holder.userData.stretch = false;
  if (template) {
    const body = cloneMist(template, 0, isMissileBody);
    body.root.scale.setScalar(CHARACTER_SCALE);
    body.root.rotation.z = -Math.PI / 2;
    holder.add(body.root);
    const mist = body.parts.find((p) => p.node.userData.effectKind === 'spin');
    if (mist) spinners.set(holder, mist);
  } else {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(length * 0.13, length, 7),
      new THREE.MeshBasicMaterial({ color: MIST.light }),
    );
    cone.rotation.z = -Math.PI / 2;
    holder.add(cone);
    void preloadElowenEffects();
  }
  return holder;
}

// Q: the lance of the file.
export function buildMistLance(): THREE.Group {
  return buildMissile('Elowen_MistLance', lanceTemplate, 0.9);
}

// A: the wisp of the file, her auto leaving her hand.
export function buildAttackWisp(): THREE.Group {
  return buildMissile('Elowen_AttackWisp', wispTemplate, 0.45);
}

// In flight: the mist turns about the flight axis at its authored spin.
export function missileTick(holder: THREE.Object3D, dtMs: number): void {
  const mist = spinners.get(holder);
  if (mist) mist.node.rotation.y += (mist.spin * dtMs) / 1000;
}

// Where the wisp stops: the file's petals burst through their poses at
// the height it flew, then fade, over a small flash and a short light.
export function wispImpact(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, WISP.impactY, z, 0.9, MIST.light, 0.14);
  fx.lightPulse(x, z, MIST.body, 3, 200);
  if (!wispTemplate) return;
  const burst = cloneMist(wispTemplate, 0, (n) => !isMissileBody(n));
  burst.root.scale.setScalar(CHARACTER_SCALE);
  burst.root.position.set(x, fx.groundAt(x, z) + WISP.impactY, z);
  fx.timed.attach(burst.root, WISP.lifeMs, (age) => {
    animateMist(burst, age, (poses) => grownPose(age, poses));
    setMistFade(burst.root, fadeAt(age, WISP.lifeMs, WISP.fadeMs));
  });
}

// Where the lance stops: the petals unfurl through their poses and the
// wave spreads through its own, each fading once grown, over a flash and
// a small light.
export function lanceImpact(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1.1, z, 1.6, MIST.light, 0.22);
  fx.lightPulse(x, z, MIST.body, 5, 320);
  if (!lanceTemplate) return;
  const impact = cloneMist(lanceTemplate, 0, (n) => !isMissileBody(n));
  impact.root.scale.setScalar(CHARACTER_SCALE);
  impact.root.position.set(x, fx.groundAt(x, z), z);
  fx.timed.attach(impact.root, IMPACT.lifeMs, (age) => {
    animateMist(impact, age, (poses) => grownPose(age, poses));
    for (const part of impact.parts) {
      const grownMs = (part.poses * 1000) / FPS;
      setMistFade(part.node, fadeAt(age, grownMs + IMPACT.fadeMs, IMPACT.fadeMs));
    }
  });
}

// ------------------------------------------------------------- zones

interface ZoneState {
  template: () => THREE.Group | undefined;
  sourceRadius: number;
  durationMs: number;
  radius: number;
  effect?: MistEffect;
  opened: boolean;
}
const zones = new WeakMap<THREE.Object3D, ZoneState>();

// The zone holder: the readable boundary every zone gets (a rim tinted by
// whose it is over a faint fill), then the file's parts as soon as it
// landed. The flecks bob by a few percent of the effect's height, which
// is about its radius.
function buildZone(
  name: string,
  radius: number,
  hostile: boolean,
  template: () => THREE.Group | undefined,
  sourceRadius: number,
  durationMs: number,
): THREE.Group {
  const holder = new THREE.Group();
  holder.name = name;
  holder.add(flatDisc(radius, MIST.body, 0.1, 0.08));
  holder.add(flatRing(radius - 0.3, radius, hostile ? MIST.light : MIST.body, 0.5, 0.1));
  zones.set(holder, { template, sourceRadius, durationMs, radius, opened: false });
  void preloadElowenEffects();
  attachZone(holder);
  return holder;
}

function attachZone(holder: THREE.Object3D): void {
  const state = zones.get(holder);
  const template = state?.template();
  if (!state || state.effect || !template) return;
  const effect = cloneMist(template, 0.04 * state.sourceRadius);
  effect.root.scale.setScalar(state.radius / state.sourceRadius);
  holder.add(effect.root);
  state.effect = effect;
}

function zoneTick(holder: THREE.Object3D, ageMs: number): ZoneState | undefined {
  attachZone(holder);
  const state = zones.get(holder);
  if (!state?.effect) return state;
  animateMist(state.effect, ageMs, (poses) => grownPose(ageMs, poses));
  setMistFade(state.effect.root, fadeAt(ageMs, state.durationMs, ZONE_FADE_MS));
  return state;
}

// W: the veil, the file's two domes, the climbing wisps, the ground mist
// and the flecks, growing over their poses from the cast, turning slowly,
// fading over the veil's last beats.
export function buildVeil(radius: number, hostile: boolean): THREE.Group {
  return buildZone('Elowen_Veil', radius, hostile, () => veilTemplate, VEIL_SOURCE_RADIUS, VEIL_MS);
}

export function veilTick(
  fx: VfxSystem,
  holder: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  ageMs: number,
): void {
  const state = zoneTick(holder, ageMs);
  if (state && !state.opened) {
    state.opened = true;
    fx.glowFlash(x, 0.9, z, radius * 1.1, MIST.light, 0.35);
    fx.lightPulse(x, z, MIST.body, 8, 600);
  }
}

// R: the whiteout, the file's wall of wind, its ribbons, the eye's spiral,
// the vortex, the ground mist and the snow, growing from the cast, turning
// at their own speeds, one gentle shake as it lands, fading over the
// storm's last beats. No lightning, no particles.
export function buildWhiteout(radius: number, hostile: boolean): THREE.Group {
  return buildZone(
    'Elowen_Whiteout',
    radius,
    hostile,
    () => whiteoutTemplate,
    WHITEOUT_SOURCE_RADIUS,
    WHITEOUT_MS,
  );
}

export function whiteoutTick(
  fx: VfxSystem,
  holder: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  ageMs: number,
): void {
  const state = zoneTick(holder, ageMs);
  if (state && !state.opened) {
    state.opened = true;
    fx.glowFlash(x, 1, z, radius * 1.2, MIST.light, 0.4);
    fx.lightPulse(x, z, MIST.body, 14, 700);
    fx.onShake(0.1);
  }
}

// ---------------------------------------------------- E: drifting step

const isStreak = (node: THREE.Object3D) => node.userData.effectKind === 'trail';

// One end of the step: the file's flash at a point (the core swelling,
// the tufts thrown out, the ring on the ground), grown over a quarter
// second, then fading; a glow with it.
function stepFlash(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1.2, z, 1.6, MIST.light, 0.16);
  fx.lightPulse(x, z, MIST.body, 5, 220);
  if (!stepTemplate) return;
  const flash = cloneMist(stepTemplate, 0, (n) => !isStreak(n));
  flash.root.scale.setScalar(CHARACTER_SCALE);
  flash.root.position.set(x, fx.groundAt(x, z), z);
  fx.timed.attach(flash.root, STEP.lifeMs, (age) => {
    animateMist(flash, age, (poses) => grownPose(age, poses));
    setMistFade(flash.root, fadeAt(age, STEP.lifeMs, STEP.fadeMs));
  });
}

// The streak of the file between the two ends: authored one source metre
// long along its +Y, laid from the departure toward the arrival at chest
// height and stretched to the step's length, whole for a beat then gone.
function stepStreak(fx: VfxSystem, fromX: number, fromZ: number, toX: number, toZ: number): void {
  if (!stepTemplate) return;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-3) return;
  const streak = cloneMist(stepTemplate, 0, isStreak);
  streak.root.scale.setScalar(CHARACTER_SCALE);
  streak.root.rotation.z = -Math.PI / 2;
  for (const part of streak.parts) part.node.scale.y = length / CHARACTER_SCALE;
  const holder = new THREE.Group();
  holder.add(streak.root);
  holder.rotation.y = -Math.atan2(dz, dx);
  holder.position.set(fromX, fx.groundAt(fromX, fromZ) + STEP.height * CHARACTER_SCALE, fromZ);
  fx.timed.attach(holder, STEP.trailMs, (age) => {
    setMistFade(holder, fadeAt(age, STEP.trailMs, STEP.trailMs - STEP.trailHoldMs));
  });
}

// The blink: a flash where she stood, the streak to where she lands, and
// the same flash there one beat later. The renderer hands the landing
// (her position once the cast resolved) and where it last drew her; an
// older caller without the departure gets it from the aim and the kit's
// range (an aim with no length points along +X rather than nowhere).
export function driftingStep(
  fx: VfxSystem,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  fromX?: number,
  fromZ?: number,
): void {
  const len = Math.hypot(dirX, dirZ);
  const dx = len > 1e-6 ? dirX / len : 1;
  const dz = len > 1e-6 ? dirZ / len : 0;
  const departX = fromX ?? x - dx * BLINK_RANGE;
  const departZ = fromZ ?? z - dz * BLINK_RANGE;
  if (!stepTemplate) void preloadElowenEffects();
  stepFlash(fx, departX, departZ);
  stepStreak(fx, departX, departZ, x, z);
  fx.schedule(STEP.arrivalDelayMs, () => stepFlash(fx, x, z));
}
