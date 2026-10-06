// The effects' pooled lights (src/render/vfx/system.ts): three point
// lights every lit pixel of the ground shades, flashes or not; a lean
// context (src/game/quality_memory.ts) is made with none, and a spell's
// light pulse then lights nothing instead of failing.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VfxSystem } from '../src/render/vfx/system';

beforeEach(() => {
  // The particles' sprite atlas is painted on a canvas; no painting here.
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pointLights = (scene: THREE.Scene): THREE.PointLight[] => {
  const found: THREE.PointLight[] = [];
  scene.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) found.push(o as THREE.PointLight);
  });
  return found;
};

describe('the pooled lights', () => {
  it('are three, dark until a pulse lights one', () => {
    const scene = new THREE.Scene();
    const fx = new VfxSystem(scene);
    expect(pointLights(scene)).toHaveLength(3);
    expect(fx.pooledLights().every((l) => l.intensity === 0)).toBe(true);
    fx.lightPulse(1, 2, 0xffffff, 4, 300);
    fx.update(performance.now() + 30, 16, new THREE.Vector3(0, -1, 0));
    expect(fx.pooledLights().some((l) => l.intensity > 0)).toBe(true);
  });

  it('are none on a lean context, and a pulse lights nothing', () => {
    const scene = new THREE.Scene();
    const fx = new VfxSystem(scene, undefined, 0);
    expect(pointLights(scene)).toHaveLength(0);
    expect(fx.pooledLights()).toEqual([]);
    expect(() => fx.lightPulse(1, 2, 0xffffff, 4, 300)).not.toThrow();
  });
});
