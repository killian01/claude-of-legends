// The quality ladder at work on a renderer (src/render/quality_dial.ts): the
// canvas's ratio and the ground's shadows follow the rung, with no relink
// (the objects stop receiving shadows, the sun keeps casting); every match
// starts at the top, and two in a row whose top drew far too slowly make
// the next leaner; ?quality= holds it; the seat report hears how finely it
// draws.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawnQuality } from '../src/game/drawn_quality';
import { QUALITY_KEY } from '../src/game/quality_memory';
import { QualityDial, receiveShadows, rungCosts } from '../src/render/quality_dial';

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

// A dial attached to a fake renderer and a scene with a floor.
function attached(dial: QualityDial) {
  const gl = fakeGl(dial.rung.ratio);
  const floor = ground();
  const scene = new THREE.Scene();
  scene.add(floor);
  const ratios: number[] = [];
  dial.attach({
    gl: gl as unknown as THREE.WebGLRenderer,
    scene,
    onRatio: (r) => ratios.push(r),
  });
  return { gl, floor, ratios };
}

// Frames on a 60 Hz screen whose GPU takes `msAtTop` at the ratio 1.25, as
// the pixels go, 15 percent less without shadows; times on the refreshes,
// from `from` until `seconds`; answers the last.
function play(
  dial: QualityDial,
  gl: ReturnType<typeof fakeGl>,
  msAtTop: number,
  seconds: number,
  from = 0,
): number {
  const p = 1000 / 60;
  let at = from;
  let free = from;
  while (at < seconds * 1000) {
    const work = msAtTop * (gl.ratio / 1.25) ** 2 * (gl.shadowMap.autoUpdate ? 1 : 0.85);
    free = Math.max(free, at) + work;
    at = Math.max(at + p, Math.floor(free / p) * p);
    dial.frame(at, 2);
  }
  return at;
}

const laptop = (pin: 'full' | 'low' | null = null, mode: 'classic' | 'royale' = 'classic') =>
  new QualityDial({ mode, top: 1.25, phone: false, pin, now: 0 });

