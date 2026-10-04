// What the planet's pillars send to the GPU (src/render/planet_pillars.ts):
// a kind with nothing standing is not drawn and uploads nothing, a kind
// with a column draws it, and every pillar mesh carries its colors from
// the start, so the first column draws with a program linked before the
// planet's first frame rather than a new one mid-match.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanetGround } from '../src/render/planet_terrain';

// The column's gradient is drawn on a canvas; the test's has no 2D context.
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

const ground = { heightAt: () => 0 } as unknown as PlanetGround;

async function pillars() {
  const { PlanetPillars } = await import('../src/render/planet_pillars');
  return new PlanetPillars(ground, 80);
}

function meshes(group: THREE.Group): THREE.InstancedMesh[] {
  return group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
}

describe('the pillars on the GPU', () => {
  it('draw nothing and carry their colors before anything stands', async () => {
    const p = await pillars();
    const all = meshes(p.group);
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m.visible).toBe(false);
      expect(m.count).toBe(0);
      expect(m.instanceColor).not.toBeNull();
    }
  });

  it('draw the kind that stands, and stop uploading once it goes', async () => {
    const p = await pillars();
    const at = { x: 0, y: 80, z: 0 };
    p.setPillars([{ kind: 'seedfall', at, until: 20, lit: false }], 10, 1000);
    const shown = meshes(p.group).filter((m) => m.visible);
    // The seedfall's column and its two countdown rings.
    expect(shown.map((m) => m.count).sort()).toEqual([1, 2]);
    for (const m of meshes(p.group)) if (!m.visible) expect(m.count).toBe(0);

    p.setPillars([], 11, 1100);
    const versions = meshes(p.group).map((m) => m.instanceMatrix.version);
    for (const m of meshes(p.group)) expect(m.visible).toBe(false);
    p.setPillars([], 12, 1200);
    expect(meshes(p.group).map((m) => m.instanceMatrix.version)).toEqual(versions);
  });
});
