import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PlanetStage } from '../src/render/planet_stage';
import { voidmaulAttackFeedback } from '../src/render/voidmaul_attack_feedback';

function view() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return {
    camera,
    vfx: { lightPulse: vi.fn() },
    toScene: (at: THREE.Vector3) => at.clone(),
    gain: vi.fn(() => 1),
    shake: vi.fn(),
  };
}

describe('Voidmaul attack contact feedback', () => {
  it('flashes and gives a strong camera kick for a nearby visible impact', () => {
    const context = view();
    const at = new THREE.Vector3();
    voidmaulAttackFeedback(at, context);
    expect(context.vfx.lightPulse).toHaveBeenCalledWith(0, 0, 0xb8ccff, 18.5, 720);
    expect(context.shake).toHaveBeenCalledWith(0.46);
    expect(at.toArray()).toEqual([0, 0, 0]);
    context.gain.mockReturnValue(0.25);
    voidmaulAttackFeedback(at, context);
    expect(context.shake).toHaveBeenLastCalledWith(0.115);
  });

  it('keeps offscreen or distant contacts from shaking the view', () => {
    const context = view();
    voidmaulAttackFeedback(new THREE.Vector3(1000, 0, 0), context);
    expect(context.shake).not.toHaveBeenCalled();
    expect(context.gain).not.toHaveBeenCalled();
    context.gain.mockReturnValue(0);
    voidmaulAttackFeedback(new THREE.Vector3(), context);
    expect(context.shake).not.toHaveBeenCalled();
  });

  it('checks the curved planet position when the flat chart would still be onscreen', () => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
    camera.position.set(100, 22, 138);
    camera.lookAt(100, 0, 100);
    camera.updateMatrixWorld(true);
    const context = {
      ...view(),
      camera,
      toScene: (at: THREE.Vector3) => new THREE.Vector3(at.x, at.y, 200 - at.z),
      planet: {
        bentWorld: (x: number, y: number, z: number) =>
          PlanetStage.prototype.bentWorld.call({ half: 100, radius: 80 } as never, x, y, z),
      },
    };
    const at = new THREE.Vector3(78, 0, 80);
    const flat = context.toScene(at).project(camera);
    expect(Math.abs(flat.x)).toBeLessThan(1);
    expect(Math.abs(flat.y)).toBeLessThan(1);
    voidmaulAttackFeedback(at, context);
    expect(context.shake).not.toHaveBeenCalled();
  });
});
