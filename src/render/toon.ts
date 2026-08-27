// The stylized rendering pass: every lit Lambert material becomes a
// MeshToonMaterial sharing one stepped lighting ramp, and the frame is drawn
// through an inverted-hull OutlineEffect so solid silhouettes carry a dark
// contour. Presentation only; glow materials (MeshBasicMaterial) and sprites
// pass through untouched.
//
// Instanced meshes keep the toon ramp but opt out of outlines: the outline
// shader's thickness math ignores instanceMatrix, so hulls on instanced
// flora land at garbage positions.

import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';

let ramp: THREE.DataTexture | null = null;

// A shared three-step ramp: shadow, mid, lit. Nearest filtering is what
// makes the bands read as bands.
function gradientRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const steps = [110, 185, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  ramp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

// Swaps every MeshLambertMaterial under root for its toon twin, in place.
// Safe to call repeatedly; already-toon and non-lit materials pass through.
export function toonifyMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const instanced = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh === true;
    const convert = (mat: THREE.Material): THREE.Material => {
      const src = mat as THREE.MeshLambertMaterial;
      if (!src.isMeshLambertMaterial) return mat;
      const out = new THREE.MeshToonMaterial({
        color: src.color.clone(),
        map: src.map,
        gradientMap: gradientRamp(),
        transparent: src.transparent,
        opacity: src.opacity,
        side: src.side,
        vertexColors: src.vertexColors,
      });
      out.name = src.name;
      out.emissive.copy(src.emissive);
      out.emissiveIntensity = src.emissiveIntensity;
      out.depthWrite = src.depthWrite;
      out.userData = src.userData;
      if (instanced) out.userData.outlineParameters = { visible: false };
      src.dispose();
      return out;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
}

// The outline wrapper the renderer draws through instead of gl.render.
// Thickness is in clip space (scales with distance); the color is a warm
// near-black so contours sit in the palette instead of stamping pure black.
export function createOutlineRenderer(gl: THREE.WebGLRenderer): OutlineEffect {
  return new OutlineEffect(gl, {
    defaultThickness: 0.009,
    defaultColor: [0.05, 0.045, 0.03],
    defaultAlpha: 1,
  });
}
