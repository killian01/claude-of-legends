// Sylra's authored spell effects: the exported Blender files carry the
// parts the runtime looks up by name and kind, the pose and timing helpers
// follow the source's frame numbers, timed effects live and die on their
// clock, and a self-or-ally shield lands its body on the unit that took it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pickShieldHolder } from '../src/render/shield_holder';
import { SPELL_VFX } from '../src/render/vfx/catalog';
import { burstPose, ramp } from '../src/render/vfx/sylra_fx';
import { TimedEffects } from '../src/render/vfx/timed';

interface GlbNode {
  name: string;
  extras?: Record<string, unknown>;
  mesh?: number;
}

function readNodes(file: string): { nodes: GlbNode[]; morphs: (name: string) => number } {
  const path = fileURLToPath(new URL(`../public/models/effects/${file}`, import.meta.url));
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    nodes: GlbNode[];
    meshes: { primitives: { targets?: unknown[] }[] }[];
  };
  const morphs = (name: string): number => {
    const node = json.nodes.find((n) => n.name === name);
    if (!node || node.mesh === undefined) return -1;
    return json.meshes[node.mesh]?.primitives[0]?.targets?.length ?? 0;
  };
  return { nodes: json.nodes, morphs };
}

describe('the exported effect files', () => {
  it('ship the thorn bolt and its burst, tagged for the runtime', () => {
    const { nodes, morphs } = readNodes('sylra_thorn_bolt.glb');
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n.extras]));
    expect(byName.Sylra_ThornBolt).toEqual({ effectKind: 'bolt' });
    expect(byName.Sylra_ThornImpact).toEqual({ effectKind: 'burst', poseStart: 19 });
    // Pose_00 is the collapsed key, then nineteen frames of expansion.
    expect(morphs('Sylra_ThornImpact')).toBe(20);
  });

  it('ship the verdant shell, its shards and one burst thorn', () => {
    const { nodes, morphs } = readNodes('sylra_verdant_shell.glb');
    const kinds = nodes.map((n) => `${n.name}:${String(n.extras?.effectKind)}`).sort();
    expect(kinds).toEqual([
      'Sylra_ShellLeaves:veins',
      'Sylra_ShellMembrane:membrane',
      'Sylra_ShellShards:burst',
      'Sylra_ShellThorn:thorn',
      'Sylra_ShellVeins:veins',
    ]);
    expect(nodes.find((n) => n.name === 'Sylra_ShellShards')?.extras?.poseStart).toBe(72);
    expect(morphs('Sylra_ShellShards')).toBeGreaterThanOrEqual(26);
  });

  it('ship the overgrowth telegraph and eruption in three root beats', () => {
    const { nodes, morphs } = readNodes('sylra_overgrowth.glb');
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n.extras]));
    for (const kind of ['ring', 'sap', 'seed', 'roots', 'cracks']) {
      expect(
        nodes.some((n) => n.extras?.effectKind === kind),
        kind,
      ).toBe(true);
    }
    for (const beat of [0, 1, 2]) {
      expect(byName[`Sylra_GiantRoots_${beat}`]).toEqual({ effectKind: 'root', beat });
      expect(morphs(`Sylra_GiantRoots_${beat}`)).toBe(9);
    }
    expect(byName.Sylra_OvergrowthPollen).toEqual({ effectKind: 'burst', poseStart: 42 });
    expect(byName.Sylra_OvergrowthSpores).toEqual({ effectKind: 'burst', poseStart: 53 });
    // The sap is a curve baked before its bevel vanishes: it must have a mesh.
    expect(nodes.find((n) => n.name === 'Sylra_OvergrowthSap')?.mesh).toBeDefined();
  });
});

describe('the source timing helpers', () => {
  it('ramp eases over a frame window and clamps outside it', () => {
    expect(ramp(10, 12, 8)).toBe(0);
    expect(ramp(16, 12, 8)).toBeCloseTo(0.5, 6);
    expect(ramp(20, 12, 8)).toBe(1);
    expect(ramp(40, 12, 8)).toBe(1);
  });

  it('burstPose holds the collapsed key before the start and the last pose after', () => {
    expect(burstPose(10, 19, 19)).toBe(0);
    expect(burstPose(19, 19, 19)).toBe(1);
    expect(burstPose(19.5, 19, 19)).toBe(1.5);
    expect(burstPose(37, 19, 19)).toBe(19);
    expect(burstPose(60, 19, 19)).toBe(19);
  });
});

