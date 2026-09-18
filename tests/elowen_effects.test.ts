// Elowen's authored spell effects: the exported Blender files carry the
// parts the runtime looks up by name and kind with their extras and
// morph targets, every material says how it blends, the pose and clock
// helpers follow the files' convention and the sim's durations, and the
// catalog wires the hooks (no GPU, no VfxSystem instance).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SPELL_VFX } from '../src/render/vfx/catalog';
import {
  animateMist,
  BLINK_RANGE,
  CHARACTER_SCALE,
  elowenPoseWeight,
  FPS,
  fadeAt,
  grownPose,
  IMPACT,
  mistMaterial,
  STEP,
  setElowenPose,
  setMistFade,
  VEIL_MS,
  WHITEOUT_MS,
  WISP,
  ZONE_FADE_MS,
} from '../src/render/vfx/elowen_fx';
import type { VfxSystem } from '../src/render/vfx/system';
import { ELOWEN } from '../src/sim/content/champions/elowen';

interface GlbNode {
  name: string;
  extras?: Record<string, unknown>;
  mesh?: number;
}
interface GlbMaterial {
  name: string;
  extras?: Record<string, unknown>;
}

function readGlb(file: string): {
  nodes: GlbNode[];
  materials: GlbMaterial[];
  morphs: (name: string) => number;
} {
  const path = fileURLToPath(new URL(`../public/models/effects/${file}`, import.meta.url));
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    nodes: GlbNode[];
    materials: GlbMaterial[];
    meshes: { primitives: { targets?: unknown[] }[] }[];
  };
  const morphs = (name: string): number => {
    const node = json.nodes.find((n) => n.name === name);
    if (!node || node.mesh === undefined) return -1;
    return json.meshes[node.mesh]?.primitives[0]?.targets?.length ?? 0;
  };
  return { nodes: json.nodes, materials: json.materials, morphs };
}

const extrasOf = (nodes: GlbNode[]) => Object.fromEntries(nodes.map((n) => [n.name, n.extras]));

// A stand-in for the VFX system that counts what a hook asked for.
function recorder() {
  const calls = {
    particles: 0,
    rings: 0,
    decals: 0,
    flashes: 0,
    puffs: 0,
    pulses: 0,
    shakes: 0,
    bolts: 0,
    sparks: 0,
    timed: 0,
    beats: [] as { delayMs: number; fn: () => void }[],
  };
  const fx = {
    particles: { spawn: () => calls.particles++ },
    rings: { spawn: () => calls.rings++ },
    decals: { spawn: () => calls.decals++ },
    bolts: { spawn: () => calls.bolts++ },
    timed: { attach: () => calls.timed++ },
    glowFlash: () => calls.flashes++,
    sparkBurst: () => calls.sparks++,
    smokePuffs: () => calls.puffs++,
    lightPulse: () => calls.pulses++,
    onShake: () => calls.shakes++,
    schedule: (delayMs: number, fn: () => void) => calls.beats.push({ delayMs, fn }),
    groundAt: () => 0,
  } as unknown as VfxSystem;
  return { fx, calls };
}

// A mesh with `poses` morph targets named the file's way.
function posedMesh(poses: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.morphTargetDictionary = {};
  mesh.morphTargetInfluences = [];
  for (let i = 0; i < poses; i++) {
    mesh.morphTargetDictionary[`Pose_${String(i).padStart(2, '0')}`] = i;
    mesh.morphTargetInfluences.push(0);
  }
  return mesh;
}

