// Resolved slams own a fixed spot of ground. The footprint survives its
// attacker, while old snapshots cannot replay an impact or camera kick.
import type * as THREE from 'three';
import type { VoidmaulSlamNote } from '../game/voidmaul_slam_notes';
import type { GroundHeight } from './terrain';
import { VOIDMAUL_ATTACK_FX_DURATION_S, VoidmaulAttackFx } from './vfx/voidmaul_attack_fx';
import type { VoidmaulArena } from './voidmaul_arena';

export const VOIDMAUL_MAX_IMPACTS = 24;

interface LiveImpact {
  effect: VoidmaulAttackFx;
  age: number;
}

export class VoidmaulImpacts {
  private readonly live: LiveImpact[] = [];
  private readonly lastAt = new Map<number, number>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundHeight: GroundHeight,
    private readonly onImpact?: (at: THREE.Vector3) => void,
  ) {}

  get count(): number {
    return this.live.length;
  }

  start(
    note: VoidmaulSlamNote,
    worldTime: number,
    groundAnchor: THREE.Vector3,
    visible = true,
    yaw = 0,
    arena?: VoidmaulArena,
  ): boolean {
    const age = worldTime - note.at;
    if (
      !Number.isFinite(age) ||
      age < -0.05 ||
      !Number.isFinite(note.radius) ||
      note.radius <= 0 ||
      !groundAnchor.toArray().every(Number.isFinite) ||
      note.at <= (this.lastAt.get(note.unitId) ?? -Infinity)
    ) {
      return false;
    }
    this.lastAt.set(note.unitId, note.at);
    // Respawned bodies receive new IDs. Bound remembered clocks as well
    // as GPU effects over a long match.
    if (this.lastAt.size > 128) this.lastAt.delete(this.lastAt.keys().next().value!);
    if (!visible || age >= VOIDMAUL_ATTACK_FX_DURATION_S) return false;
    if (this.live.length >= VOIDMAUL_MAX_IMPACTS) this.live.shift()!.effect.dispose();
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const dx = arena ? arena.center.x - groundAnchor.x : 0;
    const dz = arena ? arena.center.z - groundAnchor.z : 0;
    const effect = new VoidmaulAttackFx(
      note.radius,
      arena
        ? { centerX: dx * cos - dz * sin, centerZ: dx * sin + dz * cos, radius: arena.radius }
        : undefined,
    );
    effect.root.position.copy(groundAnchor);
    effect.root.rotation.y = yaw;
    effect.conformGround((x, z) => {
      const anchor = effect.root.position;
      return (
        this.groundHeight(anchor.x + x * cos + z * sin, anchor.z - x * sin + z * cos) - anchor.y
      );
    });
    effect.update(Math.max(0, age));
    this.scene.add(effect.root);
    this.live.push({ effect, age: Math.max(0, age) });
    // A delayed snapshot seeks straight to its debris/footprint phase.
    // It must not flash or shake as if the old contact happened now.
    if (age <= 0.15) this.onImpact?.(effect.root.position);
    return true;
  }

  update(dtMs: number): void {
    const dt = Number.isFinite(dtMs) ? Math.max(0, dtMs) / 1000 : 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const impact = this.live[i]!;
      impact.age += dt;
      if (!impact.effect.update(impact.age)) {
        impact.effect.dispose();
        this.live.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const impact of this.live) impact.effect.dispose();
    this.live.length = 0;
    this.lastAt.clear();
  }
}
