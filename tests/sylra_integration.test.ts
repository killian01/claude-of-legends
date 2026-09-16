import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { ChampionTemplate } from '../src/render/champions/assets';
import { CHAMPION_VISUALS } from '../src/render/champions/manifest';
import { ChampionVisual } from '../src/render/champions/visual';
import { spellVisualOf } from '../src/render/vfx/catalog';
import { growthAt, setMorphPose } from '../src/render/vfx/sylra_fx';

// Keep the real skeleton and animation data; remove only image loading so
// the production glTF loader and mixer can run without a browser or GPU.
async function readModel(path: string) {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  delete json.images;
  delete json.textures;
  delete json.materials;
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  const raw = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20);
  raw.copy(padded);
  const tail = bytes.subarray(20 + length);
  const out = Buffer.alloc(20 + padded.length + tail.length);
  bytes.subarray(0, 20).copy(out);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12);
  padded.copy(out, 20);
  tail.copy(out, 20 + padded.length);
  return new GLTFLoader().parseAsync(
    out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
    '',
  );
}

async function sylra() {
  const model = await readModel('public/models/champions/sylra.glb');
  const def = CHAMPION_VISUALS.sylra!;
  const template: ChampionTemplate = {
    def,
    scene: model.scene,
    clips: new Map(model.animations.map((a) => [a.name, a])),
    scale: 1,
    groundY: 0,
    props: new Map(),
  };
  const root = new THREE.Group();
  root.add(model.scene);
  const visual = new ChampionVisual(template, root, model.scene);
  return { visual, model };
}

const standing = { moving: false, windingUp: false, dead: false, speed: 0 };
function internal(v: ChampionVisual) {
  return v as unknown as {
    shotActions: Record<string, THREE.AnimationAction>;
    spellActions: Record<string, THREE.AnimationAction>;
    baseActions: Record<string, THREE.AnimationAction>;
  };
}

describe('Sylra authored animation integration', () => {
  it('reproduces the Blender hand, foot and head poses in the shipped Attack and W clips', async () => {
    const model = await readModel('public/models/champions/sylra.glb');
    const reference = JSON.parse(
      readFileSync('tests/fixtures/sylra_clip_poses.json', 'utf8'),
    ) as Record<string, { seconds: number; joints: Record<string, [number, number, number]> }[]>;
    const mixer = new THREE.AnimationMixer(model.scene);
    const gaps: { name: string; time: number; bone: string; gap: number }[] = [];
    for (const [name, frames] of Object.entries(reference)) {
      mixer.stopAllAction();
      mixer.clipAction(model.animations.find((clip) => clip.name === name)!).play();
      for (const frame of frames) {
        mixer.setTime(frame.seconds);
        model.scene.updateMatrixWorld(true);
        for (const [bone, xyz] of Object.entries(frame.joints)) {
          const node = model.scene.getObjectByName(bone.replace(/\./g, ''))!;
          const gap = node
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(new THREE.Vector3(...xyz));
          gaps.push({ name, time: frame.seconds, bone, gap });
        }
      }
    }
    const worst = gaps.sort((a, b) => b.gap - a.gap)[0]!;
    // glTF stores translation/rotation/scale, not Rigify's sheared joint matrices.
    // Decomposing the Blender hierarchy itself gives a 0.00259 foot gap at
    // W frame 13. Allow 3 mm on the roughly one-metre source, while catching
    // wrong actions, rest poses and timing offsets.
    expect(worst.gap, JSON.stringify(gaps.slice(0, 5))).toBeLessThan(0.003);
  });
  it('plays the basic attack at its authored release beat, including faster attacks', async () => {
    const { visual } = await sylra();
    visual.update(200, standing);
    visual.playAttack(0.35);
    visual.update(350, standing);
    const attack = internal(visual).shotActions.attack!;
    expect(attack.time).toBeCloseTo(0.35, 5);
    expect(attack.getEffectiveWeight()).toBeGreaterThan(0.99);
    visual.playAttack(0.2);
    visual.update(200, standing);
    expect(attack.time).toBeCloseTo(0.35, 5);
    visual.dispose();
  });

  it('keeps W distinct from Q and preserves the two-second casting gesture', async () => {
    const { visual } = await sylra();
    visual.update(200, standing);
    visual.playCast('W');
    visual.update(700, standing);
    const state = internal(visual);
    expect(state.spellActions.W!.getClip().name).toBe('Cast_W');
    expect(state.spellActions.W!.time).toBeCloseTo(0.7, 5);
    expect(state.spellActions.W!.getEffectiveWeight()).toBeGreaterThan(0.99);
    expect(state.spellActions.Q!.getEffectiveWeight()).toBe(1); // not scheduled
    expect(state.spellActions.Q!.isRunning()).toBe(false);
    visual.update(1600, standing);
    visual.update(200, standing);
    expect(state.baseActions.idle!.getEffectiveWeight()).toBeGreaterThan(0.99);
    visual.dispose();
  });

  it('uses the animated staff tip rather than a fixed estimated spawn point', async () => {
    const { visual, model } = await sylra();
    visual.update(200, standing);
    visual.playAttack(0.35);
    visual.update(350, standing);
    const tip = new THREE.Vector3();
    expect(visual.muzzleWorld(tip)).toBe(true);
    const node = model.scene.getObjectByName('Sylra_Staff')!;
    const expected = node.localToWorld(new THREE.Vector3(0, 0.96, 0));
    expect(tip.distanceTo(expected)).toBeLessThan(1e-6);
    visual.dispose();
  });

  it('restores walking when a movement order interrupts the long recovery', async () => {
    const { visual } = await sylra();
    visual.playCast('W');
    visual.update(500, standing);
    for (let i = 0; i < 20; i++) visual.update(20, { ...standing, moving: true, speed: 3.6 });
    expect(internal(visual).baseActions.run!.getEffectiveWeight()).toBeGreaterThan(0.99);
    expect(internal(visual).spellActions.W!.getEffectiveWeight()).toBeLessThan(0.01);
    visual.dispose();
  });
});

describe('Sylra Blender effects', () => {
  it('resolves a dedicated seed projectile and a dedicated W field', () => {
    expect(spellVisualOf('sylra_A')?.projectile).toBeTypeOf('function');
    expect(spellVisualOf('sylra_A')?.impact).toBeTypeOf('function');
    expect(spellVisualOf('sylra_W')?.zone).toBeTypeOf('function');
  });

  it('ships growing branched stems, foliage, roots, seeds and pollen from Blender', async () => {
    const { scene } = await readModel('public/models/effects/sylra_bramble.glb');
    const parts: THREE.Object3D[] = [];
    scene.traverse((n) => {
      if (n.userData.effectKind) parts.push(n);
    });
    const stems = parts.filter((p) => p.userData.effectKind === 'bramble');
    expect(stems).toHaveLength(5);
    expect(new Set(parts.map((p) => p.userData.effectKind))).toEqual(
      new Set(['bramble', 'seed', 'roots', 'veins', 'boundary', 'sigils', 'pollen', 'petals']),
    );
    const stem = stems[0]!;
    setMorphPose(stem, 2.5);
    let checked = 0;
    stem.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) return;
      expect(mesh.morphTargetInfluences[mesh.morphTargetDictionary.Pose_02!]).toBe(0.5);
      expect(mesh.morphTargetInfluences[mesh.morphTargetDictionary.Pose_03!]).toBe(0.5);
      expect(mesh.morphTargetInfluences.reduce((a, b) => a + b, 0)).toBe(1);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    expect(growthAt(12, 12)).toBe(0);
    expect(growthAt(26, 12)).toBe(1);
  });
});
