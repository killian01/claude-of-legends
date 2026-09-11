// The fog of war's ground sheet, draped over the terrain. The fog is a
// canvas painted dark where the viewer's team has no sight and punched
// open around every friendly unit (renderer.ts, paintFog), mapped onto
// one mesh over the whole map. That mesh used to be a flat plane four
// meters up: the Star Orchard's ring discs and spawn terraces stand three
// to four meters above the ground, so a creature on its ring stood lit
// through the fog with its platform (the forest round, ADR 0023). The
// sheet now follows the ground: every vertex sits FOG_LIFT above the
// terrain under it, high enough that grass blades and boulders stay
// under it instead of poking through fully lit, and the same height
// over a disc as over the ground. Pure geometry over a height function,
// so the shape is testable without a renderer.

import * as THREE from 'three';

// Meters above the ground the sheet floats at.
export const FOG_LIFT = 4.1;
// Cells along each side; at 156 m that is about two meters a cell, the
// fog canvas's own resolution.
export const FOG_SEGMENTS = 78;
// Meters the sheet reaches past the map square on every side: the Star
// Orchard's ring discs stick out past the square (the bot ring's center
// is seven meters from the corner and its disc sixteen wide), and the
// walkability grid covers twenty meters past it. The fog canvas clamps
// to its edge out there, so past the square is dark.
export const FOG_MARGIN = 20;

export type HeightAt = (x: number, z: number) => number;

// The vertices and triangles of the sheet over a square map of `size`
// meters and its margin: a grid of (segments + 1) squared points, each
// lifted over the ground, with the texture's u along x and v against z
// over the square itself, the way the fog canvas is painted (x scaled to
// the canvas's width, z to its height).
export function fogSheetData(
  size: number,
  heightAt: HeightAt,
  segments = FOG_SEGMENTS,
  lift = FOG_LIFT,
  margin = FOG_MARGIN,
): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const span = size + 2 * margin;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = (ix / segments) * span - margin;
      const z = (iz / segments) * span - margin;
      const at = (iz * n + ix) * 3;
      positions[at] = x;
      positions[at + 1] = heightAt(x, z) + lift;
      positions[at + 2] = z;
      uvs[(iz * n + ix) * 2] = x / size;
      uvs[(iz * n + ix) * 2 + 1] = 1 - z / size;
    }
  }
  const indices = new Uint32Array(segments * segments * 6);
  let k = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Two triangles a cell, wound to face up (+y).
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  return { positions, uvs, indices };
}

export function fogSheetGeometry(size: number, heightAt: HeightAt): THREE.BufferGeometry {
  const { positions, uvs, indices } = fogSheetData(size, heightAt);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}