describe('the exported effect files', () => {
  it('ship the mist lance, its spinning mist and the impact parts', () => {
    const { nodes, morphs } = readGlb('elowen_mist_lance.glb');
    const byName = extrasOf(nodes);
    expect(byName.Elowen_LanceCore).toEqual({ effectKind: 'core' });
    expect(byName.Elowen_LanceMist).toEqual({ effectKind: 'spin', spin: 9 });
    expect(byName.Elowen_LanceSheath).toEqual({ effectKind: 'sheath' });
    expect(byName.Elowen_LanceImpact).toEqual({ effectKind: 'burst', poses: 14 });
    expect(byName.Elowen_LanceWave).toEqual({ effectKind: 'wave', poses: 10 });
    expect(morphs('Elowen_LanceImpact')).toBe(14);
    expect(morphs('Elowen_LanceWave')).toBe(10);
    expect(morphs('Elowen_LanceMist')).toBe(0);
  });

  it('ship the veil in five layers, four of them growing', () => {
    const { nodes, morphs } = readGlb('elowen_veil.glb');
    const byName = extrasOf(nodes);
    expect(byName.Elowen_VeilOuter).toEqual({ effectKind: 'veil', poses: 12, spin: 0.18 });
    expect(byName.Elowen_VeilInner).toEqual({ effectKind: 'veil', poses: 12, spin: -0.3 });
    expect(byName.Elowen_VeilWisps).toEqual({ effectKind: 'wisps', poses: 12, spin: 0.5 });
    expect(byName.Elowen_VeilGround).toEqual({ effectKind: 'ground', poses: 12 });
    expect(byName.Elowen_VeilFlecks).toEqual({ effectKind: 'flecks', spin: 0.35 });
    for (const name of ['Elowen_VeilOuter', 'Elowen_VeilInner', 'Elowen_VeilWisps']) {
      expect(morphs(name), name).toBe(12);
    }
    expect(morphs('Elowen_VeilGround')).toBe(12);
    expect(morphs('Elowen_VeilFlecks')).toBe(0);
  });

  it('ship the auto as a wisp, its spinning mist and a bursting impact', () => {
    const { nodes, morphs } = readGlb('elowen_attack_wisp.glb');
    const byName = extrasOf(nodes);
    expect(byName.Elowen_WispCore).toEqual({ effectKind: 'core' });
    expect(byName.Elowen_WispMist).toEqual({ effectKind: 'spin', spin: 12 });
    expect(byName.Elowen_WispBurst).toEqual({ effectKind: 'burst', poses: 8 });
    expect(morphs('Elowen_WispBurst')).toBe(8);
    expect(morphs('Elowen_WispMist')).toBe(0);
  });

  it('ship the step as a flash in three quick parts and the streak between', () => {
    const { nodes, morphs } = readGlb('elowen_step.glb');
    const byName = extrasOf(nodes);
    expect(byName.Elowen_StepCore).toEqual({ effectKind: 'core', poses: 6 });
    expect(byName.Elowen_StepFlash).toEqual({ effectKind: 'burst', poses: 6 });
    expect(byName.Elowen_StepRing).toEqual({ effectKind: 'ring', poses: 6 });
    expect(byName.Elowen_StepTrail).toEqual({ effectKind: 'trail' });
    for (const name of ['Elowen_StepCore', 'Elowen_StepFlash', 'Elowen_StepRing']) {
      expect(morphs(name), name).toBe(6);
    }
    expect(morphs('Elowen_StepTrail')).toBe(0);
    // A quarter second of growth: a flash, not a storm.
    expect((6 * 1000) / FPS).toBe(250);
  });

  it('ship the whiteout in six layers, five of them growing', () => {
    const { nodes, morphs } = readGlb('elowen_whiteout.glb');
    const byName = extrasOf(nodes);
    expect(byName.Elowen_StormWall).toEqual({ effectKind: 'wall', poses: 12, spin: 0.35 });
    expect(byName.Elowen_StormRibbons).toEqual({ effectKind: 'spin', poses: 12, spin: 0.9 });
    expect(byName.Elowen_StormEye).toEqual({ effectKind: 'eye', poses: 12, spin: -1.6 });
    expect(byName.Elowen_StormVortex).toEqual({ effectKind: 'vortex', poses: 12, spin: 2.2 });
    expect(byName.Elowen_StormGround).toEqual({ effectKind: 'ground', poses: 12 });
    expect(byName.Elowen_StormFlecks).toEqual({ effectKind: 'flecks', spin: 1.2 });
    for (const name of nodes.map((n) => n.name)) {
      expect(morphs(name), name).toBe(name === 'Elowen_StormFlecks' ? 0 : 12);
    }
  });

  it('say on every material how it blends: additive but the outer veil and the wall', () => {
    const blended: string[] = [];
    for (const file of [
      'elowen_attack_wisp.glb',
      'elowen_mist_lance.glb',
      'elowen_veil.glb',
      'elowen_step.glb',
      'elowen_whiteout.glb',
    ]) {
      for (const material of readGlb(file).materials) {
        expect(typeof material.extras?.additive, `${file} ${material.name}`).toBe('boolean');
        if (material.extras?.additive === false) blended.push(material.name);
      }
    }
    expect(blended.sort()).toEqual(['Elowen_StormWall', 'Elowen_VeilOuter']);
  });
});

