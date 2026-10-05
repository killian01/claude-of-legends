// The authored quadruped replaces only the creature's body, keeping its
// aspect beacon and Ascendant halo. Attack contact follows the simulation's
// windup; Spawn and Death keep their authored timing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { VoidmaulAttackKind } from '../../sim/content/voidmaul_slam';
import { toonifyMaterials } from '../toon';

export const VOIDMAUL_MODEL_URL = '/models/creatures/voidmaul.glb';
export const VOIDMAUL_SCALE = 12.9;
// The model's standing height in model units (voidmaul.export.json
// rest_bounds_m), what the health bar clears.
export const VOIDMAUL_REST_HEIGHT = 0.9965;
export const VOIDMAUL_ATTACK_RELEASE_S = 1.75;
export const VOIDMAUL_WALK_SOURCE_SPEED = 0.11994158146948393;
export const VOIDMAUL_CLIPS = [
  'Idle',
  'Walk',
  'Attack',
  'AttackCrush',
  'Hurt',
  'Death',
  'Spawn',
] as const;
type ClipName = (typeof VOIDMAUL_CLIPS)[number];
const FADE_BASE = 0.2;
const FADE_SHOT = 0.08;

export interface VoidmaulTemplate {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}

export interface VoidmaulInput {
  moving: boolean;
  speed: number;
}

let template: VoidmaulTemplate | null = null;
let loading: Promise<VoidmaulTemplate | null> | undefined;

function fromZero(clip: THREE.AnimationClip): THREE.AnimationClip {
  const start = clip.tracks.reduce((t, track) => Math.min(t, track.times[0] ?? 0), Infinity);
  const tracks = clip.tracks.map((track) =>
    track.clone().shift(Number.isFinite(start) ? -start : 0),
  );
  return new THREE.AnimationClip(clip.name, -1, tracks);
}

export function preloadVoidmaul(): Promise<VoidmaulTemplate | null> {
  loading ??= new GLTFLoader()
    .loadAsync(VOIDMAUL_MODEL_URL)
    .then((gltf) => {
      const clips = new Map(gltf.animations.map((clip) => [clip.name, fromZero(clip)]));
      for (const name of VOIDMAUL_CLIPS) {
        if (!clips.has(name)) throw new Error(`Missing Voidmaul animation: ${name}`);
      }
      template = { scene: gltf.scene, clips };
      return template;
    })
    .catch((error: unknown) => {
      console.warn('Voidmaul model failed to load:', error);
      return null;
    });
  return loading;
}

// Light only the blue cracks in the texture, retaining the dark stone.
function glowingHide(material: THREE.MeshToonMaterial, glow: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVoidGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uVoidGlow;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#ifdef USE_MAP
  totalEmissiveRadiance += sampledDiffuseColor.rgb *
    max(0.0, (sampledDiffuseColor.b - sampledDiffuseColor.r - 0.08) * 4.0) * uVoidGlow;
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'voidmaul-hide';
}

export class VoidmaulVisual {
  readonly root = new THREE.Group();
  readonly deathDurationMs: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private readonly glow = { value: 1 };
  private readonly worldScale: number;
  private base: 'Idle' | 'Walk' = 'Idle';
  private current: THREE.AnimationAction | null = null;
  private shot: THREE.AnimationAction | null = null;
  private dead = false;