describe('the catalog hooks', () => {
  it('give Sylra Q, W, E and R their authored art', () => {
    expect(SPELL_VFX.sylra_Q?.projectile).toBeDefined();
    expect(SPELL_VFX.sylra_Q?.impact).toBeDefined();
    expect(SPELL_VFX.sylra_W?.zone).toBeDefined();
    expect(SPELL_VFX.sylra_E?.shield).toBeDefined();
    expect(SPELL_VFX.sylra_E?.shieldTick).toBeDefined();
    expect(SPELL_VFX.sylra_E?.shieldEnd).toBeDefined();
    expect(SPELL_VFX.sylra_R?.zone).toBeDefined();
    expect(SPELL_VFX.sylra_R?.detonate).toBeDefined();
  });

  it('builds a shell that closes over the source frames and swells before it goes', () => {
    const shell = SPELL_VFX.sylra_E?.shield?.() as THREE.Object3D;
    const tick = SPELL_VFX.sylra_E?.shieldTick as (h: THREE.Object3D, a: number, r: number) => void;
    tick(shell, 0, 2500);
    const closed = shell.scale.x;
    tick(shell, 333, 2167);
    const open = shell.scale.x;
    tick(shell, 2400, 100);
    const swollen = shell.scale.x;
    expect(closed).toBeLessThan(0.1);
    expect(open).toBeGreaterThan(2);
    expect(swollen).toBeGreaterThan(open);
  });
});

describe('timed effects', () => {
  it('tick an object with its age and remove it when its time is up', () => {
    const scene = new THREE.Scene();
    const timed = new TimedEffects(scene);
    const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const ages: number[] = [];
    timed.attach(object, 500, (age) => ages.push(age), 1000);
    expect(scene.children).toContain(object);
    expect(ages).toEqual([0]);
    timed.update(1200);
    timed.update(1499);
    expect(ages).toEqual([0, 200, 499]);
    expect(timed.count).toBe(1);
    timed.update(1500);
    expect(timed.count).toBe(0);
    expect(scene.children).not.toContain(object);
  });
});

describe('pickShieldHolder', () => {
  const unit = (id: number, team: number, x: number, until?: number) => ({
    id,
    team,
    dead: false,
    pos: { x, z: 0 },
    statuses: until === undefined ? [] : [{ kind: 'shield', until }],
  });

  it('picks the ally in reach carrying the freshest shield', () => {
    const caster = unit(1, 0, 0);
    const near = unit(2, 0, 2, 12.5);
    const stale = unit(3, 0, 1, 11);
    const far = unit(4, 0, 9, 12.5);
    const enemy = unit(5, 1, 1, 12.5);
    expect(pickShieldHolder(caster, [caster, near, stale, far, enemy], 2.5, 10)).toBe(near);
  });

  it('reaches an ally shielded at the aim, cast range plus search radius away', () => {
    const caster = unit(1, 0, 0);
    const atAim = unit(2, 0, 9.5, 12.5);
    const beyond = unit(3, 0, 11, 12.5);
    expect(pickShieldHolder(caster, [caster, atAim, beyond], 8 + 2.5, 10)).toBe(atAim);
    expect(pickShieldHolder(caster, [caster, beyond], 8 + 2.5, 10)).toBe(caster);
  });

  it('keeps the caster when they hold the freshest shield or nobody holds one', () => {
    const caster = unit(1, 0, 0, 12.5);
    const ally = unit(2, 0, 1, 12);
    expect(pickShieldHolder(caster, [caster, ally], 2.5, 10)).toBe(caster);
    const bare = unit(1, 0, 0);
    expect(pickShieldHolder(bare, [bare, unit(2, 0, 1)], 2.5, 10)).toBe(bare);
  });
});
