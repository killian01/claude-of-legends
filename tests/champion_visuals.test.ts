// The champion visual contract: every roster champion has a rigged-GLB def,
// and every name the manifest speaks (clips, meshes, materials, bones) exists
// inside the shipped GLB file. A renamed node in a re-exported asset fails
// SILENTLY at runtime (the fail-soft path just keeps the procedural figure or
// drops a prop), so this test is where such a drift becomes loud.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { desiredBaseState } from '../src/render/champions/anim';
import { CHAMPION_VISUALS } from '../src/render/champions/manifest';
import { CHAMPIONS } from '../src/sim/content/champions';

interface GlbMeta {
  animations: string[];
  nodes: string[];
  meshes: string[];
  materials: string[];
}

// A GLB is a 12-byte header then chunks; the first chunk is the glTF JSON.
function readGlbMeta(publicUrl: string): GlbMeta {
  const path = fileURLToPath(new URL(`../public${publicUrl}`, import.meta.url));
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    animations?: { name?: string }[];
    nodes?: { name?: string }[];
    meshes?: { name?: string }[];
    materials?: { name?: string }[];
  };
  const names = (list?: { name?: string }[]): string[] =>
    (list ?? []).map((x) => x.name).filter((n): n is string => typeof n === 'string');
  return {
    animations: names(json.animations),
    nodes: names(json.nodes),
    meshes: names(json.meshes),
    materials: names(json.materials),
  };
}

// GLTFLoader sanitizes node names at load ("handslot.r" becomes
// "handslotr"); the runtime tries both spellings, so the contract accepts
// either.
function hasNode(meta: GlbMeta, name: string): boolean {
  const wanted = name.replace(/[^\w-]/g, '');
  return meta.nodes.some((n) => n === name || n.replace(/[^\w-]/g, '') === wanted);
}

describe('champion visual manifest', () => {
  it('covers exactly the roster', () => {
    expect(Object.keys(CHAMPION_VISUALS).sort()).toEqual(Object.keys(CHAMPIONS).sort());
  });

  for (const [championId, def] of Object.entries(CHAMPION_VISUALS)) {
    describe(championId, () => {
      const meta = readGlbMeta(def.url);

      it('names only clips the GLB ships', () => {
        for (const clip of Object.values(def.clips)) {
          expect(meta.animations, `clip ${clip}`).toContain(clip);
        }
      });

      it('names only meshes and materials the GLB ships', () => {
        for (const name of [
          ...(def.hide ?? []),
          ...(def.teamMeshes ?? []),
          ...(def.accentGlowMeshes ?? []),
        ]) {
          expect(meta.meshes, `mesh ${name}`).toContain(name);
        }
        for (const name of Object.keys(def.recolor ?? {})) {
          expect(meta.materials, `material ${name}`).toContain(name);
        }
      });

      it('hangs props on bones the rig has', () => {
        for (const prop of def.props ?? []) {
          expect(hasNode(meta, prop.bone), `bone ${prop.bone}`).toBe(true);
        }
      });

      it('keeps the silhouette numbers sane', () => {
        expect(def.height).toBeGreaterThan(0);
        expect(def.barY).toBeGreaterThan(def.height);
        if (def.runSpeed !== undefined) expect(def.runSpeed).toBeGreaterThan(0);
        if (def.portrait?.time !== undefined) {
          expect(def.portrait.time).toBeGreaterThanOrEqual(0);
          expect(def.portrait.time).toBeLessThanOrEqual(1);
        }
        if (def.portrait?.zoom !== undefined) expect(def.portrait.zoom).toBeGreaterThan(0);
      });
    });
  }
});

describe('champion base state selection', () => {
  it('prioritizes death over everything', () => {
    expect(desiredBaseState({ moving: true, windingUp: true, dead: true })).toBe('dead');
  });
  it('holds the windup loop even while drifting', () => {
    expect(desiredBaseState({ moving: true, windingUp: true, dead: false })).toBe('windup');
  });
  it('runs when moving, idles at rest', () => {
    expect(desiredBaseState({ moving: true, windingUp: false, dead: false })).toBe('run');
    expect(desiredBaseState({ moving: false, windingUp: false, dead: false })).toBe('idle');
  });
});