describe('the pose and clock helpers', () => {
  it('setElowenPose weights the targets around the pose, the base at zero', () => {
    const mesh = posedMesh(12);
    setElowenPose(mesh, 0);
    expect(mesh.morphTargetInfluences).toEqual(new Array(12).fill(0));
    setElowenPose(mesh, 12);
    const last = new Array(12).fill(0);
    last[11] = 1;
    expect(mesh.morphTargetInfluences).toEqual(last);
    setElowenPose(mesh, 2.5);
    const weights = mesh.morphTargetInfluences!;
    expect(weights[1]).toBeCloseTo(0.5);
    expect(weights[2]).toBeCloseTo(0.5);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // The weight function alone, for the record.
    expect(elowenPoseWeight(1, 0)).toBe(1);
    expect(elowenPoseWeight(1.25, 0)).toBeCloseTo(0.75);
    expect(elowenPoseWeight(3, 0)).toBe(0);
  });

  it('grows to the last pose exactly `poses` frames after the start', () => {
    for (const poses of [10, 12, 14]) {
      expect(grownPose(0, poses)).toBe(0);
      expect(grownPose((poses * 1000) / FPS, poses)).toBeCloseTo(poses);
      expect(grownPose((poses * 1000) / FPS + 500, poses)).toBeCloseTo(poses);
      const half = grownPose((poses * 500) / FPS, poses);
      expect(half).toBeGreaterThan(poses * 0.4);
      expect(half).toBeLessThan(poses * 0.6);
    }
  });

  it('fades the zones over the last 0.4 s of the sim durations', () => {
    const wSpec = ELOWEN.abilities.W.spec;
    const rSpec = ELOWEN.abilities.R.spec;
    expect(VEIL_MS).toBe(wSpec.kind === 'zone' ? wSpec.duration * 1000 : -1);
    expect(WHITEOUT_MS).toBe(rSpec.kind === 'zone' ? rSpec.duration * 1000 : -1);
    expect(ZONE_FADE_MS).toBe(400);
    for (const duration of [VEIL_MS, WHITEOUT_MS]) {
      expect(fadeAt(duration - 401, duration, ZONE_FADE_MS)).toBe(1);
      expect(fadeAt(duration - 400, duration, ZONE_FADE_MS)).toBe(1);
      expect(fadeAt(duration - 200, duration, ZONE_FADE_MS)).toBeCloseTo(0.5);
      expect(fadeAt(duration, duration, ZONE_FADE_MS)).toBe(0);
      expect(fadeAt(duration + 50, duration, ZONE_FADE_MS)).toBe(0);
    }
  });

  it('gives the timed effects lives that outlast their growth and fade', () => {
    expect(IMPACT.lifeMs).toBeGreaterThanOrEqual((14 * 1000) / FPS + IMPACT.fadeMs);
    expect(STEP.lifeMs).toBeGreaterThanOrEqual((6 * 1000) / FPS + STEP.fadeMs);
    expect(STEP.trailMs).toBeGreaterThan(STEP.trailHoldMs);
    expect(WISP.lifeMs).toBeGreaterThanOrEqual((8 * 1000) / FPS + WISP.fadeMs);
  });

  it('scales the source metre by the manifest height', () => {
    expect(CHARACTER_SCALE).toBeCloseTo(4.2 / 1.055, 3);
  });
});

describe('the materials and the frame', () => {
  it('rebuilds a loaded layer as its emissive colour, unlit, blended as the file says', () => {
    const map = new THREE.Texture();
    const loaded = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(0.5, 0.5, 1),
      emissiveIntensity: 2,
      map,
      transparent: true,
      opacity: 0.55,
    });
    loaded.userData.additive = false;
    const blended = mistMaterial(loaded);
    expect(blended.color.r).toBeCloseTo(1);
    expect(blended.color.b).toBeCloseTo(2);
    expect(blended.map).toBe(map);
    expect(blended.opacity).toBeCloseTo(0.55);
    expect(blended.transparent).toBe(true);
    expect(blended.depthWrite).toBe(false);
    expect(blended.side).toBe(THREE.DoubleSide);
    expect(blended.blending).toBe(THREE.NormalBlending);
    expect(blended.userData.opacity).toBeCloseTo(0.55);
    loaded.userData.additive = true;
    expect(mistMaterial(loaded).blending).toBe(THREE.AdditiveBlending);
  });

  it('fades a whole effect from its authored opacities and back', () => {
    const root = new THREE.Group();
    const loaded = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.6 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mistMaterial(loaded));
    root.add(mesh);
    setMistFade(root, 0.5);
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.3);
    setMistFade(root, 1);
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.6);
  });

  it('animates a frame: poses grown, spinners turned, flecks bobbing', () => {
    const grown = posedMesh(12);
    const spinner = new THREE.Group();
    const flecks = new THREE.Group();
    flecks.position.y = 0.5;
    const effect = {
      root: new THREE.Group(),
      parts: [
        { node: grown, poses: 12, spin: 0, bob: 0, baseY: 0 },
        { node: spinner, poses: 0, spin: 2, bob: 0, baseY: 0 },
        { node: flecks, poses: 0, spin: 0.5, bob: 0.05, baseY: 0.5 },
      ],
    };
    animateMist(effect, 500, (poses) => grownPose(500, poses));
    expect(grown.morphTargetInfluences![11]).toBeCloseTo(1);
    expect(spinner.rotation.y).toBeCloseTo(1);
    expect(flecks.rotation.y).toBeCloseTo(0.25);
    expect(Math.abs(flecks.position.y - 0.5)).toBeLessThanOrEqual(0.05);
    expect(flecks.position.y).not.toBe(0.5);
  });
});

