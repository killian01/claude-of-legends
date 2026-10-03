// Champions seen through what hides them on the planet
// (src/render/planet_ghost.ts): every mesh of a body gets one flat twin
// that draws only behind something (depth GREATER, no depth written),
// shares the body's geometry and skeleton, and is ordered between the
// planet and the body; colors by relation, none for neutral bodies.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  attachGhosts,
  BODY_ORDER,
  GHOST_ORDER,
  ghostColor,
  ghostMaterial,
} from '../src/render/planet_ghost';

function body(): { root: THREE.Group; plain: THREE.Mesh; skinned: THREE.SkinnedMesh } {
  const root = new THREE.Group();
  const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  const bone = new THREE.Bone();
  const skinnedGeo = new THREE.BoxGeometry();
  const n = skinnedGeo.getAttribute('position').count;
  skinnedGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  skinnedGeo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4),
  );
  const skinned = new THREE.SkinnedMesh(skinnedGeo, new THREE.MeshLambertMaterial());
  skinned.add(bone);
  skinned.bind(new THREE.Skeleton([bone]));
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  hidden.visible = false;
  root.add(plain, skinned, hidden);
  return { root, plain, skinned };
}

describe('the silhouettes', () => {
  it('give every shown mesh of a body one twin, drawn only behind something', () => {
    const { root, plain, skinned } = body();
    const mat = ghostMaterial(0xff0000);
    expect(attachGhosts(root, mat)).toBe(2);
    const twinOf = (m: THREE.Mesh) => m.children.find((c) => c.userData.ghost) as THREE.Mesh;
    const a = twinOf(plain);
    const b = twinOf(skinned) as THREE.SkinnedMesh;
    expect(a.geometry).toBe(plain.geometry);
    expect(b.isSkinnedMesh).toBe(true);
    expect(b.skeleton).toBe(skinned.skeleton);
    expect(a.material).toBe(mat);
    expect(mat.depthFunc).toBe(THREE.GreaterDepth);
    expect(mat.depthWrite).toBe(false);
    expect(a.castShadow).toBe(false);
    expect(a.userData.sharedGeo).toBe(true);
    // The planet first, the twins, the bodies last.
    expect(a.renderOrder).toBe(GHOST_ORDER);
    expect(plain.renderOrder).toBe(BODY_ORDER);
    expect(GHOST_ORDER).toBeGreaterThan(0);
    expect(BODY_ORDER).toBeGreaterThan(GHOST_ORDER);
  });

  it('are made once, a second call only hands them a new material', () => {
    const { root, plain } = body();
    attachGhosts(root, ghostMaterial(0xff0000));
    const other = ghostMaterial(0x00ff00);
    expect(attachGhosts(root, other)).toBe(2);
    const twins = plain.children.filter((c) => c.userData.ghost);
    expect(twins).toHaveLength(1);
    expect((twins[0] as THREE.Mesh).material).toBe(other);
  });

  it('wear the relation: a light for the own champion, red for enemies, none for neutrals', () => {
    expect(ghostColor('own')).not.toBeNull();
    expect(ghostColor('enemy')).not.toBeNull();
    expect(ghostColor('ally')).not.toBeNull();
    expect(ghostColor('neutral')).toBeNull();
    const red = new THREE.Color(ghostColor('enemy')!);
    expect(red.r).toBeGreaterThan(red.g + 0.4);
    const own = new THREE.Color(ghostColor('own')!);
    expect(own.b).toBeGreaterThan(0.8);
  });

  it('is drawn a little nearer the camera, so only a clear occluder shows it', () => {
    const mat = ghostMaterial(0xffffff);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic!.vertexShader,
      fragmentShader: '',
    };
    mat.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(shader.vertexShader).toMatch(/mvPosition\.z \+= 0\.\d+;/);
  });
});
