import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoidmaulSlamNote } from '../src/game/voidmaul_slam_notes';
import { Renderer } from '../src/render/renderer';
import { VoidmaulAttackFx } from '../src/render/vfx/voidmaul_attack_fx';
import { VOIDMAUL_MAX_IMPACTS, VoidmaulImpacts } from '../src/render/voidmaul_impacts';
import { VOIDMAUL_STONE_COUNT } from '../src/sim/combat/voidmaul_stones';

afterEach(() => vi.restoreAllMocks());

function slam(at = 1.75, unitId = 42): VoidmaulSlamNote {
  return { unitId, targetId: 7, x: 10, z: 20, radius: 5.5, at };
}

describe('resolved Voidmaul impacts', () => {
  it('drapes the scar on sloping ground and keeps it fixed after the attacker moves or dies', () => {
    const scene = new THREE.Scene();
    const height = (x: number, z: number) => 3 + x * 0.1 - z * 0.05;
    const impacts = new VoidmaulImpacts(scene, height);
    const anchor = new THREE.Vector3(10, height(10, 20), 20);
    expect(impacts.start(slam(), 1.75, anchor)).toBe(true);
    const root = scene.children[0]!;
    const crater = root.getObjectByName('Voidmaul_AttackCrater') as THREE.Mesh;
    const vertices = crater.geometry.getAttribute('position');
    for (const i of [0, Math.floor(vertices.count / 2), vertices.count - 1]) {
      const worldY = root.position.y + crater.position.y + vertices.getY(i);
      const floor = height(root.position.x + vertices.getX(i), root.position.z + vertices.getZ(i));
      expect(worldY - floor).toBeCloseTo(0.018, 5);
    }
    anchor.set(50, 8, 60);
    impacts.update(3000);
    expect(root.position.toArray()).toEqual([10, 3, 20]);
    expect(root.parent).toBe(scene);
    expect(root.getObjectByName('Voidmaul_AttackCrater')?.visible).toBe(true);
    expect(impacts.count).toBe(1);
    impacts.dispose();
  });

  it('seeks late events without replaying contact feedback or duplicate snapshots', () => {
    const onImpact = vi.fn();
    const update = vi.spyOn(VoidmaulAttackFx.prototype, 'update');
    const impacts = new VoidmaulImpacts(new THREE.Scene(), () => 0, onImpact);
    expect(impacts.start(slam(), 5.75, new THREE.Vector3())).toBe(true);
    expect(update).toHaveBeenLastCalledWith(4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(impacts.start(slam(), 6, new THREE.Vector3())).toBe(false);
    impacts.update(25000);
    expect(impacts.count).toBe(0);
    expect(impacts.start(slam(), 1.75, new THREE.Vector3())).toBe(false);
    expect(impacts.start(slam(40), 40.05, new THREE.Vector3())).toBe(true);
    expect(onImpact).toHaveBeenCalledTimes(1);
    impacts.dispose();
  });

  it('uses the authoritative Crush kind once and retains both paw prints after a late seek', () => {
    const scene = new THREE.Scene();
    const feedback = vi.fn();
    const impacts = new VoidmaulImpacts(scene, (x, z) => x * 0.1 - z * 0.04, feedback);
    const note = { ...slam(), kind: 'crush' as const };
    const anchor = new THREE.Vector3(10, 0.2, 20);
    expect(impacts.start(note, 5.75, anchor, true, 0.7)).toBe(true);
    expect(feedback).not.toHaveBeenCalled();
    const root = scene.children[0]!;
    root.updateMatrixWorld(true);
    for (const name of ['Voidmaul_AttackCrater', 'Voidmaul_CrushCrater_Right']) {
      const mesh = root.getObjectByName(name) as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.ShaderMaterial
      >;
      expect(mesh.material.uniforms.uFade!.value).toBe(1);
      const point = new THREE.Vector3().fromBufferAttribute(
        mesh.geometry.getAttribute('position'),
        0,
      );
      mesh.localToWorld(point);
      expect(point.y - (point.x * 0.1 - point.z * 0.04)).toBeCloseTo(0.018, 5);
    }
    expect(impacts.start(note, 12, anchor)).toBe(false);
    impacts.update(24000);
    expect(impacts.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    impacts.dispose();
  });

  it('consumes hidden and expired impacts, rejecting invalid or future records', () => {
    const scene = new THREE.Scene();
    const onImpact = vi.fn();
    const impacts = new VoidmaulImpacts(scene, () => 0, onImpact);
    expect(impacts.start(slam(), 1.75, new THREE.Vector3(), false)).toBe(false);
    expect(impacts.start(slam(), 1.8, new THREE.Vector3(), true)).toBe(false);
    expect(impacts.start(slam(10), 44, new THREE.Vector3())).toBe(false);
    expect(impacts.start(slam(50), 45, new THREE.Vector3())).toBe(false);
    expect(impacts.start({ ...slam(50), radius: NaN }, 50, new THREE.Vector3())).toBe(false);
    expect(impacts.start(slam(50), 50, new THREE.Vector3(NaN, 0, 0))).toBe(false);
    expect(scene.children).toHaveLength(0);
    expect(onImpact).not.toHaveBeenCalled();
    impacts.dispose();
  });

  it('bounds retained scars and frees every evicted or expired GPU effect once', () => {
    const dispose = vi.spyOn(VoidmaulAttackFx.prototype, 'dispose');
    const scene = new THREE.Scene();
    const impacts = new VoidmaulImpacts(scene, () => 0);
    for (let i = 0; i <= VOIDMAUL_MAX_IMPACTS; i++) {
      expect(impacts.start(slam(i, i), i, new THREE.Vector3())).toBe(true);
    }
    expect(impacts.count).toBe(VOIDMAUL_MAX_IMPACTS);
    expect(scene.children).toHaveLength(VOIDMAUL_MAX_IMPACTS);
    expect(dispose).toHaveBeenCalledTimes(1);
    impacts.update(-100);
    impacts.update(34000);
    expect(impacts.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(VOIDMAUL_MAX_IMPACTS + 1);
    impacts.dispose();
    expect(dispose).toHaveBeenCalledTimes(VOIDMAUL_MAX_IMPACTS + 1);
  });

  it('the renderer uses the resolved ground position and converts sphere notes into its chart', () => {
    const start = vi.fn();
    const toLocal = vi.fn((point: { x: number; z: number }) => ({
      x: point.x + 100,
      z: point.z + 100,
    }));
    const renderer = {
      followId: null,
      world: { time: 8, units: new Map(), map: { rings: [] } },
      tracked: new Map([[42, { mesh: { visible: true }, yaw: 0.3 }]]),
      voidmaulImpacts: { start },
      groundHeight: (x: number, z: number) => x - z,
      planet: {
        toLocal,
        base: { map: { rings: [{ id: 'top', x: 4, z: 15, r: 9 }] } },
      },
    };
    Renderer.prototype.onCombatNotes.call(renderer as never, {
      golds: [],
      casts: [],
      hits: [],
      attacks: [],
      voidmaulSlams: [slam()],
    });
    expect(start).toHaveBeenCalledTimes(1);
    const [note, time, anchor, visible, yaw, arena] = start.mock.calls[0]!;
    expect(note).toEqual(slam());
    expect(time).toBe(8);
    expect(anchor.toArray()).toEqual([110, -10, 120]);
    expect(visible).toBe(true);
    expect(yaw).toBe(0.3);
    expect(arena.center.toArray()).toEqual([104, -11, 115]);
    expect(arena.radius).toBe(9);
    // The sim's stones come along, each of their two ends in the chart.
    const stones = start.mock.calls[0]![6];
    expect(stones).toHaveLength(VOIDMAUL_STONE_COUNT);
    expect(toLocal).toHaveBeenCalledTimes(2 + 2 * VOIDMAUL_STONE_COUNT);
  });

  it('keeps debris inside the real arena after an offset, rotated impact', () => {
    const scene = new THREE.Scene();
    const impacts = new VoidmaulImpacts(scene, () => 3.3);
    const anchor = new THREE.Vector3(8, 3.3, 12);
    const arena = { center: new THREE.Vector3(5, 3.3, 8), radius: 16.35 };
    expect(impacts.start(slam(), 1.75, anchor, true, 1.1, arena)).toBe(true);
    // The event and input vectors may change afterwards; the footprint and
    // entire debris field stay attached to the captured ground context.
    arena.center.set(99, 0, 99);
    anchor.set(99, 0, 99);
    impacts.update(4000);
    const root = scene.children[0]!;
    root.updateMatrixWorld(true);
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3();
    let rocks = 0;
    let farthest = 0;
    root.traverse((child) => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, matrix);
        point.setFromMatrixPosition(matrix).applyMatrix4(child.matrixWorld);
        const distance = Math.hypot(point.x - 5, point.z - 8);
        expect(distance).toBeLessThan(16.35);
        farthest = Math.max(farthest, distance);
        rocks++;
      }
    });
    expect(rocks).toBe(VOIDMAUL_STONE_COUNT);
    expect(farthest).toBeGreaterThan(14);
    impacts.dispose();
  });
});
