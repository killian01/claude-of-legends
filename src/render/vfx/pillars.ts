// Pooled light pillars: open tapered cylinders that rise fast, hold, and
// fade while widening slightly. The vertical exclamation mark under a big
// impact or a champion's ultimate moment.

import * as THREE from 'three';
import type { GroundHeight } from '../terrain';

const POOL = 8;

interface PillarSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  bornAt: number;
  duration: number;
  radius: number;
  height: number;
  peak: number;
  active: boolean;
}

export class LightPillars {
  private readonly slots: PillarSlot[] = [];
  private readonly geometry: THREE.CylinderGeometry;

  constructor(
    scene: THREE.Scene,
    private readonly groundHeight?: GroundHeight,
  ) {
    this.geometry = new THREE.CylinderGeometry(0.55, 1, 1, 10, 1, true);
    this.geometry.translate(0, 0.5, 0);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      mat.toneMapped = false;
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.userData.sharedGeo = true;
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.slots.push({
        mesh,
        mat,
        bornAt: 0,
        duration: 1,
        radius: 1,
        height: 1,
        peak: 0.3,
        active: false,
      });
    }
  }

  spawn(
    x: number,
    z: number,
    radius: number,
    height: number,
    color: number,
    durationMs: number,
    peakOpacity = 0.3,
  ): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
    slot.active = true;
    slot.bornAt = performance.now();
    slot.duration = durationMs;
    slot.radius = radius;
    slot.height = height;
    slot.peak = peakOpacity;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, this.groundHeight?.(x, z) ?? 0, z);
    slot.mat.color.set(color);
  }

  update(now: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      const t = (now - s.bornAt) / s.duration;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const rise = Math.min(1, t / 0.14);
      const fade = t < 0.2 ? t / 0.2 : (1 - (t - 0.2) / 0.8) ** 1.5;
      s.mesh.scale.set(
        s.radius * (1 + t * 0.35),
        s.height * (0.25 + 0.75 * rise),
        s.radius * (1 + t * 0.35),
      );
      s.mat.opacity = s.peak * fade;
    }
  }
}
