// The planet's vertex bend (src/render/planet_bend.ts): what the patch does
// to a shader's text, for the built-in materials, the sprite and a
// hand-written effect shader, and that it bends a material only once.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bendMaterial, bendVertexShader, isBent } from '../src/render/planet_bend';

const PARTICLES = `
attribute float aSize;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

describe('the bend patch', () => {
  it('sends a built-in mesh material through the bend, normals turned with it', () => {
    const src = THREE.ShaderLib.toon!.vertexShader;
    const out = bendVertexShader(src);
    expect(out).not.toContain('#include <project_vertex>');
    expect(out).toContain('mvPosition.xyz = colBend( mvPosition.xyz );');
    expect(out).toContain('worldPosition.xyz = colBend( worldPosition.xyz );');
    expect(out).toContain('transformedNormal = colBendView( transformedNormal );');
    // The definitions come before main, once.
    expect(out.indexOf('vec3 colBend(')).toBeLessThan(out.indexOf('void main()'));
    expect(out.split('vec3 colBend(').length).toBe(2);
  });

  it('bends the depth pass, points and lines alike', () => {
    for (const lib of ['depth', 'points', 'basic'] as const) {
      const out = bendVertexShader(THREE.ShaderLib[lib].vertexShader);
      expect(out).toContain('mvPosition.xyz = colBend( mvPosition.xyz );');
    }
  });

  it('bends a sprite at its center', () => {
    const out = bendVertexShader(THREE.ShaderLib.sprite.vertexShader);
    expect(out).not.toMatch(/modelViewMatrix\s*\[\s*3\s*\]/);
    expect(out).toContain('vec4 mvPosition = colBendMV( vec4( 0.0, 0.0, 0.0, 1.0 ) );');
  });

  it('rewrites a hand-written shader by its model-view products', () => {
    const out = bendVertexShader(PARTICLES);
    expect(out).toContain('vec4 mv = colBendMV(vec4(position, 1.0));');
    expect(out).not.toMatch(/modelViewMatrix\s*\*\s*vec4/);
    // Untouched otherwise, and a second pass changes nothing.
    expect(out).toContain('gl_Position = projectionMatrix * mv;');
    expect(bendVertexShader(out)).toBe(out);
  });

  it('patches a material once, keeping its own patch and its own program key', () => {
    const mat = new THREE.MeshLambertMaterial();
    let ownRan = 0;
    mat.onBeforeCompile = () => {
      ownRan++;
    };
    mat.customProgramCacheKey = () => 'own-key';
    bendMaterial(mat);
    bendMaterial(mat);
    expect(isBent(mat)).toBe(true);
    expect(mat.customProgramCacheKey()).toBe('col-bend|own-key');
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: '',
    };
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(ownRan).toBe(1);
    expect(shader.uniforms.colBendOn).toBeDefined();
    expect(shader.vertexShader).toContain('colBend(');
    // A plain material is keyed apart from its unbent twin.
    const plain = new THREE.MeshBasicMaterial();
    const key = plain.customProgramCacheKey();
    bendMaterial(plain);
    expect(plain.customProgramCacheKey()).toBe(`col-bend|${key}`);
  });
});
