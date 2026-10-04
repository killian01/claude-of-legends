import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOIDMAUL_SCALE } from '../src/render/creatures/voidmaul_visual';
import { Renderer } from '../src/render/renderer';
import { VOIDMAUL_RIFT_DURATION_S, VoidmaulRiftFx } from '../src/render/vfx/voidmaul_rift_fx';
import { VoidmaulRifts } from '../src/render/voidmaul_rifts';
import type { VoidmaulSpawnBeat } from '../src/render/voidmaul_spawn';

afterEach(() => vi.restoreAllMocks());

describe('Voidmaul ground rift lifecycle', () => {
  it('lights a visible rupture but limits the camera kick to a nearby anchor inside the viewport', () => {
    const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 500);
    camera.position.set(0, 100, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const lightPulse = vi.fn();
    const addShake = vi.fn();
    const renderer = {
      camera,
      camFocus: { x: 0, z: 0 },
      vfx: { lightPulse },
      addShake,
      toScene: (at: THREE.Vector3) => at.clone(),
      sfxGain: (Renderer.prototype as unknown as { sfxGain: (x: number, z: number) => number })
        .sfxGain,
    };
    const feedback = (
      Renderer.prototype as unknown as {
        voidmaulSpawnBeat: (beat: VoidmaulSpawnBeat, at: THREE.Vector3) => void;
      }
    ).voidmaulSpawnBeat;
    feedback.call(renderer, 'rupture', new THREE.Vector3(5, 0, 5));
    expect(lightPulse).toHaveBeenCalledTimes(1);
    expect(addShake).toHaveBeenCalledTimes(1);
    expect(addShake.mock.calls[0]![0]).toBeGreaterThan(0);
    expect(addShake.mock.calls[0]![0]).toBeLessThan(0.3);
    addShake.mockClear();
    // This is still inside the wide camera, but beyond audible/kick range.
    feedback.call(renderer, 'stomp', new THREE.Vector3(50, 0, 0));
    expect(addShake).not.toHaveBeenCalled();
    renderer.camFocus.x = 200;
    // Nearby according to the distance gate, but outside the camera image.
    feedback.call(renderer, 'stomp', new THREE.Vector3(200, 0, 0));
    expect(addShake).not.toHaveBeenCalled();
    expect(lightPulse).toHaveBeenCalledTimes(3);
  });

  it('fires rupture, landing and stomp once when their beats are crossed, including a dropped frame', () => {
    const onBeat = vi.fn();
    const rifts = new VoidmaulRifts(new THREE.Scene(), onBeat);
    rifts.start(1, 0, new THREE.Vector3(10, 3, 20), 6.6);
    rifts.update(440);
    expect(onBeat).not.toHaveBeenCalled();
    rifts.update(20);
    expect(onBeat.mock.calls.map(([beat]) => beat)).toEqual(['rupture']);
    // A long frame crosses both the rear-leg arrival and main fore stomp.
    rifts.update(1900);
    expect(onBeat.mock.calls.map(([beat]) => beat)).toEqual(['rupture', 'landing', 'stomp']);
    for (const [, at] of onBeat.mock.calls) expect(at.toArray()).toEqual([10, 3, 20]);
    rifts.update(0);
    rifts.update(-100);
    rifts.update(300);
    expect(onBeat).toHaveBeenCalledTimes(3);
    rifts.dispose();
    rifts.update(5000);
    expect(onBeat).toHaveBeenCalledTimes(3);
  });

  it('discards past beats on late seek, including a view arriving exactly on the stomp', () => {
    const onBeat = vi.fn();
    const rifts = new VoidmaulRifts(new THREE.Scene(), onBeat);
    rifts.start(1, 2.1, new THREE.Vector3(), 6.6);
    expect(onBeat).not.toHaveBeenCalled();
    rifts.update(250);
    expect(onBeat.mock.calls.map(([beat]) => beat)).toEqual(['stomp']);
    rifts.start(2, 2.3, new THREE.Vector3(), 6.6);
    rifts.update(1000);
    expect(onBeat).toHaveBeenCalledTimes(1);
    rifts.dispose();
  });

  it('consumes invisible beats without a deferred flash or shake when sight returns', () => {
    const onBeat = vi.fn();
    const rifts = new VoidmaulRifts(new THREE.Scene(), onBeat);
    let visible = false;
    rifts.start(1, 0, new THREE.Vector3(), 6.6, 0, () => visible);
    rifts.update(600);
    expect(onBeat).not.toHaveBeenCalled();
    visible = true;
    rifts.update(100);
    expect(onBeat).not.toHaveBeenCalled();
    rifts.update(1350);
    expect(onBeat.mock.calls.map(([beat]) => beat)).toEqual(['landing']);
    visible = false;
    rifts.update(300);
    visible = true;
    rifts.update(100);
    expect(onBeat).toHaveBeenCalledTimes(1);
    rifts.dispose();
  });

  it('seeks a late rise and keeps its original ground transform when the creature moves and turns', () => {
    const update = vi.spyOn(VoidmaulRiftFx.prototype, 'update');
    const scene = new THREE.Scene();
    const rifts = new VoidmaulRifts(scene);
    const body = new THREE.Group();
    body.position.set(10, 3, 20);
    const anchor = body.position.clone();
    const worldScale = VOIDMAUL_SCALE * 1.1;
    expect(rifts.start(42, 2.2, anchor, worldScale, 0.3)).toBe(true);
    const root = scene.children[0]!;
    expect(update).toHaveBeenLastCalledWith(2.2);
    expect(root.parent).toBe(scene);
    expect(root.scale.x).toBeCloseTo(14.19);
    body.position.set(18, 8, 40);
    body.rotation.y = 2;
    anchor.copy(body.position);
    rifts.update(400);
    expect(update).toHaveBeenLastCalledWith(2.6);
    expect(root.position.toArray()).toEqual([10, 3, 20]);
    expect(root.rotation.y).toBe(0.3);
    expect(root.scale.toArray()).toEqual([worldScale, worldScale, worldScale]);
    expect(rifts.count).toBe(1);
    rifts.dispose();
  });

  it('does not replay unknown, future, expired or duplicate appearances', () => {
    const scene = new THREE.Scene();
    const rifts = new VoidmaulRifts(scene);
    const anchor = new THREE.Vector3();
    for (const age of [null, -0.01, NaN, Infinity, VOIDMAUL_RIFT_DURATION_S, 20]) {
      expect(rifts.start(1, age, anchor, 6)).toBe(false);
    }
    expect(rifts.count).toBe(0);
    expect(scene.children.length).toBe(0);
    expect(rifts.start(1, 0, anchor, 6)).toBe(true);
    expect(rifts.start(1, 1, new THREE.Vector3(30, 0, 50), 9)).toBe(false);
    expect(rifts.count).toBe(1);
    expect(scene.children[0]!.position.toArray()).toEqual([0, 0, 0]);
    rifts.dispose();
  });

  it('continues closing after Spawn is over and releases its resources exactly once', () => {
    const dispose = vi.spyOn(VoidmaulRiftFx.prototype, 'dispose');
    const scene = new THREE.Scene();
    const rifts = new VoidmaulRifts(scene);
    expect(rifts.start(1, 4, new THREE.Vector3(), 6)).toBe(true);
    // The four-second body clip is finished, while the rift still has
    // its closing cracks and residual dust to dissipate.
    rifts.update(500);
    expect(rifts.count).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    rifts.update(110);
    expect(rifts.count).toBe(0);
    expect(scene.children.length).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    rifts.update(1000);
    rifts.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('respects visibility without pausing or restarting the ring clock', () => {
    const update = vi.spyOn(VoidmaulRiftFx.prototype, 'update');
    const scene = new THREE.Scene();
    const rifts = new VoidmaulRifts(scene);
    let visible = false;
    rifts.start(1, 1, new THREE.Vector3(), 6, 0, () => visible);
    const root = scene.children[0]!;
    expect(root.visible).toBe(false);
    rifts.update(1000);
    expect(root.visible).toBe(false);
    visible = true;
    rifts.update(200);
    expect(update).toHaveBeenLastCalledWith(2.2);
    expect(root.visible).toBe(true);
    rifts.dispose();
  });

  it('releases every live opening on renderer teardown', () => {
    const dispose = vi.spyOn(VoidmaulRiftFx.prototype, 'dispose');
    const scene = new THREE.Scene();
    const rifts = new VoidmaulRifts(scene);
    rifts.start(1, 0.5, new THREE.Vector3(), 6);
    rifts.start(2, 2, new THREE.Vector3(10, 0, 10), 7);
    expect(rifts.count).toBe(2);
    rifts.dispose();
    expect(rifts.count).toBe(0);
    expect(scene.children.length).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(2);
    rifts.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
