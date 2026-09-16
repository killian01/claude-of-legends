// Timed effect objects: an authored mesh (a burst that expands through its
// morph poses, roots that erupt and sink back) dropped into the scene for
// a fixed life, ticked with its age every frame, then removed and released.
// The pooled primitives cover sparks and rings; this is the seam for
// effects that are geometry of their own. Presentation only.

import type * as THREE from 'three';

interface TimedEffect {
  object: THREE.Object3D;
  bornAt: number;
  durationMs: number;
  tick?: (ageMs: number) => void;
}

// Releases what an effect owns: its materials, and any geometry it did not
// borrow from a template (those carry userData.sharedGeo).
export function disposeEffect(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    if (!mesh.userData.sharedGeo) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  });
}

export class TimedEffects {
  private readonly live: TimedEffect[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  // Adds the object for `durationMs`; `tick` runs at once with age 0 and
  // then every update, so the first frame already shows the authored start.
  attach(
    object: THREE.Object3D,
    durationMs: number,
    tick?: (ageMs: number) => void,
    now = performance.now(),
  ): void {
    this.scene.add(object);
    this.live.push({ object, bornAt: now, durationMs, tick });
    tick?.(0);
  }

  get count(): number {
    return this.live.length;
  }

  update(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const effect = this.live[i]!;
      const age = now - effect.bornAt;
      if (age >= effect.durationMs) {
        this.live.splice(i, 1);
        this.scene.remove(effect.object);
        disposeEffect(effect.object);
        continue;
      }
      effect.tick?.(age);
    }
  }

  dispose(): void {
    for (const effect of this.live) {
      this.scene.remove(effect.object);
      disposeEffect(effect.object);
    }
    this.live.length = 0;
  }
}