  constructor(t: VoidmaulTemplate, riseAge: number | null, holderScale: number) {
    const model = cloneRig(t.scene) as THREE.Group;
    model.scale.setScalar(VOIDMAUL_SCALE);
    this.root.add(model);
    this.worldScale = VOIDMAUL_SCALE * holderScale;
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      mesh.userData.sharedGeo = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // SkeletonUtils shares geometry, texture and source materials. Own
      // each clone's materials so a corpse cannot dispose another creature.
      const convert = (source: THREE.Material): THREE.MeshLambertMaterial => {
        const src = source as THREE.MeshStandardMaterial;
        return new THREE.MeshLambertMaterial({
          name: src.name,
          map: src.map ?? null,
          color: src.color?.clone() ?? new THREE.Color(0xffffff),
          side: src.side,
          transparent: src.transparent,
          opacity: src.opacity,
          vertexColors: src.vertexColors,
          emissive: src.emissive?.clone() ?? new THREE.Color(0),
          emissiveMap: src.emissiveMap ?? null,
          emissiveIntensity: src.emissiveIntensity ?? 0,
        });
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(convert)
        : convert(mesh.material);
    });
    toonifyMaterials(model);
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ((material as THREE.MeshToonMaterial).isMeshToonMaterial) {
          glowingHide(material as THREE.MeshToonMaterial, this.glow);
        }
      }
    });
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of VOIDMAUL_CLIPS) {
      const clip = t.clips.get(name);
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    this.deathDurationMs = (t.clips.get('Death')?.duration ?? 3.2) * 1000;
    this.mixer.addEventListener('finished', (event) => {
      if (event.action !== this.shot || this.dead) return;
      this.shot = null;
      event.action.fadeOut(FADE_BASE);
      this.resumeBase();
    });
    const spawn = this.actions.get('Spawn');
    if (spawn && riseAge !== null && riseAge >= 0 && riseAge < spawn.getClip().duration) {
      this.shot = spawn;
      this.play(spawn, 0, true, riseAge);
    } else {
      this.resumeBase(0);
    }
    // A late-loading asset immediately shows the correct opening pose.
    this.mixer.update(0);
  }

  get rising(): boolean {
    return this.shot === this.actions.get('Spawn') && this.shot?.isRunning() === true;
  }

  private play(action: THREE.AnimationAction, fade: number, once: boolean, time = 0): void {
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.time = time;
    action.setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (fade > 0) action.fadeIn(fade);
    action.play();
  }

  private resumeBase(fade = FADE_BASE): void {
    if (this.shot || this.dead) return;
    const next = this.actions.get(this.base) ?? this.actions.get('Idle');
    if (!next) return;
    const previous = this.current;
    this.current = next;
    this.play(next, fade, false);
    if (previous && previous !== next) previous.fadeOut(fade);
  }

  private playShot(
    name: 'Attack' | 'AttackCrush' | 'Hurt' | 'Death',
  ): THREE.AnimationAction | undefined {
    const action = this.actions.get(name);
    if (!action) return;
    const previous = this.shot ?? this.current;
    this.shot = action;
    this.play(action, FADE_SHOT, true);
    if (previous && previous !== action) previous.fadeOut(FADE_SHOT);
    return action;
  }

  playAttack(windupSeconds: number, kind: VoidmaulAttackKind = 'slam'): void {
    if (this.dead) return;
    this.playShot(kind === 'crush' ? 'AttackCrush' : 'Attack')?.setEffectiveTimeScale(
      VOIDMAUL_ATTACK_RELEASE_S / Math.max(0.01, windupSeconds),
    );
  }

  playHit(): void {
    // A flinch must not delay an attack's damage beat or restart itself
    // under rapid hits. Idle/walk hand control back after this short shot.
    if (this.dead || this.shot) return;
    this.playShot('Hurt');
  }

  playDeath(): void {
    if (this.dead) return;
    this.dead = true;
    this.playShot('Death');
  }

  update(dtMs: number, input: VoidmaulInput, _ember?: (at: THREE.Vector3) => void): void {
    const dt = Math.max(0, dtMs) / 1000;
    if (!this.dead) {
      if (input.moving && this.rising) {
        this.shot?.fadeOut(FADE_BASE);
        this.shot = null;
      }
      const desired = input.moving ? 'Walk' : 'Idle';
      if (desired !== this.base || (!this.shot && !this.current?.isRunning())) {
        this.base = desired;
        this.resumeBase();
      }
      if (input.moving) {
        const rate = input.speed / (VOIDMAUL_WALK_SOURCE_SPEED * this.worldScale);
        this.actions.get('Walk')?.setEffectiveTimeScale(Math.min(8, Math.max(0.1, rate)));
      }
    }
    this.mixer.update(dt);
    if (this.dead) {
      const time = this.actions.get('Death')?.time ?? this.deathDurationMs / 1000;
      this.glow.value = Math.max(0, 1 - time / (this.deathDurationMs / 1000));
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.dispose();
      }
    });
  }
}

export function createVoidmaulVisual(
  riseAge: number | null,
  holderScale: number,
): VoidmaulVisual | null {
  return template ? new VoidmaulVisual(template, riseAge, holderScale) : null;
}
