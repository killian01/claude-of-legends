// The runtime half of a rigged champion: an AnimationMixer over the cloned
// rig plus a small state machine. The renderer feeds it a ChampionAnimInput
// every frame and fires the one-shot triggers off combat notes; everything
// clip-related stays in here. The zero-weight trap from world-of-claudecraft
// applies: a skinned rig whose scheduled actions sum to nothing renders its
// bind pose, so every transition fades something in as it fades the rest out.

import * as THREE from 'three';
import {
  type ChampionAnimInput,
  type ChampionBaseState,
  DEFAULT_RUN_SPEED,
  desiredBaseState,
  FADE_BASE,
  FADE_SHOT,
  ONESHOT_SECONDS,
  runTimeScale,
} from './anim';
import { type ChampionTemplate, type PropAnchor, syncPropAnchors } from './assets';

type ShotKey = 'attack' | 'cast' | 'hit' | 'death';

export class ChampionVisual {
  readonly root: THREE.Group;
  private readonly anchors: readonly PropAnchor[];
  private readonly runSpeed: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly baseActions: Partial<Record<ChampionBaseState, THREE.AnimationAction>> = {};
  private readonly shotActions: Partial<Record<ShotKey, THREE.AnimationAction>> = {};
  private base: ChampionBaseState = 'idle';
  private current: THREE.AnimationAction | null = null;
  private shot: THREE.AnimationAction | null = null;

  constructor(
    template: ChampionTemplate,
    root: THREE.Group,
    rig: THREE.Object3D,
    anchors: readonly PropAnchor[] = [],
  ) {
    this.root = root;
    this.anchors = anchors;
    this.runSpeed = template.def.runSpeed ?? DEFAULT_RUN_SPEED;
    this.mixer = new THREE.AnimationMixer(rig);
    const clips = template.def.clips;
    const action = (name: string | undefined): THREE.AnimationAction | undefined => {
      const clip = name ? template.clips.get(name) : undefined;
      return clip ? this.mixer.clipAction(clip) : undefined;
    };
    this.baseActions.idle = action(clips.idle);
    this.baseActions.run = action(clips.run);
    this.baseActions.windup = action(clips.windup);
    this.shotActions.attack = action(clips.attack);
    this.shotActions.cast = action(clips.cast);
    this.shotActions.hit = action(clips.hit);
    this.shotActions.death = action(clips.death);
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.shot) return;
      this.shot = null;
      // Death clamps on its last frame; everything else hands the rig back.
      if (this.base !== 'dead') this.beginBase(this.base, true);
    });
    this.beginBase('idle', false);
  }

  private startAction(a: THREE.AnimationAction, fade: number): void {
    a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
  }

  private beginBase(state: ChampionBaseState, force: boolean): void {
    const next = this.baseActions[state === 'dead' ? 'idle' : state] ?? this.baseActions.idle;
    this.base = state;
    if (!next || (next === this.current && !force)) return;
    const prev = this.current;
    this.current = next;
    // While a one-shot holds the rig, only record the desired base; the
    // finished handler resumes it so the weights never fight.
    if (this.shot) return;
    this.startAction(next, FADE_BASE);
    if (prev && prev !== next) prev.fadeOut(FADE_BASE);
  }

  private playShot(key: ShotKey, seconds: number): void {
    if (this.base === 'dead' && key !== 'death') return;
    const a = this.shotActions[key];
    if (!a) return;
    const prevShot = this.shot;
    this.shot = a;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    this.startAction(a, FADE_SHOT);
    a.setDuration(seconds);
    if (prevShot && prevShot !== a) prevShot.fadeOut(FADE_SHOT);
    else if (!prevShot) this.current?.fadeOut(FADE_SHOT);
  }

  playAttack(): void {
    this.playShot('attack', ONESHOT_SECONDS.attack);
  }

  playCast(): void {
    this.playShot('cast', ONESHOT_SECONDS.cast);
  }

  playHit(): void {
    // A hit react must never eat an attack or cast mid-swing.
    if (this.shot) return;
    this.playShot('hit', ONESHOT_SECONDS.hit);
  }

  update(dtMs: number, input: ChampionAnimInput): void {
    const desired = desiredBaseState(input);
    if (desired !== this.base) {
      if (desired === 'dead') {
        // Death edge: override any one-shot with the fall, then clamp.
        this.base = 'dead';
        this.playShot('death', ONESHOT_SECONDS.death);
      } else if (this.base === 'dead') {
        // Revive edge.
        this.shot?.fadeOut(FADE_BASE);
        this.shot = null;
        this.beginBase(desired, true);
      } else {
        this.beginBase(desired, false);
      }
    }
    // Feet stay planted: the run clip's time scale tracks the champion's
    // actual ground speed (slows, Zephyr) against the def's reference.
    if (input.speed !== undefined) {
      this.baseActions.run?.setEffectiveTimeScale(runTimeScale(input.speed, this.runSpeed));
    }
    this.mixer.update(dtMs / 1000);
    // Sync prop anchors to their bones in root space: position only, at
    // unit scale, so props keep their authored size and pose no matter what
    // scale or orientation the bone chain carries. One frame of world-matrix
    // lag is invisible.
    syncPropAnchors(this.root, this.anchors);
  }

  // Releases the mixer bindings and the per-clone skeletons. Geometry is the
  // template's (userData.sharedGeo) and materials are per-instance; the
  // caller's disposeDeep handles both after the death fade.
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
  }
}
