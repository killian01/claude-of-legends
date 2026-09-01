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
  WEAPON_STOW_DELAY_MS,
} from './anim';
import { type ChampionTemplate, type PropAnchor, setPropsArmed, syncPropAnchors } from './assets';

type ShotKey = 'attack' | 'cast' | 'hit' | 'death';

export class ChampionVisual {
  readonly root: THREE.Group;
  private readonly anchors: readonly PropAnchor[];
  private readonly runSpeed: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly baseActions: Partial<Record<ChampionBaseState, THREE.AnimationAction>> = {};
  private readonly shotActions: Partial<Record<ShotKey, THREE.AnimationAction>> = {};
  // Per-ability cast overrides (forged creators pick one per spell); an
  // ability without its own falls back to the shared cast action.
  private readonly spellActions: Partial<Record<'Q' | 'W' | 'E' | 'R', THREE.AnimationAction>> = {};
  private base: ChampionBaseState = 'idle';
  private current: THREE.AnimationAction | null = null;
  private shot: THREE.AnimationAction | null = null;
  // True while the playing one-shot is an attack or cast: the weapon must
  // be in hand, not stowed on the back.
  private combatShot = false;
  // The weapon stays in hand until this age after the last combat action,
  // so it never flickers to the back between two chained autos.
  private armedUntilMs = 0;
  // Champions with a stowable weapon hold the aim loop (windup) instead of
  // the breathing idle while the armed window runs: a marksman between two
  // autos keeps the rifle shouldered.
  private readonly combatIdles: boolean;
  // Time lived, to arm the prop rest-pose capture after the idle fade-in.
  private ageMs = 0;

  constructor(
    template: ChampionTemplate,
    root: THREE.Group,
    rig: THREE.Object3D,
    anchors: readonly PropAnchor[] = [],
  ) {
    this.root = root;
    this.anchors = anchors;
    this.combatIdles = template.def.props?.some((p) => p.stowed !== undefined) ?? false;
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
    for (const key of ['Q', 'W', 'E', 'R'] as const) {
      const own = action(template.def.spellClips?.[key]);
      if (own) this.spellActions[key] = own;
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.shot) return;
      this.shot = null;
      this.combatShot = false;
      // Death clamps on its last frame; everything else hands the rig back.
      // The finished action must fade out too: clamped at full weight it
      // would blend its final pose into every later base and warp the gait.
      if (this.base !== 'dead') {
        e.action.fadeOut(FADE_BASE);
        this.beginBase(this.base, true);
      }
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

  private playShot(key: ShotKey, seconds: number, override?: THREE.AnimationAction): void {
    if (this.base === 'dead' && key !== 'death') return;
    const a = override ?? this.shotActions[key];
    if (!a) return;
    const prevShot = this.shot;
    this.shot = a;
    this.combatShot = key === 'attack' || key === 'cast';
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    this.startAction(a, FADE_SHOT);
    a.setDuration(seconds);
    if (prevShot && prevShot !== a) prevShot.fadeOut(FADE_SHOT);
    else if (!prevShot) this.current?.fadeOut(FADE_SHOT);
  }

  // World position of the weapon's muzzle: the tip of the first GLB prop,
  // posed in hand as if armed, so even the first shot out of the stow
  // leaves the barrel and not the back. Only fixedPose props qualify (the
  // pose math assumes the identity holder orientation). False when the rig
  // carries no such weapon.
  muzzleWorld(out: THREE.Vector3): boolean {
    for (const a of this.anchors) {
      if (!a.tip || !a.fixedPose) continue;
      setPropsArmed([a], true);
      a.hand.bone.getWorldPosition(out);
      a.holder.position.copy(this.root.worldToLocal(out));
      a.holder.quaternion.identity();
      a.holder.updateMatrixWorld(true);
      out.copy(a.tip).applyMatrix4(a.prop.matrixWorld);
      return true;
    }
    return false;
  }

  playAttack(): void {
    this.playShot('attack', ONESHOT_SECONDS.attack);
  }

  // With an ability key, that spell's own picked clip plays when the
  // creator gave it one; the shared cast otherwise.
  playCast(key?: 'Q' | 'W' | 'E' | 'R'): void {
    this.playShot('cast', ONESHOT_SECONDS.cast, key ? this.spellActions[key] : undefined);
  }

  playHit(): void {
    // A hit react must never eat an attack or cast mid-swing.
    if (this.shot) return;
    this.playShot('hit', ONESHOT_SECONDS.hit);
  }

  update(dtMs: number, input: ChampionAnimInput): void {
    // The armed window: real combat signals (a charging cast, an attack or
    // cast one-shot) extend it; inside it the weapon stays in hand, and a
    // standing champion with a stowable weapon holds the aim loop instead
    // of the breathing idle.
    const fighting = input.windingUp || this.combatShot;
    if (fighting) this.armedUntilMs = this.ageMs + WEAPON_STOW_DELAY_MS;
    const armed = fighting || this.ageMs < this.armedUntilMs;
    let desired = desiredBaseState(input);
    if (desired === 'idle' && armed && this.combatIdles) desired = 'windup';
    if (desired !== this.base) {
      if (desired === 'dead') {
        // Death edge: override any one-shot with the fall, then clamp.
        this.base = 'dead';
        this.playShot('death', ONESHOT_SECONDS.death);
      } else if (this.base === 'dead') {
        // Revive edge. The death one-shot has usually already finished and
        // cleared this.shot, so release the clamped corpse pose explicitly.
        this.shot?.fadeOut(FADE_BASE);
        this.shotActions.death?.fadeOut(FADE_BASE);
        this.shot = null;
        this.combatShot = false;
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
    this.ageMs += dtMs;
    // Sync prop anchors to their bones in root space at unit scale, so
    // props keep their authored size no matter what scale the bone chain
    // carries. The rest orientation is captured only once the idle pose has
    // fully faded in AND no one-shot holds the rig: a swing playing during
    // the capture window (slow asset load into a live fight, or the home
    // stage's random attacks) would bake a mid-swing hand as "rest" and
    // leave the weapon permanently twisted.
    const settled = this.ageMs > 300 && this.shot === null && this.base === 'idle';
    setPropsArmed(this.anchors, armed);
    syncPropAnchors(this.root, this.anchors, settled);
  }

  // Releases the mixer bindings and the per-clone skeletons. Geometry is the
  // template's (userData.sharedGeo) and materials are per-instance; the
  // caller's disposeDeep handles both after the death fade.
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
  }
}
