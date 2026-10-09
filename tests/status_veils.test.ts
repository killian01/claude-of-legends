// The veil a hidden champion wears for its own side
// (src/render/status_veils.ts): a translucent-capable body fades by its
// opacity alone, and an opaque one is never relinked into a translucent one.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { StealthVeils, VEIL_OPACITY } from '../src/render/status_veils';
import type { VfxSystem } from '../src/render/vfx/system';

describe('the veil of a hidden champion', () => {
  const fx = { particles: { spawn: () => {} } } as unknown as VfxSystem;

  it('fades a translucent-capable body while hidden and puts it back after', () => {
    const solid = new THREE.MeshLambertMaterial();
    const fading = new THREE.MeshLambertMaterial({ transparent: true });
    const misty = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.8 });
    const root = new THREE.Group();
    for (const m of [solid, fading, misty]) root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
    const veils = new StealthVeils();
    const version = solid.version;
    veils.step(1, root, true, 0, 0, 2, fx, 0);
    expect(fading.opacity).toBeCloseTo(VEIL_OPACITY, 9);
    expect(misty.opacity).toBeCloseTo(0.8 * VEIL_OPACITY, 9);
    // An opaque material is never turned translucent: that relinks its
    // shader (render/program_keeper.ts).
    expect(solid.transparent).toBe(false);
    expect(solid.opacity).toBe(1);
    expect(solid.version).toBe(version);
    // Held for many frames, it never fades twice.
    veils.step(1, root, true, 0, 0, 2, fx, 500);
    expect(fading.opacity).toBeCloseTo(VEIL_OPACITY, 9);
    veils.step(1, root, false, 0, 0, 2, fx, 1000);
    expect(fading.opacity).toBe(1);
    expect(misty.opacity).toBeCloseTo(0.8, 9);
  });
});
