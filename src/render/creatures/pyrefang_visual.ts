// The Pyrefang's rigged body in the match: the Codex model and its clips
// (scripts/export_pyrefang.py, public/models/creatures/pyrefang.glb), a
// mixer and a small state machine. A creature seen rising plays its
// opening (pyrefang_rise.ts): the Emerge in the fire column, then the
// Roar, then the idle; afterwards it walks when the sim moves it, bites on
// the attack notes with the bite landing on the sim's hit, and falls on
// its death. The lava in the hide glows from the texture's red excess, the
// way the Codex material lit it, and the flames on the crest, spine and
// tail flicker in a shader of their own. Presentation only, fail-soft: until
// the file loads (or if it never does) the procedural figure stays.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { openingAt, RISE_FX_S } from '../pyrefang_rise';
import { toonifyMaterials } from '../toon';
import { PyrefangRiseFx } from '../vfx/pyrefang_rise_fx';

const URL = '/models/creatures/pyrefang.glb';
// World units per source metre, inside the creature holder (which adds its
// own 1.05, and the Ascendant's 1.35): about sixteen units nose to tail.
export const PYREFANG_SCALE = 14.4;
// The rise's fire rings the whole platform: the crown's authored outer
// edge (source metres, pyrefang_rise.ts) is stretched onto the ring's disc
// radius (RingSite.r), the column standing on the disc's centre, where the
// creature rises, and growing less up than across.
const CROWN_EDGE_M = 0.44;
const ATTACK_RELEASE_S = 0.55;
// The walk's authored ground speed, source metres a second
// (scripts/pyrefang_codex_walk.py: 0.20 m of stance over 0.68 of 4/3 s).
const WALK_SOURCE_SPEED = 0.2 / (0.68 * (4 / 3));
const FADE_BASE = 0.3;
const FADE_SHOT = 0.12;
// The bones the hide's embers rise from.
const EMBER_BONES = ['Spine', 'Chest', 'Neck01', 'Tail02', 'Tail04', 'Tail06'];

type ClipName = 'Idle' | 'Walk' | 'Attack' | 'Roar' | 'Death' | 'Emerge';

interface Template {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}

let template: Template | null = null;
let loading: Promise<Template | null> | undefined;

// The exporter keys frame 1 at 1/24 s; the clips start at zero here so the
// loops close without a held frame. The loader shares one times array
// between every track sampled on the same frames, across clips too, so
// each track is copied before it moves.
function fromZero(clip: THREE.AnimationClip): THREE.AnimationClip {
  const start = Math.min(...clip.tracks.map((t) => t.times[0] ?? 0));
  const tracks = clip.tracks.map((t) => t.clone().shift(-start));
  return new THREE.AnimationClip(clip.name, -1, tracks);
}

export function preloadPyrefang(): Promise<Template | null> {
  loading ??= new GLTFLoader()
    .loadAsync(URL)
    .then((gltf) => {
      template = {
        scene: gltf.scene,
        clips: new Map(gltf.animations.map((c) => [c.name, fromZero(c)])),
      };
      return template;
    })
    .catch((error: unknown) => {
      console.warn('Pyrefang model failed to load:', error);
      return null;
    });
  return loading;
}

// The hide: the Codex halves the texture for the lit colour and lights the
// lava where red exceeds blue, max(0, (r - b - 0.18) * 9) times the texel.
function glowingHide(mat: THREE.Material, glow: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLavaGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uLavaGlow;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#ifdef USE_MAP
  totalEmissiveRadiance += sampledDiffuseColor.rgb *
    max(0.0, (sampledDiffuseColor.r - sampledDiffuseColor.b - 0.18) * 9.0) * uLavaGlow;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'pyrefang-hide';
}

// The body flames: the flame texture, additive, flickering up the tongue.
function flameMaterial(
  map: THREE.Texture | null,
  uniforms: { uTime: { value: number }; uFire: { value: number } },
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFire = uniforms.uFire;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uTime;\nuniform float uFire;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec2 fuv = vMapUv;
  float lick = sin(uTime * 9.0 + fuv.y * 14.0) * 0.5 + sin(uTime * 13.7 - fuv.y * 23.0) * 0.3;
  fuv.x += 0.035 * lick * fuv.y;
  vec4 flame = texture2D(map, fuv);
  float flicker = 0.8 + 0.25 * sin(uTime * 17.0 + fuv.y * 9.0);
  diffuseColor = vec4(flame.rgb * 1.6 * flicker, flame.a * uFire);
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'pyrefang-flame';
  return mat;
}

