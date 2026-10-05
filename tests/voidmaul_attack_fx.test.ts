import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  VOIDMAUL_ATTACK_FX_DURATION_S,
  VoidmaulAttackFx,
} from '../src/render/vfx/voidmaul_attack_fx';

function rocks(fx: VoidmaulAttackFx): THREE.InstancedMesh[] {
  return fx.root.children.filter(
    (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
  );
}

function snapshot(fx: VoidmaulAttackFx): number[] {
  return rocks(fx).flatMap((mesh) => Array.from(mesh.instanceMatrix.array));
}

describe('Voidmaul attack fracture', () => {
  it('seeks every flying fragment directly without replaying prior frames', () => {
    const stepped = new VoidmaulAttackFx(5);
    const seeked = new VoidmaulAttackFx(5);
    for (const age of [0.05, 0.18, 0.44, 0.81]) stepped.update(age);
    seeked.update(0.81);
    expect(snapshot(seeked)).toEqual(snapshot(stepped));
    expect(rocks(seeked).reduce((count, mesh) => count + mesh.count, 0)).toBe(128);
    const flying = new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray(rocks(seeked)[0]!.instanceMatrix.array, 0),
    );
    expect(flying.y).toBeGreaterThan(1);
    // A backwards seek also reconstructs the same launch pose.
    stepped.update(0.05);
    seeked.update(0.05);
    expect(snapshot(seeked)).toEqual(snapshot(stepped));
    stepped.dispose();
    seeked.dispose();
  });

  it('lands fragments once and leaves a stationary crater after dust dissipates', () => {
    const fx = new VoidmaulAttackFx(5);
    fx.update(3.6);
    const settled = snapshot(fx);
    const dust = fx.root.getObjectByName('Voidmaul_AttackDust')!;
    const shockwave = fx.root.getObjectByName('Voidmaul_AttackShockwave')!;
    const crater = fx.root.getObjectByName('Voidmaul_AttackCrater') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(dust.visible).toBe(false);
    expect(shockwave.visible).toBe(false);
    expect(crater.material.uniforms.uFade!.value).toBe(1);
    fx.update(4.4);
    expect(snapshot(fx)).toEqual(settled);
    expect(crater.material.uniforms.uFade!.value).toBe(1);
    // The scar and the stones fade a few seconds after the rain.
    fx.update(5.5);
    expect(crater.material.uniforms.uFade!.value).toBeCloseTo(0.5);
    expect(rocks(fx)[0]!.material).toHaveProperty('opacity', 0.5);
    expect(fx.update(VOIDMAUL_ATTACK_FX_DURATION_S)).toBe(false);
    expect(fx.root.visible).toBe(false);
    fx.dispose();
  });

  it('drapes its imprint over a high stair and lands every fragment on its local ground', () => {
    const terrain = (x: number, z: number) => (x >= 0.3 ? 1.8 : x <= -0.6 ? -0.8 : 0) + z * 0.05;
    const fx = new VoidmaulAttackFx(5.5);
    const seeked = new VoidmaulAttackFx(5.5);
    fx.conformGround(terrain);
    seeked.conformGround(terrain);
    for (const name of [
      'Voidmaul_AttackCrater',
      'Voidmaul_AttackGroundCracks',
      'Voidmaul_AttackShockwave',
    ]) {
      const mesh = fx.root.getObjectByName(name) as THREE.Mesh;
      const vertices = mesh.geometry.getAttribute('position');
      if (name !== 'Voidmaul_AttackGroundCracks') expect(vertices.count).toBeGreaterThan(1500);
      for (let i = 0; i < vertices.count; i++) {
        expect(vertices.getY(i)).toBeCloseTo(terrain(vertices.getX(i), vertices.getZ(i)), 5);
      }
      expect(mesh.position.y).toBeGreaterThan(0.01);
    }
    // Re-conforming does not add the stair's height again.
    fx.conformGround(terrain);
    fx.update(0.24);
    fx.update(0.8);
    seeked.update(0.8);
    expect(snapshot(fx)).toEqual(snapshot(seeked));
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (const age of [0.8, 4]) {
      fx.update(age);
      for (const mesh of rocks(fx)) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          expect(position.y).toBeGreaterThan(terrain(position.x, position.z) + 0.02);
        }
      }
    }
    const settled = snapshot(fx);
    fx.update(4.4);
    expect(snapshot(fx)).toEqual(settled);
    fx.dispose();
    seeked.dispose();
  });

  it('supports every rotated resting shard on its true lowest corner and caches the pose', () => {
    for (const height of [
      (_x: number, _z: number) => 0,
      (x: number, z: number) => (x >= 0.3 ? 1.8 : x <= -0.6 ? -0.8 : 0) + z * 0.05,
    ]) {
      const terrain = vi.fn(height);
      const fx = new VoidmaulAttackFx(5.5);
      fx.conformGround(terrain);
      terrain.mockClear();
      fx.update(4);
      expect(terrain).not.toHaveBeenCalled();
      const matrix = new THREE.Matrix4();
      const vertex = new THREE.Vector3();
      for (const mesh of rocks(fx)) {
        const geometry = mesh.geometry.getAttribute('position');
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          let minimum = Infinity;
          for (let j = 0; j < geometry.count; j++) {
            vertex.fromBufferAttribute(geometry, j).applyMatrix4(matrix);
            minimum = Math.min(minimum, vertex.y - height(vertex.x, vertex.z));
          }
          expect(minimum).toBeCloseTo(0.005, 5);
        }
      }
      const settled = snapshot(fx);
      fx.update(4.4);
      expect(snapshot(fx)).toEqual(settled);
      expect(terrain).not.toHaveBeenCalled();
      fx.dispose();
    }
  });

  it('throws large rocks across every part of the arena from an off-center paw while preserving damage reach', () => {
    const arena = { centerX: -3.7669089018, centerZ: -3.3783648492, radius: 16.35 };
    const fx = new VoidmaulAttackFx(5.5, arena);
    const seeked = new VoidmaulAttackFx(5.5, arena);
    fx.conformGround(() => 0);
    seeked.conformGround(() => 0);
    const matrix = new THREE.Matrix4();
    const vertex = new THREE.Vector3();
    const position = new THREE.Vector3();
    const sectors = new Set<number>();
    const bands = new Set<number>();
    const cells = new Set<string>();
    let highFlying = 0;
    let large = 0;
    for (const age of [0.13, 0.4, 1.2, 2.1, 4]) {
      fx.update(age);
      for (const mesh of rocks(fx)) {
        const geometry = mesh.geometry.getAttribute('position');
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          if (age === 1.2 && position.y > 5) highFlying++;
          for (let j = 0; j < geometry.count; j++) {
            vertex.fromBufferAttribute(geometry, j).applyMatrix4(matrix);
            expect(Math.hypot(vertex.x - arena.centerX, vertex.z - arena.centerZ)).toBeLessThan(
              arena.radius,
            );
          }
          if (age !== 4) continue;
          const x = position.x - arena.centerX;
          const z = position.z - arena.centerZ;
          const angle = THREE.MathUtils.euclideanModulo(Math.atan2(z, x), Math.PI * 2);
          const sector = Math.floor((angle / (Math.PI * 2)) * 16);
          const band = Math.floor((Math.hypot(x, z) / arena.radius) * 8);
          sectors.add(sector);
          bands.add(band);
          cells.add(`${sector}:${band}`);
          if (new THREE.Vector3().setFromMatrixScale(matrix).x > 0.35) large++;
        }
      }
    }
    expect(sectors.size).toBe(16);
    expect(bands.size).toBe(8);
    expect(cells.size).toBe(128);
    expect(highFlying).toBeGreaterThan(100);
    expect(large).toBeGreaterThanOrEqual(90);
    for (const age of [0.4, 1.2, 2.1, 4]) fx.update(age);
    seeked.update(4);
    expect(snapshot(fx)).toEqual(snapshot(seeked));
    const wave = fx.root.getObjectByName('Voidmaul_AttackShockwave') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    // Arena debris does not increase the contact disk represented by this wave.
    wave.geometry.computeBoundingSphere();
    expect(wave.geometry.boundingSphere!.radius).toBeLessThan(5.5 * 1.5);
    fx.dispose();
    seeked.dispose();
  });

  it('releases every owned geometry, material and instance buffer only once', () => {
    const fx = new VoidmaulAttackFx(4);
    const scene = new THREE.Scene();
    scene.add(fx.root);
    const disposals: ReturnType<typeof vi.spyOn>[] = [];
    fx.root.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        disposals.push(vi.spyOn(child.geometry, 'dispose'));
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          disposals.push(vi.spyOn(material, 'dispose'));
        }
      }
      if (child instanceof THREE.InstancedMesh) disposals.push(vi.spyOn(child, 'dispose'));
    });
    fx.dispose();
    fx.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
    expect(fx.root.children).toHaveLength(0);
    expect(fx.update(0.3)).toBe(false);
  });
});
