// Ground openings outlive the body that climbs through them. Keep their
// captured transform on the scene, independent of the creature's gait,
// turning, interrupted Spawn action or death.
import type * as THREE from 'three';
import { VOIDMAUL_RIFT_DURATION_S, VoidmaulRiftFx } from './vfx/voidmaul_rift_fx';
import { VOIDMAUL_SPAWN_BEATS, type VoidmaulSpawnBeat } from './voidmaul_spawn';

interface LiveRift {
  effect: VoidmaulRiftFx;
  age: number;
  visible: () => boolean;
}

export class VoidmaulRifts {
  private readonly live = new Map<number, LiveRift>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly onBeat?: (beat: VoidmaulSpawnBeat, groundAnchor: THREE.Vector3) => void,
  ) {}

  get count(): number {
    return this.live.size;
  }

  // A late view seeks directly to the ring clock's age. An old or unknown
  // rise must not replay the opening, and one unit cannot start it twice.
  start(
    unitId: number,
    riseAgeSeconds: number | null,
    groundAnchor: THREE.Vector3,
    worldScale: number,
    yaw = 0,
    visible: () => boolean = () => true,
  ): boolean {
    if (
      this.live.has(unitId) ||
      riseAgeSeconds === null ||
      !Number.isFinite(riseAgeSeconds) ||
      riseAgeSeconds < 0 ||
      riseAgeSeconds >= VOIDMAUL_RIFT_DURATION_S
    ) {
      return false;
    }
    const effect = new VoidmaulRiftFx();
    effect.root.position.copy(groundAnchor);
    effect.root.rotation.y = yaw;
    effect.root.scale.setScalar(worldScale);
    effect.update(riseAgeSeconds);
    effect.root.visible &&= visible();
    this.scene.add(effect.root);
    this.live.set(unitId, { effect, age: riseAgeSeconds, visible });
    return true;
  }

  update(dtMs: number): void {
    const dt = Math.max(0, dtMs) / 1000;
    for (const [unitId, rift] of this.live) {
      const before = rift.age;
      rift.age += dt;
      // Crossed beats are consumed even in fog. A late start or a later
      // return to visibility never replays an old explosion or camera kick.
      for (const beat of VOIDMAUL_SPAWN_BEATS) {
        if (before < beat.at && rift.age >= beat.at && rift.visible()) {
          this.onBeat?.(beat.kind, rift.effect.root.position);
        }
      }
      rift.effect.update(rift.age);
      if (rift.effect.done) {
        rift.effect.dispose();
        this.live.delete(unitId);
      } else {
        rift.effect.root.visible &&= rift.visible();
      }
    }
  }

  dispose(): void {
    for (const rift of this.live.values()) rift.effect.dispose();
    this.live.clear();
  }
}
