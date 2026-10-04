// A double-sided glow drawn in one pass where that changes nothing on the
// screen (src/render/single_pass.ts): only an additive material that
// writes no depth qualifies, and the planet's bend applies the rule to
// every material it meets (src/render/planet_bend.ts).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bendMaterial } from '../src/render/planet_bend';
import { onePassAlike } from '../src/render/single_pass';

const glow = (over: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    ...over,
  });

describe('one pass for a double-sided glow', () => {
  it('holds for an additive glow that writes no depth', () => {
    expect(onePassAlike(glow())).toBe(true);
  });

  it('does not hold where the order of the faces shows', () => {
    // Blended over what is behind: the back faces must go first.
    expect(onePassAlike(glow({ blending: THREE.NormalBlending }))).toBe(false);
    // Writing depth: the face drawn first hides the other.
    expect(onePassAlike(glow({ depthWrite: true }))).toBe(false);
    // One side only: three draws it once already.
    expect(onePassAlike(glow({ side: THREE.FrontSide }))).toBe(false);
  });

  it('is applied by the bend to what the planet draws', () => {
    const mist = glow();
    const veil = glow({ blending: THREE.NormalBlending });
    bendMaterial(mist);
    bendMaterial(veil);
    expect(mist.forceSinglePass).toBe(true);
    expect(veil.forceSinglePass).toBe(false);
  });
});
