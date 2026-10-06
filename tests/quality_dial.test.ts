// The quality ladder at work on a renderer (src/render/quality_dial.ts):
// the canvas's ratio and the ground's shadows follow the rung, with no
// relink (the objects stop receiving shadows, the sun keeps casting); the
// next match starts where this one stood, leaner; ?quality= holds it; the
// seat report hears how finely the match is drawn.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawnQuality } from '../src/game/drawn_quality';
import { QUALITY_KEY } from '../src/game/quality_memory';
import { QualityDial, receiveShadows, SETTLE_MS } from '../src/render/quality_dial';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ground(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
  mesh.receiveShadow = true;
  return mesh;
}

// The part of a WebGLRenderer the dial touches, drawing 1536x864 CSS px.
function fakeGl(ratio: number) {
  const gl = {
    ratio,
    shadowMap: { autoUpdate: true, needsUpdate: false },
    domElement: { width: Math.round(1536 * ratio), height: Math.round(864 * ratio) },
    getPixelRatio: () => gl.ratio,
    setPixelRatio: (r: number) => {
      gl.ratio = r;
      gl.domElement.width = Math.round(1536 * r);
      gl.domElement.height = Math.round(864 * r);
    },
  };
  return gl;
}

// Frames on a 60 Hz screen whose GPU takes `msAtTop` at the ratio 1.25,
// as the pixels go, 15 percent less without shadows; the browser's times
// on the refreshes.
function play(dial: QualityDial, gl: ReturnType<typeof fakeGl>, msAtTop: number, seconds: number) {
  const p = 1000 / 60;
  let at = 0;
  let free = 0;
  while (at < seconds * 1000) {
    const work = msAtTop * (gl.ratio / 1.25) ** 2 * (gl.shadowMap.autoUpdate ? 1 : 0.85);
    free = Math.max(free, at) + work;
    at = Math.max(at + p, Math.floor(free / p) * p);
    dial.frame(at, 2);
  }
}

const laptop = (pin: 'full' | 'low' | null = null, mode: 'classic' | 'royale' = 'classic') =>
  new QualityDial({ mode, top: 1.25, phone: false, pin, now: 0 });

describe('the shadows on the ground', () => {
  it('stop and start again on the objects that received them, and no other', () => {
    const scene = new THREE.Scene();
    const a = ground();
    const b = new THREE.Mesh();
    b.receiveShadow = false;
    scene.add(a, b);
    expect(receiveShadows(scene, false)).toBe(1);
    expect(a.receiveShadow).toBe(false);
    // One added since is caught by the next sweep.
    const c = ground();
    scene.add(c);
    expect(receiveShadows(scene, false)).toBe(1);
    expect(receiveShadows(scene, true)).toBe(2);
    expect([a.receiveShadow, b.receiveShadow, c.receiveShadow]).toEqual([true, false, true]);
  });
});

describe('the dial', () => {
  it('draws a weak GPU finer or coarser by its frame rate, the shadows last', () => {
    const dial = laptop();
    expect(dial.lean).toEqual({ antialias: true, effectLights: true });
    const gl = fakeGl(dial.rung.ratio);
    const scene = new THREE.Scene();
    const floor = ground();
    scene.add(floor);
    const ratios: number[] = [];
    dial.attach({
      gl: gl as unknown as THREE.WebGLRenderer,
      scene,
      onRatio: (r) => ratios.push(r),
    });
    expect(drawnQuality()).toEqual({
      step: 0,
      lean: 0,
      ratio: 1.25,
      w: 1920,
      h: 1080,
      shadows: true,
    });
    // Not judged while the match settles.
    play(dial, gl, 75, SETTLE_MS / 1000 - 1);
    expect(gl.ratio).toBe(1.25);
    play(dial, gl, 75, 120);
    expect(ratios).toEqual([1, 0.85, 0.75]);
    expect(gl.shadowMap.autoUpdate).toBe(false);
    expect(floor.receiveShadow).toBe(false);
    expect(drawnQuality()).toMatchObject({ step: 4, ratio: 0.75, w: 1152, h: 648, shadows: false });
    dial.dispose();
    expect(drawnQuality()).toBeNull();
  });

  it('starts the next match of the kind where this one stood, without the lights', () => {
    const first = laptop();
    const gl = fakeGl(1.25);
    first.attach({
      gl: gl as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      onRatio() {},
    });
    play(first, gl, 40, 60);
    const stood = first.rung;
    expect(stood.ratio).toBeLessThan(1.25);
    first.dispose();
    expect(JSON.parse(store.get(QUALITY_KEY)!).hz).toBeCloseTo(60, 0);
    const next = laptop();
    expect(next.lean).toEqual({ antialias: true, effectLights: false });
    // A rung up from where it stood: the lights buy about that.
    expect(next.rung.ratio).toBeGreaterThan(stood.ratio);
    // The other kind of match learned nothing.
    expect(laptop(null, 'royale').rung.ratio).toBe(1.25);
  });

  it('is held by the address, and remembers nothing then', () => {
    const full = laptop('full');
    const gl = fakeGl(1.25);
    full.attach({
      gl: gl as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      onRatio() {},
    });
    play(full, gl, 75, 120);
    expect(gl.ratio).toBe(1.25);
    full.dispose();
    expect(store.has(QUALITY_KEY)).toBe(false);
    const low = laptop('low');
    expect(low.rung).toEqual({ ratio: 0.75, shadows: false });
    expect(low.lean).toEqual({ antialias: false, effectLights: false });
  });
});
