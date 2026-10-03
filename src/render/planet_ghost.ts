// Champions seen through what hides them on the planet (docs/plan-royale.md
// step 8): the props' see-through (planet_dusk.ts) thins a grove, but a body
// deep in one still reads poorly. Every mesh of a champion's body gets a
// twin, flat and glowing, drawn only where something already on screen
// stands in front of it (depth test GREATER, no depth written), between
// the planet (drawn first) and the champion itself (drawn last, so its
// own arms never light up its own back). The twin shares the body's
// geometry and skeleton: it moves and animates with it for one more draw
// per mesh, and costs fill only where it shows. The own champion glows a
// clear light, an enemy red, an ally blue; nothing for neutral bodies.

import * as THREE from 'three';

export type GhostRelation = 'own' | 'ally' | 'enemy' | 'neutral';

const GHOST_COLORS: Readonly<Record<GhostRelation, number | null>> = {
  own: 0x9fe6ff,
  ally: 0x6fa8ff,
  enemy: 0xff4a3a,
  neutral: null,
};

// The silhouette's color for a relation; null draws none.
export function ghostColor(relation: GhostRelation): number | null {
  return GHOST_COLORS[relation];
}

// The draw order the planet keeps: everything else (the ground, the props,
// the other units), then the silhouettes, then the champions' bodies.
export const GHOST_ORDER = 1;
export const BODY_ORDER = 2;
// How much in front of a body an occluder must stand for the silhouette to
// show, meters toward the camera: the ground at a champion's feet and its
// own shadowed bits never count.
export const GHOST_CLEARANCE_M = 0.45;

// One champion's silhouette material: added light, so overlapping parts
// stay one soft glow and the occluder's texture shows under it.
export function ghostMaterial(color: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: false,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthFunc: THREE.GreaterDepth,
    depthWrite: false,
    fog: false,
  });
  mat.toneMapped = false;
  // The clearance: the twin is drawn a little nearer the camera than the
  // body, so only an occluder clearly in front passes the test.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\nmvPosition.z += ${GHOST_CLEARANCE_M.toFixed(2)};\ngl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.customProgramCacheKey = () => 'col-ghost';
  return mat;
}

// Gives every mesh of a champion's body its silhouette twin with
// `material`, once; the body's meshes are ordered after the twins. Returns
// how many twins the body holds.
export function attachGhosts(body: THREE.Object3D, material: THREE.Material): number {
  const meshes: THREE.Mesh[] = [];
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.ghost && m.visible) meshes.push(m);
  });
  let count = 0;
  for (const mesh of meshes) {
    const existing = mesh.children.find((c) => c.userData.ghost === true) as THREE.Mesh | undefined;
    if (existing) {
      existing.material = material;
      count++;
      continue;
    }
    const skinned = mesh as THREE.SkinnedMesh;
    let twin: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(skinned.geometry, material);
      s.bind(skinned.skeleton, skinned.bindMatrix);
      s.bindMode = skinned.bindMode;
      twin = s;
    } else {
      twin = new THREE.Mesh(mesh.geometry, material);
    }
    twin.userData.ghost = true;
    // Geometry and skeleton are the body's: never disposed with the twin.
    twin.userData.sharedGeo = true;
    twin.castShadow = false;
    twin.receiveShadow = false;
    twin.renderOrder = GHOST_ORDER;
    twin.frustumCulled = false;
    mesh.renderOrder = BODY_ORDER;
    mesh.add(twin);
    count++;
  }
  return count;
}
