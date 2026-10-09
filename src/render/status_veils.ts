// Two status reads drawn on a champion's body, presentation only. A hidden
// champion its viewer can still see (its own, an ally: an enemy hidden is
// never drawn at all) sheds a faint shimmer, so a person knows the hiding
// holds (Fenn's veil, Elowen's mist, Nisk's Lie Low), and a body drawn
// translucent-capable (the manifest's fades, Elowen's mist) turns half
// see-through as well. A fumbling champion carries a small swirl of dust
// over its head while its attacks miss (CONTEXT.md: Fumble).

import type * as THREE from 'three';
import { SPRITE } from './vfx/sprites';
import type { VfxSystem } from './vfx/system';

// How see-through a hidden champion reads to its own side.
export const VEIL_OPACITY = 0.38;
const SHIMMER_EVERY_MS = 140;
const SWIRL_EVERY_MS = 90;

function eachMaterial(root: THREE.Object3D, fn: (m: THREE.Material) => void): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m) fn(m);
  });
}

// One champion body's veil: faded while hidden, put back as it was after.
// The body is the rigged model alone, whose materials are its own (a
// holder's rings share theirs across the scene); a champion still drawn as
// its procedural figure only shimmers.
export class StealthVeils {
  private readonly veiled = new Map<number, { root: THREE.Object3D | null; lastShimmer: number }>();

  step(
    id: number,
    root: THREE.Object3D | null,
    hidden: boolean,
    x: number,
    z: number,
    height: number,
    fx: VfxSystem,
    nowMs: number,
  ): void {
    const held = this.veiled.get(id);
    if (!hidden) {
      if (held) this.lift(id);
      return;
    }
    if (!held || held.root !== root) {
      if (held) this.lift(id);
      // Only a material drawn translucent already fades: turning an opaque
      // one translucent relinks its shader, a stall of seconds on a phone
      // (render/program_keeper.ts). An opaque body only shimmers.
      if (root)
        eachMaterial(root, (m) => {
          if (!m.transparent) return;
          if (m.userData.veilKept === undefined) m.userData.veilKept = m.opacity;
          m.opacity = (m.userData.veilKept as number) * VEIL_OPACITY;
        });
      this.veiled.set(id, { root, lastShimmer: 0 });
      return;
    }
    if (nowMs - held.lastShimmer < SHIMMER_EVERY_MS) return;
    held.lastShimmer = nowMs;
    const a = Math.random() * Math.PI * 2;
    fx.particles.spawn({
      x: x + Math.cos(a) * 0.45,
      y: 0.3 + Math.random() * height,
      z: z + Math.sin(a) * 0.45,
      vy: 0.5,
      life: 0.6,
      size0: 0.3,
      size1: 0.05,
      color0: 0xe8fff0,
      color1: 0x9fd889,
      alpha0: 0.55,
      sprite: SPRITE.fleck,
    });
  }

  // The body as it was, when the hiding ends or the body is let go.
  lift(id: number): void {
    const held = this.veiled.get(id);
    if (!held) return;
    this.veiled.delete(id);
    if (!held.root) return;
    eachMaterial(held.root, (m) => {
      const kept = m.userData.veilKept as number | undefined;
      if (kept === undefined) return;
      m.opacity = kept;
      delete m.userData.veilKept;
    });
  }
}

// The swirl over a fumbling head: a few dust flecks wheeling round.
export function fumbleSwirl(
  fx: VfxSystem,
  x: number,
  y: number,
  z: number,
  nowMs: number,
  state: { lastAt: number },
): void {
  if (nowMs - state.lastAt < SWIRL_EVERY_MS) return;
  state.lastAt = nowMs;
  const a = (nowMs / 160) % (Math.PI * 2);
  for (let i = 0; i < 2; i++) {
    const b = a + i * Math.PI;
    fx.particles.spawn({
      x: x + Math.cos(b) * 0.45,
      y,
      z: z + Math.sin(b) * 0.45,
      vx: -Math.sin(b) * 1.4,
      vz: Math.cos(b) * 1.4,
      life: 0.35,
      size0: 0.32,
      size1: 0.12,
      color0: 0xffd0a0,
      color1: 0xe8652a,
      alpha0: 0.9,
      sprite: SPRITE.fleck,
    });
  }
}