export interface PyrefangInput {
  moving: boolean;
  // Ground speed, world units a second.
  speed: number;
}

export class PyrefangVisual {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private readonly lavaGlow = { value: 1 };
  private readonly flame = { uTime: { value: 0 }, uFire: { value: 1 } };
  private readonly emberBones: THREE.Object3D[] = [];
  private readonly worldScale: number;
  private base: 'Idle' | 'Walk' = 'Idle';
  private current: THREE.AnimationAction | null = null;
  private shot: THREE.AnimationAction | null = null;
  private dead = false;
  // Seconds since the rise while the opening runs, null once it is over.
  private openingClock: number | null;
  private riseFx: PyrefangRiseFx | null = null;
  private riseFxClock = 0;
  private emberDebt = 0;

  // riseAge: seconds since the creature rose, null when unknown.
  // holderScale: the scale of the holder this root goes into.
  // ringRadius: the platform's radius in world units, null when unknown
  // (the fire then keeps its authored size).
  constructor(
    t: Template,
    riseAge: number | null,
    holderScale: number,
    ringRadius: number | null = null,
  ) {
    const model = cloneRig(t.scene) as THREE.Group;
    model.scale.setScalar(PYREFANG_SCALE);
    this.root.add(model);
    this.worldScale = PYREFANG_SCALE * holderScale;
    model.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      // The geometry is the template's, shared by every clone.
      mesh.userData.sharedGeo = true;
      const src = mesh.material as THREE.MeshStandardMaterial;
      if (mesh.name.startsWith('Pyrefang_FX_')) {
        mesh.material = flameMaterial(src.map, this.flame);
        mesh.castShadow = false;
        mesh.renderOrder = 2;
      } else {
        mesh.material = new THREE.MeshLambertMaterial({
          map: src.map,
          color: new THREE.Color(1.15, 1.1, 1.1),
        });
        mesh.castShadow = true;
      }
      src.dispose();
    });
    toonifyMaterials(model);
    model.traverse((node) => {
      const mat = (node as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (mat?.isMeshToonMaterial) glowingHide(mat, this.lavaGlow);
    });
    for (const name of EMBER_BONES) {
      const bone = model.getObjectByName(name);
      if (bone) this.emberBones.push(bone);
    }
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of ['Idle', 'Walk', 'Attack', 'Roar', 'Death', 'Emerge'] as const) {
      const clip = t.clips.get(name);
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.shot || this.dead) return;
      this.shot = null;
      e.action.fadeOut(FADE_BASE);
      this.resumeBase();
    });

    const opening = riseAge === null ? null : openingAt(riseAge);
    this.openingClock = opening ? (riseAge as number) : null;
    if (riseAge !== null && riseAge < RISE_FX_S) {
      const across = ringRadius ? ringRadius / (CROWN_EDGE_M * this.worldScale) : 1;
      this.riseFx = new PyrefangRiseFx([0, 0], { across, up: 1 + (across - 1) * 0.45 });
      this.riseFxClock = riseAge;
      this.riseFx.update(riseAge);
      model.add(this.riseFx.root);
    }
    if (opening) this.playOpening(opening.clip, opening.time, 0);
    else this.resumeBase(0);
  }

  // Whether the rise's fire is still burning (the renderer pulses a light).
  get rising(): boolean {
    return this.riseFx !== null;
  }

  private play(a: THREE.AnimationAction, fade: number, once: boolean, time = 0): void {
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    a.time = time;
    a.setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (fade > 0) a.fadeIn(fade);
    a.play();
  }

  private playOpening(clip: 'Emerge' | 'Roar', time: number, fade: number): void {
    const a = this.actions.get(clip);
    if (!a) {
      this.resumeBase(fade);
      return;
    }
    const prev = this.shot ?? this.current;
    this.shot = a;
    this.play(a, fade, true, time);
    if (prev && prev !== a && fade > 0) prev.fadeOut(fade);
    else if (prev && prev !== a) prev.stop();
  }

  private resumeBase(fade = FADE_BASE): void {
    const next = this.actions.get(this.base) ?? this.actions.get('Idle');
    if (!next) return;
    const prev = this.current;
    this.current = next;
    if (this.shot) return;
    this.play(next, fade, false);
    if (prev && prev !== next) prev.fadeOut(fade);
  }

  // The bite: the clip is stretched so its bite lands when the sim's hit
  // does, `windupSeconds` from now.
  playAttack(windupSeconds: number): void {
    if (this.dead) return;
    const a = this.actions.get('Attack');
    if (!a) return;
    this.openingClock = null;
    const prev = this.shot ?? this.current;
    this.shot = a;
    this.play(a, FADE_SHOT, true);
    a.setEffectiveTimeScale(ATTACK_RELEASE_S / Math.max(0.15, windupSeconds));
    if (prev && prev !== a) prev.fadeOut(FADE_SHOT);
  }

  playDeath(): void {
    if (this.dead) return;
    this.dead = true;
    this.openingClock = null;
    const a = this.actions.get('Death');
    if (!a) return;
    const prev = this.shot ?? this.current;
    this.shot = a;
    this.play(a, FADE_SHOT, true);
    if (prev && prev !== a) prev.fadeOut(FADE_SHOT);
  }

  // Steps the body; `ember` throws one ember at a world point.
  update(dtMs: number, input: PyrefangInput, ember?: (at: THREE.Vector3) => void): void {
    const dt = dtMs / 1000;
    if (this.openingClock !== null) {
      const before = openingAt(this.openingClock);
      this.openingClock += dt;
      const after = openingAt(this.openingClock);
      if (!after) {
        this.openingClock = null;
      } else if (before && after.clip !== before.clip && this.shot) {
        this.playOpening(after.clip, after.time, 0.2);
      }
    }
    if (this.riseFx) {
      this.riseFxClock += dt;
      this.riseFx.update(this.riseFxClock);
      if (this.riseFx.done) {
        this.riseFx.dispose();
        this.riseFx = null;
      }
    }
    if (!this.dead) {
      // A creature moving mid-opening walks off instead of sliding.
      if (input.moving && this.openingClock !== null) {
        this.openingClock = null;
        this.shot?.fadeOut(FADE_BASE);
        this.shot = null;
      }
      const want = input.moving ? 'Walk' : 'Idle';
      if (want !== this.base || (!this.shot && !this.current?.isRunning())) {
        this.base = want;
        this.resumeBase();
      }
      const walk = this.actions.get('Walk');
      if (walk && input.moving) {
        const scale = input.speed / (WALK_SOURCE_SPEED * this.worldScale);
        walk.setEffectiveTimeScale(Math.min(2.4, Math.max(0.6, scale)));
      }
    }
    this.mixer.update(dt);
    // The fire: kindled through the wake, dying with the body.
    const opening = this.openingClock !== null ? openingAt(this.openingClock) : null;
    let fire = 1;
    if (opening?.clip === 'Emerge') fire = Math.min(1, Math.max(0, (opening.time - 0.2) / 1.6));
    if (this.dead) {
      const death = this.actions.get('Death');
      fire = death ? Math.max(0, 1 - death.time / 2.2) : 0;
    }
    this.flame.uTime.value += dt;
    this.flame.uFire.value = fire;
    this.lavaGlow.value = 0.35 + 0.65 * fire;
    if (ember && fire > 0.05 && this.emberBones.length > 0) {
      this.emberDebt += dt * 9 * fire;
      while (this.emberDebt >= 1) {
        this.emberDebt -= 1;
        const bone = this.emberBones[Math.floor(Math.random() * this.emberBones.length)]!;
        ember(bone.getWorldPosition(EMBER_AT));
      }
    }
  }

  dispose(): void {
    this.riseFx?.dispose();
    this.riseFx = null;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
    this.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.dispose();
    });
  }
}

const EMBER_AT = new THREE.Vector3();

// A visual now when the file is in, null otherwise (the figure stays).
export function createPyrefangVisual(
  riseAge: number | null,
  holderScale: number,
  ringRadius: number | null = null,
): PyrefangVisual | null {
  return template ? new PyrefangVisual(template, riseAge, holderScale, ringRadius) : null;
}