describe('the catalog hooks', () => {
  it('give Elowen her auto, Q, W, E and R in her authored mist', () => {
    expect(SPELL_VFX.elowen_A?.projectile).toBeDefined();
    expect(SPELL_VFX.elowen_A?.projectileTick).toBeDefined();
    expect(SPELL_VFX.elowen_A?.impact).toBeDefined();
    expect(SPELL_VFX.elowen_Q?.projectile).toBeDefined();
    expect(SPELL_VFX.elowen_Q?.projectileTick).toBeDefined();
    expect(SPELL_VFX.elowen_Q?.impact).toBeDefined();
    expect(SPELL_VFX.elowen_W?.zone).toBeDefined();
    expect(SPELL_VFX.elowen_W?.zoneTick).toBeDefined();
    expect(SPELL_VFX.elowen_E?.castFx).toBeDefined();
    expect(SPELL_VFX.elowen_R?.zone).toBeDefined();
    expect(SPELL_VFX.elowen_R?.zoneTick).toBeDefined();
  });

  it('builds the lance through the projectile hook without the generic stretch', () => {
    const lance = SPELL_VFX.elowen_Q!.projectile!(0.6, { main: 0, glow: 0 });
    expect(lance.name).toBe('Elowen_MistLance');
    expect(lance.userData.stretch).toBe(false);
    const { fx, calls } = recorder();
    SPELL_VFX.elowen_Q!.projectileTick!(fx, 0, 0, 16, { main: 0, glow: 0 }, 0, lance);
    expect(calls.particles).toBe(0);
    SPELL_VFX.elowen_Q!.impact!(fx, 0, 0, { main: 0, glow: 0 });
    expect(calls.flashes).toBe(1);
    expect(calls.pulses).toBe(1);
    expect(calls.sparks).toBe(0);
    expect(calls.particles).toBe(0);
  });

  it('opens each zone once with a glow and never throws particles', () => {
    for (const [key, name, shakes] of [
      ['elowen_W', 'Elowen_Veil', 0],
      ['elowen_R', 'Elowen_Whiteout', 1],
    ] as const) {
      const { fx, calls } = recorder();
      const zone = SPELL_VFX[key]!.zone!(3.5, { main: 0, glow: 0 }, true);
      expect(zone.name).toBe(name);
      const tick = SPELL_VFX[key]!.zoneTick!;
      for (let age = 0; age < 4000; age += 16)
        tick(fx, zone, 0, 0, 3.5, age, { main: 0, glow: 0 }, 16);
      expect(calls.flashes).toBe(1);
      expect(calls.pulses).toBe(1);
      expect(calls.shakes).toBe(shakes);
      expect(calls.particles).toBe(0);
      expect(calls.decals).toBe(0);
      expect(calls.bolts).toBe(0);
    }
  });

  it('builds the wisp through the projectile hook, its impact a flash and a light', () => {
    const wisp = SPELL_VFX.elowen_A!.projectile!(0.3, { main: 0, glow: 0 });
    expect(wisp.name).toBe('Elowen_AttackWisp');
    expect(wisp.userData.stretch).toBe(false);
    const { fx, calls } = recorder();
    SPELL_VFX.elowen_A!.projectileTick!(fx, 0, 0, 16, { main: 0, glow: 0 }, 0, wisp);
    SPELL_VFX.elowen_A!.impact!(fx, 0, 0, { main: 0, glow: 0 });
    expect(calls.flashes).toBe(1);
    expect(calls.pulses).toBe(1);
    expect(calls.sparks).toBe(0);
    expect(calls.particles).toBe(0);
  });

  it('flashes where she left and, one beat later, where she landed', () => {
    const { fx, calls } = recorder();
    SPELL_VFX.elowen_E!.castFx!(fx, 8, 6, 0.6, 0.8, { main: 0, glow: 0 }, 5, 2);
    expect(calls.flashes).toBe(1);
    const arrival = calls.beats.find((b) => b.delayMs === STEP.arrivalDelayMs);
    expect(arrival).toBeDefined();
    for (const beat of calls.beats) beat.fn();
    expect(calls.flashes).toBe(2);
    expect(calls.particles).toBe(0);
  });

  it('without the departure, takes it the kit E range back along the aim', () => {
    expect(BLINK_RANGE).toBe(ELOWEN.abilities.E.castRange);
    const { fx, calls } = recorder();
    SPELL_VFX.elowen_E!.castFx!(fx, 0, 0, 3, 4, { main: 0, glow: 0 });
    expect(calls.flashes).toBe(1);
    for (const beat of calls.beats) beat.fn();
    expect(calls.flashes).toBe(2);
  });
});
