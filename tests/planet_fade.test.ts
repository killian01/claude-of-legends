// The props seen through around the champions (src/render/planet_dusk.ts):
// a prop between the camera and a champion thins out, one beside or
// behind it does not, and only the props' materials carry it, never the
// ground's.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { duskTree, fadeAt } from '../src/render/planet_dusk';

const eye = { x: 0, y: 40, z: 25 };
const chest = { x: 0, y: 1.2, z: 0 };

describe('the see-through', () => {
  it('thins what stands between the camera and the champion', () => {
    // A tree trunk a few meters in front of the champion, on the line.
    const t = 0.8;
    const onLine = {
      x: eye.x + (chest.x - eye.x) * t,
      y: eye.y + (chest.y - eye.y) * t,
      z: eye.z + (chest.z - eye.z) * t,
    };
    expect(fadeAt(onLine, eye, chest, 2.4)).toBeCloseTo(1, 6);
    // Off the line by a meter: still inside the cone near the chest.
    expect(fadeAt({ ...onLine, x: 1 }, eye, chest, 2.4)).toBeGreaterThan(0.5);
  });

  it('leaves alone what is beside the line, at the champion, or behind it', () => {
    expect(fadeAt({ x: 6, y: 9, z: 6 }, eye, chest, 2.4)).toBe(0);
    // At the champion's own spot and past it, nothing thins.
    expect(fadeAt({ x: 0, y: 1, z: -0.2 }, eye, chest, 2.4)).toBe(0);
    expect(fadeAt({ x: 0, y: 0.5, z: -3 }, eye, chest, 2.4)).toBe(0);
    // The cone narrows toward the eye: a meter and a half off the line
    // near the camera is outside it.
    const near = { x: 1.5, y: eye.y * 0.85 + chest.y * 0.15, z: eye.z * 0.85 };
    expect(fadeAt(near, eye, chest, 2.4)).toBe(0);
  });

  it('gives the props the see-through and never the ground', () => {
    const root = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.SphereGeometry(80), new THREE.MeshLambertMaterial());
    ground.name = 'Terrain';
    const tree = new THREE.Mesh(new THREE.ConeGeometry(1, 5), new THREE.MeshLambertMaterial());
    tree.name = 'cypress_0';
    root.add(ground, tree);
    duskTree(root);
    const compiled = (mesh: THREE.Mesh): string => {
      const mat = mesh.material as THREE.Material;
      const shader = {
        uniforms: {} as Record<string, unknown>,
        vertexShader: THREE.ShaderLib.lambert!.vertexShader,
        fragmentShader: THREE.ShaderLib.lambert!.fragmentShader,
      };
      mat.onBeforeCompile(
        shader as unknown as THREE.WebGLProgramParametersWithUniforms,
        {} as THREE.WebGLRenderer,
      );
      expect(shader.uniforms.colFadeAt).toBeDefined();
      return shader.fragmentShader;
    };
    expect(compiled(tree)).toContain('#define COL_FADE');
    expect(compiled(ground)).not.toContain('#define COL_FADE');
    expect((tree.material as THREE.Material).customProgramCacheKey()).toBe('col-dusk-fade');
    expect((ground.material as THREE.Material).customProgramCacheKey()).toBe('col-dusk');
  });
});
