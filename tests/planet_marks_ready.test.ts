// The planet's marks stand ready before the planet's first frame
// (src/render/planet_marks.ts, planet_grace.ts, planet_graft_aura.ts):
// the caches carry their colors from the start, the first Grace shimmer
// and the first Heartwood aura exist hidden, and one cache burst is built
// hidden and gone at the first frame, so the stage's warm-up links all of
// their programs instead of the first frame, the first Arrival or the first
// cache opened linking them. An effect that begins while the first frame
// is held (a seed come down, a cache opened) is timed from when it began,
// not ended at once by that frame.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanetGround } from '../src/render/planet_terrain';

const hadDocument = 'document' in globalThis;
beforeAll(() => {
  if (!hadDocument) {
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    };
  }
});
afterAll(() => {
  if (!hadDocument) delete (globalThis as { document?: unknown }).document;
});

const ground = {
  radius: 80,
  placeholder: false,
  layout: { pads: [], crossroads: [] },
  heightAt: () => 0,
} as unknown as PlanetGround;

async function marks(clock?: () => number) {
  const { PlanetMarks } = await import('../src/render/planet_marks');
  return new PlanetMarks(ground, 80, clock);
}

function drawables(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) out.push(o);
  });
  return out;
}

describe('the planet marks before the first frame', () => {
  it('give the caches their colors from the start', async () => {
    const m = await marks();
    // The chests and their lids: the instanced bodies that cast shadows.
    const caches = m.group.children.filter(
      (c): c is THREE.InstancedMesh =>
        c instanceof THREE.InstancedMesh &&
        c.castShadow &&
        (c.material as THREE.Material).type === 'MeshLambertMaterial',
    );
    expect(caches).toHaveLength(2);
    for (const c of caches) expect(c.instanceColor).not.toBeNull();
  });

  it('hold a hidden Grace shimmer and a hidden aura ready', async () => {
    const m = await marks();
    const grace = m.group.getObjectByName('planet-grace')!;
    const aura = m.group.getObjectByName('planet-graft-aura')!;
    for (const g of [grace, aura]) {
      const ready = drawables(g);
      expect(ready).toHaveLength(2);
      for (const o of ready) expect(o.visible).toBe(false);
    }
  });

  it('build one burst hidden, gone at the first frame', async () => {
    const m = await marks();
    const hiddenBurst = (): THREE.Object3D[] =>
      m.group.children.filter(
        (o) =>
          !o.visible &&
          !(o instanceof THREE.InstancedMesh) &&
          ((o as THREE.Points).isPoints ||
            ((o as THREE.Mesh).material as THREE.Material | undefined)?.transparent === true),
      );
    const before = hiddenBurst();
    // The lid, the column and the sparks.
    expect(before.filter((o) => (o as THREE.Points).isPoints).length).toBeGreaterThanOrEqual(1);
    const lid = before.find(
      (o) => ((o as THREE.Mesh).material as THREE.Material).type === 'MeshLambertMaterial',
    );
    expect(lid).toBeDefined();
    m.update(10_000, [], null, false, 0);
    expect(m.group.children).not.toContain(lid);
  });

  it('time an effect begun before the first frame from when it began', async () => {
    let now = 50_000;
    const m = await marks(() => now);
    const before = new Set(m.group.children);
    // The first frame is held; a seed comes down a second later.
    now += 1_000;
    m.impactAt({ x: 0, y: 80, z: 0 });
    const impact = m.group.children.filter((o) => !before.has(o));
    // Its shockwave, its dust and its flash.
    expect(impact).toHaveLength(3);
    // The first frame, a moment after it: the warm-up's burst goes, the
    // impact stays.
    now += 100;
    m.update(now, [], null, false, 0);
    for (const o of impact) expect(m.group.children).toContain(o);
    expect(m.group.children.filter((o) => before.has(o) && !o.visible)).toHaveLength(
      [...before].filter((o) => !o.visible).length - 3,
    );
    // Its dust settles 1.5 s after it came down, not after the frame.
    m.update(50_000 + 1_000 + 1_450, [], null, false, 0);
    expect(m.group.children.filter((o) => impact.includes(o))).toHaveLength(1);
    m.update(50_000 + 1_000 + 1_500, [], null, false, 0);
    expect(m.group.children.filter((o) => impact.includes(o))).toHaveLength(0);
  });
});