const remembered = () => JSON.parse(store.get(QUALITY_KEY)!);

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
  it('draws a weak GPU coarser rung by rung, the shadows last', () => {
    const dial = laptop();
    expect(dial.lean).toEqual({ antialias: true, effectLights: true });
    const { gl, floor, ratios } = attached(dial);
    expect(drawnQuality()).toEqual({
      step: 0,
      lean: 0,
      ratio: 1.25,
      w: 1920,
      h: 1080,
      shadows: true,
    });
    // Not judged while the match settles (10 s), nor in the top's first
    // twenty seconds and four fresh windows (of 14 frames, 1.05 s each).
    let at = play(dial, gl, 75, 34.2);
    expect(gl.ratio).toBe(1.25);
    at = play(dial, gl, 75, 35.2, at);
    expect(gl.ratio).toBe(1);
    play(dial, gl, 75, 120, at);
    // Each step kept still short, the next at once, to the floor's ratio
    // and then without shadows.
    expect(ratios).toEqual([1, 0.85, 0.75]);
    expect(gl.shadowMap.autoUpdate).toBe(false);
    expect(floor.receiveShadow).toBe(false);
    expect(drawnQuality()).toMatchObject({ step: 4, ratio: 0.75, w: 1152, h: 648, shadows: false });
    dial.dispose();
    expect(drawnQuality()).toBeNull();
  });

  it('starts every match at the top, a level leaner after two tops far too slow', () => {
    // 40 ms a frame at the top, whatever the lean: under 0.6 of 60 a second,
    // so every second match makes the next leaner, until the leanest.
    const leans: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const dial = laptop();
      expect(dial.rung).toEqual({ ratio: 1.25, shadows: true });
      leans.push(dial.lean);
      const { gl } = attached(dial);
      play(dial, gl, 40, 150);
      expect(gl.ratio).toBeLessThan(1.25);
      dial.dispose();
    }
    const [full, lights, both] = [
      { antialias: true, effectLights: true },
      { antialias: true, effectLights: false },
      { antialias: false, effectLights: false },
    ];
    expect(leans).toEqual([full, full, lights, lights, both]);
    expect(remembered().modes.classic).toEqual({ lean: 2, played: 1, slow: 1 });
    expect(remembered().hz).toBeCloseTo(60, 0);
    // The other kind of match learned nothing; another ratio starts at its own.
    expect(laptop(null, 'royale').lean).toEqual({ antialias: true, effectLights: true });
    const two = new QualityDial({ mode: 'classic', top: 2, phone: false, pin: null, now: 0 });
    expect(two.rung).toEqual({ ratio: 2, shadows: true });
    expect(two.leanLevel).toBe(2);
  });

  it('writes what the match leaves every thirty seconds along the way', () => {
    let writes = 0;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        writes++;
        store.set(k, v);
      },
    });
    const dial = laptop();
    const { gl } = attached(dial);
    play(dial, gl, 40, 125);
    expect(writes).toBe(5);
    expect(remembered().modes.classic).toEqual({ lean: 0, played: 0, slow: 1 });
    dial.dispose();
  });

  it("keeps the other kind of match's memory when it writes its own", () => {
    const royale = { lean: 2, played: 3, slow: 1 };
    store.set(QUALITY_KEY, JSON.stringify({ hz: 60, modes: { royale } }));
    const dial = laptop();
    const { gl } = attached(dial);
    play(dial, gl, 40, 125);
    dial.dispose();
    expect(remembered().modes).toEqual({ royale, classic: { lean: 0, played: 0, slow: 1 } });
  });

  it("stops a phone's rungs at the ratio 1, a desktop's at 0.75", () => {
    const rungs = (phone: boolean, pin: 'low' | null = null) =>
      new QualityDial({ mode: 'classic', top: 1.5, phone, pin, now: 0 });
    expect(rungs(true).rungs.map((r) => r.ratio)).toEqual([1.5, 1.25, 1, 1]);
    expect(rungs(true, 'low').rung).toEqual({ ratio: 1, shadows: false });
    expect(rungs(false).rungs.map((r) => r.ratio)).toEqual([1.5, 1.25, 1, 0.85, 0.75, 0.75]);
  });

  it('hands the ladder the cost its rungs are documented to draw at', () => {
    // A ratio of 1 instead of 1.25 in 0.70 of the time, about 0.9 of it
    // without shadows.
    const costs = rungCosts(laptop().rungs);
    expect(costs[0]).toBe(1);
    expect(costs[1]).toBeCloseTo(0.7, 3);
    expect(costs[4]! / costs[3]!).toBeCloseTo(0.9, 3);
  });

  it('judges nothing for four seconds after the view changed under it', () => {
    const dial = laptop();
    const { gl } = attached(dial);
    let at = play(dial, gl, 10, 40);
    dial.pause(at);
    const judged = dial.ladder.judgedMs;
    const paused = at;
    at = play(dial, gl, 10, paused / 1000 + 3.9, at);
    expect(dial.ladder.judgedMs).toBe(judged);
    play(dial, gl, 10, paused / 1000 + 4.6, at);
    expect(dial.ladder.judgedMs).toBeGreaterThan(judged);
  });

  it('never remembers a refresh that only matched the frames', () => {
    // Every frame two refreshes on a 60 Hz screen, nothing known before: a
    // 30 Hz screen would draw the same, so 30 is not kept as its rate.
    const dial = laptop();
    const { gl } = attached(dial);
    play(dial, gl, 33.4, 60);
    dial.dispose();
    expect(remembered().hz).toBeNull();
  });

  it("takes the page's own refresh over the one remembered", async () => {
    // A battery saver holds every page at 30, the menus too: the 60 an
    // earlier session remembered is not this page's to reach.
    vi.resetModules();
    const painters: ((at: number) => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (at: number) => void) => painters.push(cb));
    const { watchFrames } = await import('../src/game/frame_rate');
    const fresh = await import('../src/render/quality_dial');
    store.set(QUALITY_KEY, JSON.stringify({ hz: 60, modes: {} }));
    watchFrames();
    for (let i = 1; i <= 60; i++) painters.shift()?.((i * 1000) / 30);
    const dial = new fresh.QualityDial({
      mode: 'classic',
      top: 1.25,
      phone: false,
      pin: null,
      now: 0,
    });
    const { gl } = attached(dial);
    play(dial, gl, 33.4, 120);
    expect(gl.ratio).toBe(1.25);
    dial.dispose();
  });

  it('is held by the address, and remembers nothing then', () => {
    const full = laptop('full');
    const { gl } = attached(full);
    play(full, gl, 75, 120);
    expect(gl.ratio).toBe(1.25);
    full.dispose();
    expect(store.has(QUALITY_KEY)).toBe(false);
    const classic = { lean: 2, played: 0, slow: 0 };
    store.set(QUALITY_KEY, JSON.stringify({ hz: 60, modes: { classic } }));
    expect(laptop('full').lean).toEqual({ antialias: true, effectLights: true });
    const low = laptop('low');
    expect(low.rung).toEqual({ ratio: 0.75, shadows: false });
    expect(low.lean).toEqual({ antialias: false, effectLights: false });
    const lowGl = attached(low).gl;
    play(low, lowGl, 5, 120);
    expect([lowGl.ratio, lowGl.shadowMap.autoUpdate]).toEqual([0.75, false]);
  });
});
